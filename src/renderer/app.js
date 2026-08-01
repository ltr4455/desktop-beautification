'use strict';
/* FlowDesk 渲染层（v5）：
 * - 应用 / 游戏 → 底部停靠栏（仅图标，置顶常驻 + 仓库，滚轮切换）
 * - 其余类别 → 默认收起的右侧条（点一下就地展开滚轮浏览；⤢ 单独打开居中，其他窗口保留）
 * - 动效：全局可开关/选类型/调时长/悬停反馈；逐窗口外观面板可单独覆盖
 * - 设置：右键停靠栏或任意窗口 → 设置（常规/外观/动效/布局/关于）
 */
const api = window.flowdesk;

const state = {
  data: null,
  containers: {},
  hiddenItems: {},
  pinned: [],
  selectedContainer: null,
  saveTimer: null,
  icons: new Map(),
  overSent: false,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  warehouseOpen: false,
  dockScroll: 0,
  expandedId: null,
  focusedId: null,
  entranceDone: false,
  windowMotion: null,
  windowMotionSeq: 0,
  collapsePending: null,
  pendingExpand: null,
  containersLoaded: false,
};

const CATEGORY_ICON = {
  app: '🖥️', game: '🎮', folder: '📁', image: '🖼️', doc: '📄',
  media: '🎬', archive: '🗜️', link: '🔗', other: '📦',
};
const CATEGORY_LABEL = {
  recommend: '智能推荐', app: '应用', game: '游戏', folder: '文件夹', image: '图片',
  doc: '文档', media: '音视频', archive: '压缩包', link: '网页链接', other: '其他',
};
const LIST_CATEGORIES = new Set(['folder', 'image', 'doc', 'media', 'archive', 'link', 'other']);
// 游戏保留为内部分类，便于识别和手动调整；视觉上与应用合并到 Dock，不单独占用右侧栏。
const RIGHT_COL_ORDER = ['recommend', 'folder', 'image', 'doc', 'media', 'archive', 'link', 'other'];
const DEF_W = 300;
const HEADER_H = 40;
const GAP = 16;
const MAX_ICON = 64;
const MIN_ICON = 30;
const FOCUS_W = 560;
const FOCUS_H = 600;

const TEXTURES = [
  { id: 'frosted', label: '毛玻璃', cls: 't-frosted' },
  { id: 'metal', label: '金属', cls: 't-metal' },
  { id: 'wood', label: '木纹', cls: 't-wood' },
  { id: 'fabric', label: '布纹', cls: 't-fabric' },
  { id: 'starry', label: '星空', cls: 't-starry' },
  { id: 'minimal', label: '极简', cls: 't-minimal' },
];

/* ---------------- 工具 ---------------- */
function $id(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
let toastTimer = null;
function toast(msg, ms = 2600, actionLabel, actionFn) {
  const t = $id('toast');
  t.innerHTML = '';
  if (actionLabel && actionFn) {
    t.appendChild(el('span', 'toast-msg', msg));
    const a = el('span', 'toast-action', actionLabel);
    a.addEventListener('click', () => {
      clearTimeout(toastTimer);
      t.innerHTML = '';
      t.classList.add('hidden');
      actionFn();
    });
    t.appendChild(a);
    t.classList.add('has-action');
  } else {
    t.textContent = msg;
  }
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.innerHTML = ''; t.classList.add('hidden'); }, ms);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function defaultStyle() {
  return { color: '#7aa2ff', opacity: 0.9, contentOpacity: 1, texture: 'frosted', radius: 16, border: true };
}
function styleForTarget(id) {
  if (id === 'categories') return settings().categoryStyle || defaultStyle();
  const cfg = state.containers[id] || {};
  if (id !== 'app') return cfg.style || settings().categoryStyle || defaultStyle();
  return cfg.style || defaultStyle();
}
function styleTargetLabel(id) {
  if (id === 'app') return '应用栏（独立设置）';
  if (id === 'categories') return '全部分类条（统一设置）';
  return `单独分类条：${catLabel(id)}`;
}
function settings() {
  return state.data ? state.data.settings : {};
}
function catLabel(id) {
  return CATEGORY_LABEL[id] || id;
}

/* 设置改动：先更新渲染层快照（否则 render 读到的还是旧值），再持久化 */
async function applyLocalSettings(patch) {
  if (state.data) state.data.settings = { ...(state.data.settings || {}), ...patch };
  await api.setSettings(patch);
}

/* ---------------- 容器配置 ---------------- */
function getContainerConfig(id) {
  let cfg = state.containers[id];
  if (!cfg) {
    cfg = {
      x: null, y: null, w: DEF_W, h: HEADER_H, hidden: false, collapsed: true,
      style: null, userMoved: false, reattached: false, reattachedAt: null,
    };
    state.containers[id] = cfg;
  }
  return cfg;
}

function rightColumnOrder() {
  // 回归主列的分类条始终排在原有分类之后；按回归时间排序，使刚吸附的条目落在最下方。
  const tail = RIGHT_COL_ORDER
    .filter((id) => state.containers[id] && state.containers[id].reattached === true)
    .sort((a, b) => {
      const aa = Number(state.containers[a].reattachedAt) || 0;
      const bb = Number(state.containers[b].reattachedAt) || 0;
      return aa - bb || RIGHT_COL_ORDER.indexOf(a) - RIGHT_COL_ORDER.indexOf(b);
    });
  return RIGHT_COL_ORDER.filter((id) => !tail.includes(id)).concat(tail);
}

function itemsOf(id) {
  if (id === 'recommend') {
    return (state.data.recommended || []).filter((r) => !state.hiddenItems[r.path]);
  }
  return state.data.items.filter((it) => it.category === id && !state.hiddenItems[it.path]);
}

function appItems() {
  return state.data.items.filter((it) => (it.category === 'app' || it.category === 'game') && !state.hiddenItems[it.path]);
}

/* ---------------- 动效 ---------------- */
function shouldAnimate(cfg) {
  const g = settings();
  if (g.animEnabled === false) return false;
  const t = cfg && cfg.style && cfg.style.anim ? cfg.style.anim : g.animType;
  return Boolean(t) && t !== 'none';
}
function animTypeOf(cfg) {
  const g = settings();
  return cfg && cfg.style && cfg.style.anim ? cfg.style.anim : g.animType || 'none';
}
function animDurOf(cfg) {
  const g = settings();
  return (cfg && cfg.style && cfg.style.animDur) || g.animDuration || 300;
}
function hoverEnabled(cfg) {
  const g = settings();
  const h = cfg && cfg.style && typeof cfg.style.hover === 'boolean' ? cfg.style.hover : null;
  return h !== null ? h : g.hoverEffect !== false;
}

/* ---------------- 主渲染 ---------------- */
function render() {
  if (!state.data) return;
  buildContainers();
  buildDock();
  applySettingsUI();
  applyIconsStatus();
  requestAnimationFrame(() => {
    layoutRightColumn();
    if (!state.entranceDone) state.entranceDone = true;
    if (!document.body.classList.contains('ready')) document.body.classList.add('ready');
    if (state.warehouseOpen) buildWarehouse();
  });
}

function buildContainers() {
  const layer = $id('containers');
  layer.innerHTML = '';
  let animIdx = 0;
  for (const id of rightColumnOrder()) {
    const cfg = getContainerConfig(id);
    if (cfg.hidden) continue;
    const items = itemsOf(id);
    if (id !== 'recommend' && items.length === 0) continue;
    const cont = createContainer(id, cfg, items);
    if (!state.entranceDone && shouldAnimate(cfg)) {
      cont.classList.add('anim');
      cont.style.animationDelay = Math.min(animIdx * 45, 360) + 'ms';
      animIdx++;
    }
    layer.appendChild(cont);
  }
}

/* ---------------- 容器创建 ---------------- */
function createContainer(id, cfg, items) {
  const cont = el('div', 'container');
  cont.dataset.id = id;
  const isFocused = state.focusedId === id;
  const isExpanded = state.expandedId === id;
  const motion = state.windowMotion && state.windowMotion.id === id ? state.windowMotion : null;
  if (!isFocused && !isExpanded) cont.classList.add('collapsed');
  if (isFocused) cont.classList.add('focused');
  if (motion) {
    cont.classList.add('window-motion', `window-motion-${motion.kind}`);
    cont.dataset.motionToken = String(motion.token);
    cont.addEventListener('animationend', () => {
      if (state.windowMotion && String(state.windowMotion.token) === cont.dataset.motionToken) state.windowMotion = null;
    }, { once: true });
  }
  cont.style.width = cfg.w + 'px';
  applyContainerStyle(cont, styleForTarget(id));

  const head = el('div', 'cont-head');
  const title = el('span', 'cont-title', (CATEGORY_ICON[id] ? CATEGORY_ICON[id] + ' ' : '✨ ') + catLabel(id));
  if (id !== 'recommend') title.appendChild(el('span', 'cont-count', ` ${items.length}`));
  else title.appendChild(el('span', 'cont-count', ` Top ${items.length}`));
  const focusBtn = el('button', 'cont-focus-btn', isFocused ? '←' : '⤢');
  focusBtn.title = isFocused ? '收起回原位' : '单独打开（屏幕中央）';
  head.appendChild(title);
  head.appendChild(focusBtn);
  cont.appendChild(head);

  const body = el('div', 'cont-body');
  if (id === 'recommend') {
    body.appendChild(buildRecommendList(items));
  } else if (LIST_CATEGORIES.has(id)) {
    body.appendChild(buildList(items));
  } else {
    const grid = el('div', 'cont-grid');
    for (const item of items) grid.appendChild(createCell(item));
    body.appendChild(grid);
    cont.gridEl = grid;
  }
  cont.appendChild(body);

  bindContainerInteractions(cont, id, cfg, focusBtn);
  if (id !== 'recommend') enableDropTarget(cont, id);

  if (!LIST_CATEGORIES.has(id) && id !== 'recommend') {
    updateIconSize(cont);
    const ro = new ResizeObserver(() => updateIconSize(cont));
    ro.observe(body);
    cont.iconObserver = ro;
  }
  return cont;
}

function updateIconSize(cont) {
  const body = cont.querySelector('.cont-body');
  if (!body || body.clientWidth <= 0) return;
  const w = body.clientWidth - 16;
  const cols = Math.max(2, Math.min(8, Math.floor(w / 64)));
  const avail = w - (cols - 1) * 6;
  const cellW = Math.floor(avail / cols);
  const icon = clamp(cellW - 16, MIN_ICON, MAX_ICON);
  cont.style.setProperty('--icon-size', icon + 'px');
}

function createCell(item) {
  const cell = el('div', 'cell');
  cell.dataset.path = item.path;
  const iconBox = el('div', 'cell-icon');
  const fallback = el('span', 'fallback', CATEGORY_ICON[item.category] || '📦');
  const img = el('img', 'hidden');
  img.alt = '';
  iconBox.appendChild(fallback);
  iconBox.appendChild(img);
  cell.appendChild(iconBox);
  const name = el('div', 'cell-name', item.name);
  name.title = item.name;
  cell.appendChild(name);
  loadIcon(item, img, fallback);
  bindCellInteractions(cell, item);
  return cell;
}

function buildList(items) {
  const list = el('div', 'cont-list');
  for (const item of items) {
    const row = el('div', 'list-row');
    row.dataset.path = item.path;
    row.title = item.name;
    const iconBox = el('div', 'li-icon');
    const fallback = el('span', 'fallback', CATEGORY_ICON[item.category] || '📦');
    const img = el('img', 'hidden');
    img.alt = '';
    iconBox.appendChild(fallback);
    iconBox.appendChild(img);
    row.appendChild(iconBox);
    row.appendChild(el('span', 'li-name', item.name));
    if (item.isDir) row.appendChild(el('span', 'li-meta', '文件夹'));
    else if (item.ext) row.appendChild(el('span', 'li-meta', item.ext.replace('.', '').toUpperCase()));
    loadIcon(item, img, fallback);
    bindCellInteractions(row, item);
    list.appendChild(row);
  }
  return list;
}

function buildRecommendList(rows) {
  const wrap = el('div', 'rec-list');
  if (rows.length === 0) {
    wrap.appendChild(el('div', 'hint', '暂无使用记录，打开几次桌面项目后这里会智能排序'));
    return wrap;
  }
  for (const r of rows) {
    const row = el('div', 'rec-row');
    row.title = r.name;
    const img = el('img', '');
    img.alt = '';
    loadRecIcon(r, img);
    row.appendChild(img);
    row.appendChild(el('span', 'rec-name', r.name));
    const bar = el('div', 'rec-bar');
    const fill = el('i', '');
    fill.style.width = Math.round(clamp(r.score, 0, 1) * 100) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('span', 'rec-score', r.score.toFixed(2)));
    row.addEventListener('dblclick', () => openItem(r));
    wrap.appendChild(row);
  }
  return wrap;
}

function applyContainerStyle(cont, style) {
  const s = style || defaultStyle();
  cont.style.setProperty('--accent', s.color || '#7aa2ff');
  if (cont.id === 'dock-wrap') {
    const g = settings();
    cont.style.setProperty('--dock-bg-opacity', clamp(Number(s.bgOpacity ?? g.dockBgOpacity ?? 0.9), 0.1, 1));
    cont.style.setProperty('--dock-icon-opacity', clamp(Number(s.iconOpacity ?? g.dockIconOpacity ?? 1), 0.1, 1));
  } else {
    const surfaceOpacity = clamp(Number(s.opacity ?? 0.9), 0.1, 1);
    cont.style.removeProperty('opacity');
    cont.style.setProperty('--surface-opacity', surfaceOpacity);
    cont.style.setProperty('--surface-glow-opacity', (surfaceOpacity * 0.18).toFixed(3));
    cont.style.setProperty('--content-opacity', clamp(Number(s.contentOpacity ?? 1), 0.1, 1));
  }
  cont.style.borderRadius = (s.radius ?? 16) + 'px';
  cont.classList.toggle('no-border', s.border === false);
  cont.dataset.texture = s.texture || 'frosted';
  if (s.textureImage) cont.style.setProperty('--texture-image', `url(${s.textureImage})`);
  else cont.style.removeProperty('--texture-image');
  // 动效
  cont.dataset.anim = animTypeOf(style);
  cont.style.setProperty('--anim-dur', animDurOf(style) + 'ms');
  cont.classList.toggle('no-hover', !hoverEnabled(style));
}

function loadIcon(item, img, fallback) {
  const url = state.icons.get(item.path);
  if (url) {
    img.src = url; img.classList.remove('hidden'); fallback.classList.add('hidden');
    return;
  }
  // 未命中缓存（值为空）不写入缓存，后续 icons-ready 重绘时自动重试
  api.icon(item.path, item.mtimeMs).then((u) => {
    if (u) state.icons.set(item.path, u);
    if (!img.isConnected) return;
    if (u) { img.src = u; img.classList.remove('hidden'); fallback.classList.add('hidden'); }
  }).catch(() => {});
}

function loadRecIcon(r, img) {
  const url = state.icons.get(r.path);
  if (url) { img.src = url; return; }
  const item = state.data.items.find((it) => it.path === r.path);
  if (!item) return;
  api.icon(item.path, item.mtimeMs).then((u) => {
    if (u) state.icons.set(r.path, u);
    if (u && img.isConnected) img.src = u;
  }).catch(() => {});
}

/* ---------------- 应用停靠栏 ---------------- */
function buildDock() {
  const apps = appItems();
  const wrap = $id('dock-wrap');
  const track = $id('dock-track');
  track.innerHTML = '';
  if (apps.length === 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.style.setProperty('--dock-icon-size', (settings().dockIconSize || 38) + 'px');
  state.dockScroll = 0;
  track.style.transform = '';
  const pinnedSet = new Set(state.pinned);
  const byPath = new Map(apps.map((a) => [a.path, a]));
  const ordered = [];
  for (const p of state.pinned) if (byPath.has(p)) ordered.push(byPath.get(p));
  for (const a of apps) if (!pinnedSet.has(a.path)) ordered.push(a);

  for (const item of ordered) track.appendChild(createDockIcon(item, pinnedSet.has(item.path)));
  const cfg = state.containers['app'] || {};
  applyContainerStyle(wrap, styleForTarget('app'));
  applyDockPosition();
  wrap.classList.remove('hidden');
  requestAnimationFrame(updateDockOverflow);
}

function updateDockOverflow() {
  const dock = $id('dock');
  const track = $id('dock-track');
  if (!dock || !track) return;
  const overflow = track.scrollWidth > dock.clientWidth + 2;
  dock.classList.toggle('has-overflow', overflow);
  if (!overflow) {
    state.dockScroll = 0;
    track.style.transform = '';
  }
  updateDockIconFade();
}

function updateDockIconFade() {
  const dock = $id('dock');
  const track = $id('dock-track');
  if (!dock || !track) return;
  const icons = dock.querySelectorAll('.dock-icon');
  if (!dock.classList.contains('has-overflow')) {
    icons.forEach((ic) => ic.style.removeProperty('--dock-edge-icon-opacity'));
    return;
  }
  const dockRect = dock.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();
  const rightFadeStart = dockRect.right - 72;
  const rightFadeEnd = dockRect.right - 18;
  for (const ic of icons) {
    // 只对右侧做渐隐；渐隐层固定不跟随悬浮放大动效位移。
    const right = trackRect.left + ic.offsetLeft + ic.offsetWidth;
    const rightOpacity = right <= rightFadeStart ? 1 : clamp((rightFadeEnd - right) / (rightFadeEnd - rightFadeStart), 0, 1);
    ic.style.setProperty('--dock-edge-icon-opacity', rightOpacity.toFixed(3));
  }
}

/* 停靠栏定位：6 向预设 + 水平/垂直偏移微调（内联定位，仓库面板跟随 getBoundingClientRect 自动吸附） */
function applyDockPosition() {
  const wrap = $id('dock-wrap');
  const s = settings();
  const pos = s.dockPosition || 'bottom-center';
  const ox = clamp(Number(s.dockOffsetX) || 0, -600, 600);
  const oy = clamp(Number(s.dockOffsetY) || 0, -300, 300);
  const EDGE = 4, MARGIN = 16, BOTTOM_M = 64, TOP_M = 16;
  const isTop = pos.indexOf('top') === 0;
  const anchor = pos.slice(pos.indexOf('-') + 1);
  if (isTop) {
    wrap.style.top = Math.max(EDGE, TOP_M + oy) + 'px';
    wrap.style.bottom = 'auto';
  } else {
    wrap.style.bottom = Math.max(EDGE, BOTTOM_M - oy) + 'px';
    wrap.style.top = 'auto';
  }
  if (anchor === 'center') {
    wrap.style.left = 'calc(50% + ' + ox + 'px)';
    wrap.style.right = 'auto';
    wrap.style.transform = 'translateX(-50%)';
  } else if (anchor === 'left') {
    wrap.style.left = Math.max(EDGE, MARGIN + ox) + 'px';
    wrap.style.right = 'auto';
    wrap.style.transform = 'none';
  } else {
    wrap.style.right = Math.max(EDGE, MARGIN - ox) + 'px';
    wrap.style.left = 'auto';
    wrap.style.transform = 'none';
  }
}

function createDockIcon(item, pinned) {
  const d = el('div', 'dock-icon');
  d.dataset.path = item.path;
  d.title = item.name;
  if (pinned) d.appendChild(el('span', 'pin-dot', '📌'));
  const fallback = el('span', 'fallback', (item.name || '?').trim().charAt(0).toUpperCase());
  const img = el('img', 'hidden');
  img.alt = '';
  d.appendChild(fallback);
  d.appendChild(img);
  loadIcon(item, img, fallback);
  d.addEventListener('dblclick', () => openItem(item));
  d.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showDockItemMenu(e.clientX, e.clientY, item, pinned);
  });
  return d;
}

function togglePin(path) {
  if (state.hiddenItems[path]) {
    delete state.hiddenItems[path];
    scheduleSave();
  }
  const idx = state.pinned.indexOf(path);
  if (idx >= 0) state.pinned.splice(idx, 1);
  else state.pinned.push(path);
  api.savePinned([...state.pinned]).then(() => buildDock());
}

function buildWarehouse() {
  const panel = $id('warehouse');
  const grid = $id('wh-grid');
  grid.innerHTML = '';
  const apps = appItems();
  $id('wh-title').textContent = '应用仓库（' + apps.length + '）';
  applyWarehouseStyle();
  const searchBox = $id('wh-search');
  if (searchBox) { searchBox.value = ''; searchBox.blur(); }
  const pinnedSet = new Set(state.pinned);
  for (const item of apps) {
    const w = el('div', 'wh-item');
    w.dataset.path = item.path;
    w.dataset.name = (item.name || '').toLowerCase();
    w.title = item.name;
    if (pinnedSet.has(item.path)) w.appendChild(el('span', 'pin-dot', '📌'));
    const fallback = el('span', 'fallback', (item.name || '?').trim().charAt(0).toUpperCase());
    const img = el('img', 'hidden');
    img.alt = '';
    w.appendChild(fallback);
    w.appendChild(img);
    w.appendChild(el('span', 'wh-name', item.name));
    loadIcon(item, img, fallback);
    w.addEventListener('dblclick', () => openItem(item));
    w.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDockItemMenu(e.clientX, e.clientY, item, pinnedSet.has(item.path));
    });
    grid.appendChild(w);
  }
  panel.classList.remove('hidden');
  // 定位到停靠栏正上方（停靠栏在上半屏时改为在下方弹出，避免面板跑出屏幕）
  requestAnimationFrame(() => {
    const dockRect = $id('dock-wrap').getBoundingClientRect();
    const pw = panel.offsetWidth || 440;
    const ph = panel.offsetHeight || 300;
    const x = clamp(dockRect.left + dockRect.width / 2 - pw / 2, 8, Math.max(8, window.innerWidth - pw - 8));
    const above = dockRect.top > window.innerHeight / 2;
    const y = above ? Math.max(8, dockRect.top - ph - 10) : dockRect.bottom + 10;
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
  });
}

function applyWhFilter(q) {
  const grid = $id('wh-grid');
  if (!grid) return;
  let visible = 0;
  for (const it of grid.querySelectorAll('.wh-item')) {
    const hit = !q || (it.dataset.name || '').includes(q);
    it.style.display = hit ? '' : 'none';
    if (hit) visible++;
  }
  const empty = grid.querySelector('.wh-empty');
  if (q && visible === 0) {
    if (!empty) {
      const e = el('div', 'wh-empty', '未找到匹配的应用');
      grid.appendChild(e);
    }
  } else if (empty) {
    empty.remove();
  }
}

function toggleWarehouse() {
  state.warehouseOpen = !state.warehouseOpen;
  if (state.warehouseOpen) buildWarehouse();
  else {
    $id('warehouse').classList.add('hidden');
    const sb = $id('wh-search');
    if (sb) sb.blur();
    api.focusMode(false);
  }
}

/* 仓库外观跟随停靠栏的质感/主色，与其它窗口风格一致 */
function applyWarehouseStyle() {
  const panel = $id('warehouse');
  const cfg = state.containers['app'] || {};
  const style = styleForTarget('app');
  panel.style.setProperty('--accent', style.color || '#7aa2ff');
  panel.dataset.texture = style.texture || 'frosted';
  if (style.textureImage) panel.style.setProperty('--texture-image', 'url(' + style.textureImage + ')');
  else panel.style.removeProperty('--texture-image');
}

function showDockItemMenu(x, y, item, pinned) {
  menuEl.innerHTML = '';
  addMenuRow('▶ 打开', () => openItem(item));
  addMenuRow('📂 打开所在位置', () => api.reveal(item.path));
  menuEl.appendChild(el('div', 'menu-sep'));
  addMenuRow(pinned ? '📌 取消置顶' : '📌 置顶常驻', () => togglePin(item.path));
  if (item.manual) {
    menuEl.appendChild(el('div', 'menu-sep'));
    addMenuRow('🗑 移除手动添加', async () => {
      const data = await api.manualRemove(item.path);
      applyPushData(data);
    }, true);
  }
  menuEl.appendChild(el('div', 'menu-sep'));
  addMenuRow('🙈 隐藏此条目', () => {
    state.hiddenItems[item.path] = true;
    scheduleSave();
    buildDock();
    buildContainers();
    if (state.warehouseOpen) buildWarehouse();
    toast('已隐藏「' + item.name + '」', 4000, '↺ 撤销', () => {
      delete state.hiddenItems[item.path];
      scheduleSave();
      render();
      if (state.warehouseOpen) buildWarehouse();
    });
  }, true);
  positionMenu(x, y);
  menuEl.classList.remove('hidden');
}

/* ---------------- 拖放手动添加 ---------------- */
function dragHasFiles(e) {
  return Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
}
function enableDropTarget(el, categoryId) {
  if (!el || el.dataset.dropBound) return;
  el.dataset.dropBound = '1';
  el.addEventListener('dragover', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-target');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !file.path) return;
    api.manualAdd(file.path, categoryId).then((data) => {
      if (data) applyPushData(data);
      toast('已添加到「' + catLabel(categoryId) + '」：' + (file.name || ''));
    }).catch(() => {});
  });
}

/* ---------------- 容器交互：展开 / 单独打开 ---------------- */
function toggleExpanded(id) {
  if (state.focusedId) {
    toggleFocus(id);
    return;
  }
  if (state.collapsePending) return;
  const opening = state.expandedId !== id;
  if (!opening) {
    collapseExpanded(id);
    return;
  }
  if (state.expandedId) {
    state.pendingExpand = id;
    collapseExpanded(state.expandedId);
    return;
  }
  expandCollapsed(id);
}

// 主分类列内、排在当前条目之后且没有被用户独立拖出的分类条。
// 以分类顺序而不是当前 top 判定，避免之前发生过底部重叠后无法恢复正常队列。
function managedFollowers(id) {
  const order = rightColumnOrder();
  const index = order.indexOf(id);
  if (index < 0) return [];
  return order.slice(index + 1)
    .map((followerId) => ({ id: followerId, cont: containerEl(followerId), cfg: state.containers[followerId] }))
    .filter(({ cont, cfg }) => cont && cfg && !cfg.userMoved);
}

function followerStackReserve(followers) {
  if (!followers.length) return 0;
  return followers.length * HEADER_H + (followers.length - 1) * GAP;
}

function followerStackTop(cont, panelHeight, index) {
  return cont.offsetTop + panelHeight + GAP + index * (HEADER_H + GAP);
}

function expandCollapsed(id) {
  const cont = containerEl(id);
  if (!cont) {
    state.expandedId = id;
    state.windowMotion = { id, kind: 'expand', token: ++state.windowMotionSeq };
    render();
    return;
  }
  const head = cont.querySelector('.cont-head');
  const body = cont.querySelector('.cont-body');
  const natural = (head ? head.offsetHeight : 0) + (body ? body.scrollHeight : 0) + 12;
  const maxY = state.viewport.height - 76;
  const followers = managedFollowers(id);
  // 为下面每个收起条预留自己的高度和间距。内容过多时展开区域改为可滚动，
  // 不再把所有分类条分别钳到同一个底部坐标而产生无规则重叠。
  const available = maxY - cont.offsetTop - GAP - followerStackReserve(followers);
  const minHeight = Math.max(HEADER_H, Math.min(90, available));
  const targetHeight = clamp(natural, minHeight, Math.max(minHeight, available));
  state.expandedId = id;
  const cfg = getContainerConfig(id);
  cfg.h = targetHeight;
  animateFollowersOnExpand(cont, targetHeight, followers);
  cont.classList.remove('collapsed');
  cont.classList.add('expand-live');
  cont.style.height = targetHeight + 'px';
  const finishExpand = (e) => {
    if (e.propertyName !== 'height') return;
    cont.classList.remove('expand-live');
    cont.removeEventListener('transitionend', finishExpand);
  };
  cont.addEventListener('transitionend', finishExpand);
}

function collapseExpanded(id) {
  const cont = containerEl(id);
  if (!cont) {
    state.expandedId = null;
    render();
    return;
  }
  state.collapsePending = id;
  animateFollowersOnCollapse(id, cont);
  cont.classList.add('collapse-motion', 'collapse-bottom-up');
  cont.style.pointerEvents = 'none';
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    state.collapsePending = null;
    state.expandedId = null;
    const next = state.pendingExpand;
    state.pendingExpand = null;
    if (next) expandCollapsed(next);
    else render();
  };
  cont.addEventListener('animationend', finish, { once: true });
  const duration = clamp(Number(settings().panelTransitionDuration) || 620, 250, 1200);
  setTimeout(finish, duration + 80);
}

/* 收起时同列、且被展开窗口挤到下方的分类条同步上移；只动画 top，避免玻璃材质的 transform 采样错位。 */
function animateFollowersOnCollapse(id, cont) {
  const followers = managedFollowers(id);
  followers.forEach(({ cont: other }, index) => {
    other.classList.add('collapse-follow');
    // 与当前条目的收缩同步恢复到统一列的标准间距，保证此前的溢出队列也能整齐复原。
    other.style.top = followerStackTop(cont, HEADER_H, index) + 'px';
    other.addEventListener('transitionend', () => other.classList.remove('collapse-follow'), { once: true });
  });
}

function animateFollowersOnExpand(cont, targetHeight, followers) {
  followers.forEach(({ cont: other }, index) => {
    other.classList.add('expand-follow');
    other.style.top = followerStackTop(cont, targetHeight, index) + 'px';
    other.addEventListener('transitionend', () => other.classList.remove('expand-follow'), { once: true });
  });
}

function toggleFocus(id) {
  if (state.focusedId === id) {
    state.focusedId = null;
    state.expandedId = null;
  } else {
    state.focusedId = id;
    state.expandedId = null;
    state.windowMotion = { id, kind: 'focus', token: ++state.windowMotionSeq };
  }
  render();
}

function bindContainerInteractions(cont, id, cfg, focusBtn) {
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
  cont.querySelector('.cont-head').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.cont-focus-btn')) return;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    ox = cont.offsetLeft; oy = cont.offsetTop;
    try { cont.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  cont.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    cont.classList.add('dragging');
    cont.style.left = clamp(ox + dx, 4, Math.max(4, state.viewport.width - 160)) + 'px';
    cont.style.top = clamp(oy + dy, 4, Math.max(4, state.viewport.height - 50)) + 'px';
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      cont.classList.remove('dragging');
      const side = settings().rightSide === 'left' ? 'left' : 'right';
      const railX = side === 'right'
        ? Math.max(4, state.viewport.width - 16 - cont.offsetWidth)
        : 16;
      const canSnapToRail = Math.abs(cont.offsetLeft - railX) <= 72;

      if (canSnapToRail) {
        // 不保留手动坐标：重新交给统一分类列管理，才能参与展开/收起时的让位动画。
        cfg.userMoved = false;
        cfg.reattached = true;
        cfg.reattachedAt = Date.now();
        cfg.x = null;
        cfg.y = null;
        cont.classList.add('rail-snap');
        requestAnimationFrame(() => {
          layoutRightColumn();
          window.setTimeout(() => cont.classList.remove('rail-snap'), 360);
        });
      } else {
        cfg.x = cont.offsetLeft;
        cfg.y = cont.offsetTop;
        cfg.userMoved = true;
        cfg.reattached = false;
        cfg.reattachedAt = null;
      }
      scheduleSave();
    } else {
      toggleExpanded(id);
    }
  };
  cont.addEventListener('pointerup', endDrag);
  cont.addEventListener('pointercancel', endDrag);

  focusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFocus(id);
  });

  cont.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.cell') || e.target.closest('.rec-row') || e.target.closest('.list-row')) return;
    e.preventDefault();
    showContainerMenu(e.clientX, e.clientY, id, cont);
  });
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    api.saveContainers({ ...state.containers }).catch(() => {});
    api.saveHidden({ ...state.hiddenItems }).catch(() => {});
  }, 500);
}

/* ---------------- 布局 ---------------- */
function layoutRightColumn() {
  const maxY = state.viewport.height - 76;
  const side = settings().rightSide === 'left' ? 'left' : 'right';

  if (state.focusedId) {
    const fcfg = state.containers[state.focusedId];
    const fcont = containerEl(state.focusedId);
    if (fcfg && fcont) {
      const head = fcont.querySelector('.cont-head');
      const body = fcont.querySelector('.cont-body');
      const contentH = (head ? head.offsetHeight : 0) + (body ? body.scrollHeight : 0) + 12;
      const w = Math.min(FOCUS_W, state.viewport.width - 80);
      const h = clamp(contentH, 200, Math.max(200, state.viewport.height - 140));
      fcont.style.width = w + 'px';
      fcont.style.height = h + 'px';
      fcont.style.left = Math.max(8, Math.round((state.viewport.width - w) / 2)) + 'px';
      fcont.style.top = Math.max(8, Math.round((state.viewport.height - h) / 2)) + 'px';
      fcont.classList.remove('collapsed');
    }
  }

  let y = 16;
  for (const id of rightColumnOrder()) {
    if (state.focusedId === id) continue;
    const cfg = state.containers[id];
    const cont = containerEl(id);
    if (!cfg || !cont) continue;
    const isExpanded = !state.focusedId && state.expandedId === id;
    const head = cont.querySelector('.cont-head');

    if (isExpanded) {
      cont.classList.remove('collapsed');
      const body = cont.querySelector('.cont-body');
      const natural = (head ? head.offsetHeight : 0) + (body ? body.scrollHeight : 0) + 12;
      const followers = managedFollowers(id);
      const available = maxY - y - GAP - followerStackReserve(followers);
      const minHeight = Math.max(HEADER_H, Math.min(90, available));
      const h = clamp(natural, minHeight, Math.max(minHeight, available));
      cont.style.height = h + 'px';
      cfg.h = h;
    } else {
      cont.classList.add('collapsed');
      cont.style.height = HEADER_H + 'px';
      cfg.h = HEADER_H;
    }

    if (!cfg.userMoved) {
      const w = cont.offsetWidth || DEF_W;
      cfg.x = side === 'right'
        ? Math.max(4, state.viewport.width - 16 - w)
        : 16;
      cfg.y = y;
    }
    cont.style.left = cfg.x + 'px';
    cont.style.top = cfg.y + 'px';
    y = Math.max(y, cfg.y + cont.offsetHeight + GAP);
  }
}

/* ---------------- 条目交互 ---------------- */
function bindCellInteractions(target, item) {
  target.addEventListener('dblclick', () => openItem(item));
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showItemMenu(e.clientX, e.clientY, item, target);
  });
}

function openItem(item) {
  api.open(item.path).then((res) => {
    if (res && res.recommended) {
      state.data.recommended = res.recommended;
      render();
    }
    if (res && !res.ok) toast('无法打开：' + (res.error || '未知错误'), 3200);
  }).catch(() => {});
}

/* ---------------- 右键菜单 ---------------- */
const menuEl = $id('context-menu');
function hideMenu() { menuEl.classList.add('hidden'); menuEl.innerHTML = ''; }

function positionMenu(x, y) {
  menuEl.style.left = x + 'px';
  menuEl.style.top = y + 'px';
  requestAnimationFrame(() => {
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = clamp(x, 4, Math.max(4, window.innerWidth - r.width - 4)) + 'px';
    menuEl.style.top = clamp(y, 4, Math.max(4, window.innerHeight - r.height - 4)) + 'px';
  });
}

function addMenuRow(label, fn, danger) {
  const row = el('div', 'menu-item' + (danger ? ' danger' : ''), label);
  row.addEventListener('click', () => { hideMenu(); fn(); });
  menuEl.appendChild(row);
}

function showContainerMenu(x, y, id, cont) {
  menuEl.innerHTML = '';
  addMenuRow('⚙ 设置', () => openSettings());
  menuEl.appendChild(el('div', 'menu-sep'));
  addMenuRow(`🎨 外观与动效（${id === 'app' ? '应用停靠栏' : catLabel(id)}）`, () => openStylePanel(id, cont));
  menuEl.appendChild(el('div', 'menu-sep'));
  if (state.focusedId === id) {
    addMenuRow('← 收起回原位', () => toggleFocus(id));
  } else if (state.expandedId === id) {
    addMenuRow('＋ 收起此条', () => toggleExpanded(id));
  }
  if (id !== 'app') {
    addMenuRow('📐 重置归位', () => {
      const cfg = state.containers[id];
      if (cfg) {
        cfg.userMoved = false;
        cfg.reattached = false;
        cfg.reattachedAt = null;
        cfg.x = null;
        cfg.y = null;
        cfg.h = HEADER_H;
      }
      scheduleSave();
      render();
    });
    addMenuRow('🙈 隐藏此容器', () => {
      const cfg = state.containers[id];
      if (cfg) { cfg.hidden = true; scheduleSave(); }
      render();
    });
  }
  addMenuRow('↻ 重新扫描桌面', () => doRefresh());
  positionMenu(x, y);
  menuEl.classList.remove('hidden');
}

function showItemMenu(x, y, item, target) {
  menuEl.innerHTML = '';
  addMenuRow('▶ 打开', () => openItem(item));
  addMenuRow('📂 打开所在位置', () => api.reveal(item.path));
  menuEl.appendChild(el('div', 'menu-sep'));
  menuEl.appendChild(el('div', 'menu-cat', '更改分类'));
  const catList = el('div', 'menu-cat-list');
  for (const c of state.data.categories) {
    const chip = el('button', 'chip' + (item.category === c.id ? ' active' : ''), c.label);
    chip.addEventListener('click', async () => {
      hideMenu();
      const data = await api.setCategory(item.path, c.id === item.category ? null : c.id);
      applyPushData(data);
    });
    catList.appendChild(chip);
  }
  menuEl.appendChild(catList);
  menuEl.appendChild(el('div', 'menu-sep'));
  if (item.manual) {
    addMenuRow('🗑 移除手动添加', async () => {
      const data = await api.manualRemove(item.path);
      applyPushData(data);
    }, true);
  }
  addMenuRow('🙈 隐藏此条目', () => {
    state.hiddenItems[item.path] = true;
    scheduleSave();
    target.remove();
    render();
    toast('已隐藏「' + item.name + '」', 4000, '↺ 撤销', () => {
      delete state.hiddenItems[item.path];
      scheduleSave();
      render();
    });
  }, true);
  positionMenu(x, y);
  menuEl.classList.remove('hidden');
}

/* ---------------- 外观与动效面板（逐窗口） ---------------- */
function openStylePanel(id, cont) {
  state.selectedContainer = id;
  selectAppearanceTarget(id);
  switchSettingsTab('appearance');
  $id('settings-panel').classList.remove('hidden');
  applySettingsUI();
}

function selectAppearanceTarget(id) {
  state.selectedContainer = id;
  $id('style-target').textContent = styleTargetLabel(id);
  document.querySelectorAll('#appearance-targets .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.target === id));
  fillStylePanel(styleForTarget(id));
}

function switchSettingsTab(name) {
  document.querySelectorAll('.stab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.stab-page').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== name));
}

function containerEl(id) {
  if (id === 'app') return $id('dock-wrap');
  return document.querySelector(`.container[data-id="${CSS.escape(id)}"]`);
}

function fillStylePanel(style) {
  $id('st-color').value = style.color || '#7aa2ff';
  $id('st-opacity').value = Math.round((style.opacity ?? 0.9) * 100);
  $id('st-opacity-val').textContent = (style.opacity ?? 0.9).toFixed(2);
  $id('st-content-opacity').value = Math.round((style.contentOpacity ?? 1) * 100);
  $id('st-content-opacity-val').textContent = (style.contentOpacity ?? 1).toFixed(2);
  $id('st-radius').value = style.radius ?? 16;
  $id('st-radius-val').textContent = (style.radius ?? 16) + 'px';
  $id('st-border').checked = style.border !== false;
  const av = style.anim || '';
  document.querySelectorAll('#an-type-row .mini-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === av));
  $id('an-hover').checked = hoverEnabled(style);
  const isDock = state.selectedContainer === 'app';
  $id('st-opacity-field').classList.toggle('hidden', isDock);
  $id('st-content-opacity-field').classList.toggle('hidden', isDock);
  $id('dock-opacity-fields').classList.toggle('hidden', !isDock);
  if (isDock) {
    const g = settings();
    const bg = Math.round((style.bgOpacity ?? g.dockBgOpacity ?? 0.9) * 100);
    const ic = Math.round((style.iconOpacity ?? g.dockIconOpacity ?? 1) * 100);
    $id('st-bg-opacity').value = bg;
    $id('st-bg-opacity-val').textContent = (bg / 100).toFixed(2);
    $id('st-icon-opacity').value = ic;
    $id('st-icon-opacity-val').textContent = (ic / 100).toFixed(2);
  }
  buildTextureGrid(style.texture || 'frosted');
}

function buildTextureGrid(activeId) {
  const grid = $id('st-textures');
  grid.innerHTML = '';
  for (const t of TEXTURES) {
    const cell = el('div', 'texture-cell ' + t.cls + (t.id === activeId ? ' active' : ''), t.label);
    cell.addEventListener('click', () => updateStyle({ texture: t.id }));
    grid.appendChild(cell);
  }
}

function updateStyle(patch) {
  const id = state.selectedContainer;
  if (!id) return;
  const next = { ...styleForTarget(id), ...patch };
  for (const k of ['anim']) {
    if (next[k] === '' || next[k] === null || next[k] === undefined) delete next[k];
  }
  if (id === 'categories') {
    state.data.settings.categoryStyle = next;
    for (const [containerId, cfg] of Object.entries(state.containers)) {
      if (containerId === 'app') continue;
      delete cfg.style;
      api.applyStyle(containerId, null).catch(() => {});
    }
    api.setSettings({ categoryStyle: next }).catch(() => {});
    render();
    return;
  }
  const cfg = state.containers[id] || (state.containers[id] = getContainerConfig(id));
  const cont = containerEl(id);
  if (cont) applyContainerStyle(cont, next);
  cfg.style = Object.keys(next).length ? next : null;
  if (id === 'app' && state.warehouseOpen) applyWarehouseStyle();
  api.applyStyle(id, cfg.style).then(() => {}).catch(() => {});
}

/* ---------------- 设置 ---------------- */
function openSettings() {
  if (!state.selectedContainer) {
    state.selectedContainer = 'app';
  }
  $id('settings-panel').classList.remove('hidden');
  selectAppearanceTarget(state.selectedContainer);
  applySettingsUI();
  applyAppInfo();
}

function applySettingsUI() {
  const s = settings();
  const panelTransitionDuration = clamp(Number(s.panelTransitionDuration) || 620, 250, 1200);
  document.documentElement.style.setProperty('--panel-motion-dur', panelTransitionDuration + 'ms');
  $id('set-recommend').value = s.recommendCount ?? 8;
  $id('set-recommend-val').textContent = String(s.recommendCount ?? 8);
  $id('set-autostart').checked = Boolean(s.autoStart);
  $id('set-hwaccel').checked = s.hardwareAcceleration !== false;
  $id('set-hideicons').checked = Boolean(state.data.iconsHidden);
  $id('set-dock-size').value = s.dockIconSize || 38;
  $id('set-dock-size-val').textContent = (s.dockIconSize || 38) + 'px';
  $id('set-dock-wheel-invert').checked = s.dockWheelInvert === true;
  $id('set-anim').checked = s.animEnabled !== false;
  const gAnim = s.animType || 'rise';
  document.querySelectorAll('#set-anim-type-row .mini-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === gAnim));
  $id('set-anim-dur').value = s.animDuration || 300;
  $id('set-anim-dur-val').textContent = (s.animDuration || 300) + 'ms';
  $id('set-panel-transition-dur').value = panelTransitionDuration;
  $id('set-panel-transition-dur-val').textContent = panelTransitionDuration + 'ms';
  $id('set-hover').checked = s.hoverEffect !== false;
  $id('set-dock-magnify').checked = s.dockMagnify !== false;
  const dockPos = s.dockPosition || 'bottom-center';
  document.querySelectorAll('.dock-pos-btn').forEach((b) => b.classList.toggle('active', b.dataset.pos === dockPos));
  $id('set-dock-offset-x').value = Number(s.dockOffsetX) || 0;
  $id('set-dock-offset-x-val').textContent = (Number(s.dockOffsetX) || 0) + 'px';
  $id('set-dock-offset-y').value = Number(s.dockOffsetY) || 0;
  $id('set-dock-offset-y-val').textContent = (Number(s.dockOffsetY) || 0) + 'px';
  const sideRight = s.rightSide !== 'left';
  $id('set-side-left').classList.toggle('active', !sideRight);
  $id('set-side-right').classList.toggle('active', sideRight);
  const note = $id('gpu-note');
  if (s.gpuFallbackActive) {
    note.textContent = '⚠️ 当前以禁用 GPU 模式运行（渲染回退已生效），可在“硬件加速”开启后重启恢复。';
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
  applyHiddenList();
}

/* 已隐藏条目管理：逐个恢复 */
function applyHiddenList() {
  const box = $id('hidden-list');
  if (!box) return;
  box.innerHTML = '';
  const hidden = state.hiddenItems || {};
  const paths = Object.keys(hidden);
  if (paths.length === 0) {
    box.appendChild(el('div', 'hint', '没有已隐藏的条目'));
    return;
  }
  const byPath = new Map((state.data.items || []).map((it) => [it.path, it]));
  for (const p of paths) {
    const item = byPath.get(p) || { path: p, name: p.split(/[\\/]/).pop() || p };
    const row = el('div', 'hidden-row');
    const nameEl = el('span', 'hidden-name', item.name || p);
    nameEl.title = p;
    row.appendChild(nameEl);
    const btn = el('button', 'hidden-restore', '↺ 恢复');
    btn.addEventListener('click', () => {
      delete state.hiddenItems[p];
      scheduleSave();
      applyHiddenList();
      render();
      toast('已恢复：' + (item.name || p));
    });
    row.appendChild(btn);
    box.appendChild(row);
  }
}

async function applyAppInfo() {
  try {
    const info = await api.appInfo();
    $id('about-version').textContent = `灵动桌面 FlowDesk v${info.version}（${info.platform} / ${info.arch}）`;
    $id('about-datadir').textContent = '数据目录：' + info.dataDir;
  } catch { /* ignore */ }
}

async function applyIconsStatus() {
  try {
    const st = await api.iconsStatus();
    if (st && typeof st.hidden === 'boolean') {
      state.data.iconsHidden = st.hidden;
      $id('set-hideicons').checked = st.hidden;
      $id('icons-hint').textContent = st.hidden
        ? '系统桌面图标已隐藏（桌面右键可随时恢复）'
        : '当前系统桌面图标为显示状态';
    }
  } catch { /* ignore */ }
}

async function doRefresh() {
  toast('正在重新扫描桌面…');
  try {
    const data = await api.refresh();
    applyPushData(data);
    toast('扫描完成');
  } catch {
    toast('扫描失败', 3200);
  }
}

async function showAll() {
  for (const id of RIGHT_COL_ORDER.concat(['app'])) {
    if (state.containers[id]) state.containers[id].hidden = false;
  }
  state.hiddenItems = {};
  scheduleSave();
  render();
  toast('已显示所有容器与条目');
}

/* ---------------- 数据推送与迁移 ---------------- */
async function applyPushData(data) {
  state.data = data;
  if (!state.containersLoaded) {
    state.containers = data.config.containers || {};
    state.containersLoaded = true;
  }
  state.hiddenItems = data.config.hiddenItems || {};
  state.pinned = data.config.pinned || [];
  const s = data.settings || {};
  if (!s.layoutVersion || s.layoutVersion < 3) {
    state.containers = {};
    state.expandedId = null;
    state.focusedId = null;
    try {
      await api.saveContainers({});
      await api.setSettings({ layoutVersion: 3 });
    } catch { /* ignore */ }
  }
  render();
}

/* ---------------- 鼠标穿透 ---------------- */
function handleMouseMove(e) {
  const elAt = document.elementFromPoint(e.clientX, e.clientY);
  const over = Boolean(elAt && elAt.closest('.container, #dock-wrap, #warehouse, .menu, .panel'));
  if (over !== state.overSent) {
    state.overSent = over;
    api.mouseover(over);
  }
}

/* ---------------- 事件绑定 ---------------- */
function makeDraggable(panel) {
  const head = panel.querySelector('.panel-head');
  if (!head) return;
  head.style.cursor = 'grab';
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.panel-close')) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    if (panel.style.right && !panel.style.left) {
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
    }
    const sx = e.clientX, sy = e.clientY, ox = rect.left, oy = rect.top;
    const move = (ev) => {
      panel.style.left = clamp(ox + ev.clientX - sx, 0, Math.max(0, window.innerWidth - 80)) + 'px';
      panel.style.top = clamp(oy + ev.clientY - sy, 0, Math.max(0, window.innerHeight - 60)) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function bindUI() {
  makeDraggable($id('settings-panel'));
  document.querySelectorAll('.panel-close').forEach((b) => {
    b.addEventListener('click', () => $id(b.dataset.close).classList.add('hidden'));
  });

  document.querySelectorAll('.stab').forEach((b) => {
    b.addEventListener('click', () => switchSettingsTab(b.dataset.tab));
  });
  document.querySelectorAll('#appearance-targets .seg-btn').forEach((b) => {
    b.addEventListener('click', () => selectAppearanceTarget(b.dataset.target));
  });

  $id('st-color').addEventListener('input', (e) => updateStyle({ color: e.target.value }));
  $id('st-opacity').addEventListener('input', (e) => {
    $id('st-opacity-val').textContent = (e.target.value / 100).toFixed(2);
    updateStyle({ opacity: Number(e.target.value) / 100 });
  });
  $id('st-content-opacity').addEventListener('input', (e) => {
    $id('st-content-opacity-val').textContent = (e.target.value / 100).toFixed(2);
    updateStyle({ contentOpacity: Number(e.target.value) / 100 });
  });
  $id('st-bg-opacity').addEventListener('input', (e) => {
    $id('st-bg-opacity-val').textContent = (e.target.value / 100).toFixed(2);
    updateStyle({ bgOpacity: Number(e.target.value) / 100 });
  });
  $id('st-icon-opacity').addEventListener('input', (e) => {
    $id('st-icon-opacity-val').textContent = (e.target.value / 100).toFixed(2);
    updateStyle({ iconOpacity: Number(e.target.value) / 100 });
  });
  $id('st-radius').addEventListener('input', (e) => {
    $id('st-radius-val').textContent = e.target.value + 'px';
    updateStyle({ radius: Number(e.target.value) });
  });
  $id('st-border').addEventListener('change', (e) => updateStyle({ border: e.target.checked }));
  document.querySelectorAll('#an-type-row .mini-btn').forEach((b) => {
    b.addEventListener('click', () => updateStyle({ anim: b.dataset.type }));
  });
  $id('an-hover').addEventListener('change', (e) => updateStyle({ hover: e.target.checked }));
  $id('st-reset').addEventListener('click', () => {
    if (!state.selectedContainer) return;
    if (state.selectedContainer === 'categories') {
      state.data.settings.categoryStyle = null;
      for (const [id, cfg] of Object.entries(state.containers)) {
        if (id === 'app') continue;
        delete cfg.style;
        api.applyStyle(id, null).catch(() => {});
      }
      api.setSettings({ categoryStyle: null }).then(() => {
        render();
        selectAppearanceTarget('categories');
        toast('已恢复全部分类条默认外观');
      });
      return;
    }
    api.applyStyle(state.selectedContainer, null).then(() => {
      const cfg = state.containers[state.selectedContainer] || {};
      delete cfg.style;
      const cont = containerEl(state.selectedContainer);
      if (cont) applyContainerStyle(cont, styleForTarget(state.selectedContainer));
      fillStylePanel(styleForTarget(state.selectedContainer));
    });
  });

  $id('set-recommend').addEventListener('input', (e) => { $id('set-recommend-val').textContent = e.target.value; });
  $id('set-recommend').addEventListener('change', (e) => {
    applyLocalSettings({ recommendCount: clamp(Number(e.target.value) || 8, 3, 20) }).then(() => doRefresh());
  });
  $id('set-autostart').addEventListener('change', (e) => applyLocalSettings({ autoStart: e.target.checked }));
  $id('set-hwaccel').addEventListener('change', (e) => {
    applyLocalSettings({ hardwareAcceleration: e.target.checked }).then(() => toast('硬件加速设置已保存，重启后生效'));
  });
  $id('set-hideicons').addEventListener('change', async (e) => {
    const st = await api.iconsToggle(e.target.checked);
    if (st && st.hidden !== undefined) {
      $id('set-hideicons').checked = st.hidden;
      $id('icons-hint').textContent = st.hidden ? '系统桌面图标已隐藏（桌面右键可恢复）' : '系统桌面图标已恢复显示';
    }
  });
  $id('btn-clear-usage').addEventListener('click', async () => {
    await api.usageClear();
    toast('使用记录已清空');
    doRefresh();
  });

  $id('set-dock-size').addEventListener('input', (e) => { $id('set-dock-size-val').textContent = e.target.value + 'px'; });
  $id('set-dock-size').addEventListener('change', (e) => {
    applyLocalSettings({ dockIconSize: Number(e.target.value) }).then(() => buildDock());
  });
  $id('set-dock-wheel-invert').addEventListener('change', (e) => {
    applyLocalSettings({ dockWheelInvert: e.target.checked });
  });

  $id('set-anim').addEventListener('change', (e) => {
    applyLocalSettings({ animEnabled: e.target.checked }).then(() => { state.entranceDone = false; render(); });
  });
  document.querySelectorAll('#set-anim-type-row .mini-btn').forEach((b) => {
    b.addEventListener('click', () => {
      applyLocalSettings({ animType: b.dataset.type }).then(() => { state.entranceDone = false; render(); });
    });
  });
  $id('set-anim-dur').addEventListener('input', (e) => { $id('set-anim-dur-val').textContent = e.target.value + 'ms'; });
  $id('set-anim-dur').addEventListener('change', (e) => {
    applyLocalSettings({ animDuration: Number(e.target.value) }).then(() => { state.entranceDone = false; render(); });
  });
  $id('set-panel-transition-dur').addEventListener('input', (e) => {
    const value = clamp(Number(e.target.value) || 620, 250, 1200);
    $id('set-panel-transition-dur-val').textContent = value + 'ms';
    document.documentElement.style.setProperty('--panel-motion-dur', value + 'ms');
  });
  $id('set-panel-transition-dur').addEventListener('change', (e) => {
    applyLocalSettings({ panelTransitionDuration: clamp(Number(e.target.value) || 620, 250, 1200) });
  });
  $id('set-hover').addEventListener('change', (e) => {
    applyLocalSettings({ hoverEffect: e.target.checked }).then(() => render());
  });

  document.querySelectorAll('.dock-pos-btn').forEach((b) => {
    b.addEventListener('click', () => {
      applyLocalSettings({ dockPosition: b.dataset.pos }).then(() => { applyDockPosition(); if (state.warehouseOpen) buildWarehouse(); });
    });
  });
  $id('set-dock-offset-x').addEventListener('input', (e) => { $id('set-dock-offset-x-val').textContent = e.target.value + 'px'; });
  $id('set-dock-offset-x').addEventListener('change', (e) => {
    applyLocalSettings({ dockOffsetX: Number(e.target.value) }).then(() => { applyDockPosition(); if (state.warehouseOpen) buildWarehouse(); });
  });
  $id('set-dock-offset-y').addEventListener('input', (e) => { $id('set-dock-offset-y-val').textContent = e.target.value + 'px'; });
  $id('set-dock-offset-y').addEventListener('change', (e) => {
    applyLocalSettings({ dockOffsetY: Number(e.target.value) }).then(() => { applyDockPosition(); if (state.warehouseOpen) buildWarehouse(); });
  });
  $id('set-dock-magnify').addEventListener('change', (e) => {
    applyLocalSettings({ dockMagnify: e.target.checked }).then(() => buildDock());
  });
  $id('set-side-left').addEventListener('click', () => {
    applyLocalSettings({ rightSide: 'left' }).then(() => render());
  });
  $id('set-side-right').addEventListener('click', () => {
    applyLocalSettings({ rightSide: 'right' }).then(() => render());
  });
  $id('btn-refresh').addEventListener('click', doRefresh);
  $id('btn-show-all').addEventListener('click', showAll);
  $id('btn-restore-all').addEventListener('click', () => {
    state.hiddenItems = {};
    scheduleSave();
    applyHiddenList();
    render();
    toast('已恢复全部已隐藏条目');
  });
  $id('btn-reset-layout').addEventListener('click', async () => {
    state.containers = {};
    state.expandedId = null;
    state.focusedId = null;
    await api.saveContainers({});
    render();
    toast('布局已重置');
  });
  $id('btn-quit').addEventListener('click', () => api.quit());

  // 停靠栏悬浮放大动效（跳跃 + 推开邻居）
  const dockEl = $id('dock');
  const trackEl = $id('dock-track');
  const resetDockIcons = () => {
    dockEl.querySelectorAll('.dock-icon').forEach((ic) => {
      ic.style.transform = ''; ic.style.zIndex = '';
    });
  };
  dockEl.addEventListener('pointermove', (e) => {
    if (settings().dockMagnify === false) { resetDockIcons(); return; }
    const R = 130, R2 = R * 2;
    const icons = dockEl.querySelectorAll('.dock-icon');
    for (const ic of icons) {
      const r = ic.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const d = Math.abs(cx - e.clientX);
      if (d <= R) {
        const m = 1 - d / R;
        const sc = 1 + m * 0.5;
        const ty = -m * 22;
        ic.style.zIndex = '10';
        ic.style.transform = 'scale(' + sc.toFixed(3) + ') translateY(' + ty.toFixed(1) + 'px)';
      } else if (d <= R2) {
        const pm = (1 - (d - R) / R) * 10;
        const dir = cx < e.clientX ? -pm : pm;
        ic.style.zIndex = '5';
        ic.style.transform = 'translateX(' + dir.toFixed(1) + 'px) scale(' + (1 + ((1 - (d - R) / R) * 0.08)).toFixed(3) + ')';
      } else {
        ic.style.transform = '';
        ic.style.zIndex = '';
      }
    }
    updateDockIconFade();
  });
  dockEl.addEventListener('pointerleave', resetDockIcons);
  const scrollDockBy = (dx) => {
    const max = Math.max(0, trackEl.scrollWidth - dockEl.clientWidth);
    dockEl.classList.toggle('has-overflow', max > 2);
    state.dockScroll = clamp((state.dockScroll || 0) + dx, -max, 0);
    trackEl.style.transform = 'translateX(' + state.dockScroll + 'px)';
    updateDockIconFade();
  };
  $id('dock').addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = settings().dockWheelInvert ? -1 : 1;
    scrollDockBy((e.deltaY || e.deltaX) * 1.1 * dir);
  }, { passive: false });
  $id('dock-warehouse').addEventListener('click', toggleWarehouse);
  enableDropTarget($id('dock-wrap'), 'app');
  const whSearch = $id('wh-search');
  if (whSearch) {
    whSearch.addEventListener('input', () => applyWhFilter(whSearch.value.trim().toLowerCase()));
    // focusable:false 的窗口里点击输入框不会触发 focus 事件，必须在 pointerdown 就先切窗口可聚焦
    whSearch.addEventListener('pointerdown', () => {
      api.focusMode(true);
      setTimeout(() => {
        if (document.activeElement !== whSearch) whSearch.focus();
      }, 60);
    });
    whSearch.addEventListener('focus', () => api.focusMode(true));
    whSearch.addEventListener('blur', () => api.focusMode(false));
    // 点击应用内其它区域 / 窗口失焦时退出键盘输入模式，避免窗口一直可聚焦抢焦点
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#wh-search')) return;
      whSearch.blur();
      api.focusMode(false);
    }, true);
    window.addEventListener('blur', () => api.focusMode(false));
  }
  const whClose = document.querySelector('.wh-close');
  if (whClose) whClose.addEventListener('click', toggleWarehouse);
  $id('dock-wrap').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.dock-icon')) return;
    e.preventDefault();
    showContainerMenu(e.clientX, e.clientY, 'app', $id('dock-wrap'));
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) hideMenu();
    if (!e.target.closest('#warehouse') && !e.target.closest('#dock-warehouse') && state.warehouseOpen) {
      state.warehouseOpen = false;
      $id('warehouse').classList.add('hidden');
    }
  });
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.container') && !e.target.closest('#dock-wrap')) hideMenu();
  });
  window.addEventListener('mousemove', handleMouseMove, { passive: true });
  window.addEventListener('resize', () => {
    state.viewport = { width: window.innerWidth, height: window.innerHeight };
    requestAnimationFrame(() => {
      layoutRightColumn();
      updateDockOverflow();
    });
  });

  api.on('flowdesk:show-settings', () => openSettings());
  api.on('flowdesk:data', (data) => applyPushData(data));
  api.on('flowdesk:icons-ready', () => render());
  api.on('flowdesk:viewport', ({ bounds }) => {
    state.viewport = { width: bounds.width, height: bounds.height };
    requestAnimationFrame(() => layoutRightColumn());
  });
  api.on('flowdesk:gpu-fallback', () => {
    toast('检测到渲染异常，已自动切换到兼容模式（禁用 GPU）', 4000);
  });
}

/* ---------------- 启动 ---------------- */
async function boot() {
  bindUI();
  try {
    const data = await api.data();
    await applyPushData(data);
  } catch (err) {
    toast('初始化失败：' + String(err && err.message || err), 5000);
  }
  api.ready();
  api.mouseover(false);
}

boot();
