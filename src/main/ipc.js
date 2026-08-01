'use strict';
/** IPC 处理器注册与共享的数据构建。context: { win, app, configStore, scanner, usage, getSettings, saveSettings, state } */
const fs = require('fs');
const path = require('path');
const { ipcMain, shell } = require('electron');
const { rankItems } = require('./usage');
const { CATEGORIES, extOf } = require('./classifier');

function resolveWin(ctx) {
  return typeof ctx.win === 'function' ? ctx.win() : ctx.win;
}

function toDataUrl(file) {
  try {
    const buf = fs.readFileSync(file);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** 手动拖入的桌面外条目（不在扫描范围内），按存储的分类合并进 items */
function buildManualItems(ctx) {
  const cfg = ctx.getSettings();
  const out = [];
  for (const [p, info] of Object.entries(cfg.manualItems || {})) {
    if (!info || typeof info !== 'object') continue;
    if (ctx.scanner.items.some((it) => it.path === p)) continue; // 桌面已扫描到，走分类覆盖
    let st = null;
    try {
      st = fs.statSync(p);
    } catch {
      continue; // 文件已被移动/删除
    }
    const name = path.basename(p);
    out.push({
      path: p,
      name,
      ext: extOf(name),
      kind: st.isDirectory() ? 'dir' : 'file',
      isDir: st.isDirectory(),
      source: 'manual',
      size: st.isDirectory() ? 0 : st.size,
      mtimeMs: st.mtimeMs,
      mtime: st.mtimeMs ? new Date(st.mtimeMs).toISOString() : null,
      targetPath: '',
      targetArgs: '',
      targetIcon: '',
      category: CATEGORIES.some((c) => c.id === info.category) ? info.category : 'other',
      manual: true,
    });
  }
  return out;
}

function buildData(ctx) {
  const cfg = ctx.getSettings();
  const items = [...ctx.scanner.items, ...buildManualItems(ctx)];
  // 手动加入的桌面外条目同样属于用户工作流，不能被排除在推荐之外。
  const recommended = rankItems(items, ctx.usage.data, { topN: cfg.settings.recommendCount })
    .map(({ item, score }) => ({
      path: item.path, name: item.name, category: item.category, score, isDir: item.isDir, ext: item.ext,
    }));
  return {
    items,
    dirs: ctx.scanner.dirs,
    categories: CATEGORIES,
    settings: cfg.settings,
    config: { containers: cfg.containers || {}, hiddenItems: cfg.hiddenItems || {}, pinned: cfg.pinned || [] },
    recommended,
    iconsHidden: ctx.state.iconsHidden,
    nativeAvailable: ctx.state.nativeAvailable,
    nativeError: ctx.state.nativeError,
  };
}

function registerIpc(ctx) {
  const { app, configStore, scanner, usage } = ctx;
  const iconDataCache = new Map();

  ipcMain.handle('flowdesk:data', () => buildData(ctx));

  ipcMain.handle('flowdesk:refresh', async () => {
    await scanner.scan();
    // 后台补齐新条目图标，完成后通知渲染层重绘（不阻塞扫描响应）
    scanner.ensureIcons(scanner.items, 200).then((okList) => {
      if (okList.length) {
        const win = resolveWin(ctx);
        if (win && !win.isDestroyed()) win.webContents.send('flowdesk:icons-ready');
      }
    }).catch(() => {});
    return buildData(ctx);
  });

  ipcMain.handle('flowdesk:open', async (e, p) => {
    const item = scanner.items.find((it) => it.path === p);
    if (!item) {
      // 手动添加的条目（桌面范围外）：按真实文件直接打开
      if (!p || !fs.existsSync(p)) return { ok: false, error: '条目不存在' };
      try {
        if (p.toLowerCase().endsWith('.url')) {
          let url = '';
          try {
            const m = /^\s*URL=(.+?)\s*$/im.exec(fs.readFileSync(p, 'utf8'));
            url = (m && m[1]) || '';
          } catch { /* ignore */ }
          if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
          await shell.openExternal(url);
        } else {
          const openError = await shell.openPath(p);
          if (openError) return { ok: false, error: openError };
        }
        usage.recordOpen(p);
        usage.save();
        return { ok: true, recommended: buildData(ctx).recommended };
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
      }
    }
    try {
      if (item.ext === '.url') {
        let url = item.targetPath || '';
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
        await shell.openExternal(url);
      } else {
        const openError = await shell.openPath(item.path);
        if (openError) return { ok: false, error: openError };
      }
      // 仅在系统确认调用成功后记为一次使用，避免无效路径污染推荐。
      usage.recordOpen(p);
      usage.save();
      return { ok: true, recommended: buildData(ctx).recommended };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('flowdesk:reveal', (e, p) => {
    shell.showItemInFolder(p);
    return { ok: true };
  });

  ipcMain.handle('flowdesk:setCategory', async (e, p, category) => {
    const items = configStore.loadCategoryOverrides();
    if (!category) delete items[p];
    else items[p] = category;
    configStore.saveCategoryOverrides(items);
    await scanner.scan();
    return buildData(ctx);
  });

  /** 手动添加：拖文件到某分类窗口/停靠栏。桌面内条目走分类覆盖；桌面外条目存入 manualItems */
  ipcMain.handle('flowdesk:manual:add', (e, p, category) => {
    if (!p || typeof p !== 'string') return buildData(ctx);
    const cat = CATEGORIES.some((c) => c.id === category) ? category : 'other';
    const cfg = configStore.loadConfig();
    cfg.manualItems = cfg.manualItems || {};
    const onDesktop = scanner.items.some((it) => it.path === p);
    if (onDesktop) {
      const items = configStore.loadCategoryOverrides();
      items[p] = cat;
      configStore.saveCategoryOverrides(items);
      delete cfg.manualItems[p];
    } else {
      let isDir = false;
      try {
        isDir = fs.statSync(p).isDirectory();
      } catch { /* 路径无效也照常记录，buildData 会跳过 */ }
      cfg.manualItems[p] = { category: cat, isDir, ts: Date.now() };
    }
    configStore.saveConfig(cfg);
    return buildData(ctx);
  });

  ipcMain.handle('flowdesk:manual:remove', (e, p) => {
    const cfg = configStore.loadConfig();
    if (cfg.manualItems) delete cfg.manualItems[p];
    configStore.saveConfig(cfg);
    const overrides = configStore.loadCategoryOverrides();
    if (overrides[p]) {
      delete overrides[p];
      configStore.saveCategoryOverrides(overrides);
    }
    return buildData(ctx);
  });

  ipcMain.handle('flowdesk:containers:save', (e, containers) => {
    const cfg = configStore.loadConfig();
    const next = {};
    for (const [id, v] of Object.entries(containers || {})) {
      if (!v) continue;
      const cur = (cfg.containers || {})[id] || {};
      next[id] = {
        x: Number.isFinite(v.x) ? Math.round(v.x) : cur.x,
        y: Number.isFinite(v.y) ? Math.round(v.y) : cur.y,
        w: Number.isFinite(v.w) ? Math.max(160, Math.round(v.w)) : cur.w,
        h: Number.isFinite(v.h) ? Math.max(100, Math.round(v.h)) : cur.h,
        hidden: typeof v.hidden === 'boolean' ? v.hidden : Boolean(cur.hidden),
        collapsed: typeof v.collapsed === 'boolean' ? v.collapsed : Boolean(cur.collapsed),
        style: v.style || cur.style,
        userMoved: typeof v.userMoved === 'boolean' ? v.userMoved : Boolean(cur.userMoved),
        reattached: typeof v.reattached === 'boolean' ? v.reattached : Boolean(cur.reattached),
        reattachedAt: Number.isFinite(v.reattachedAt) ? Math.round(v.reattachedAt) : cur.reattachedAt,
      };
    }
    cfg.containers = next;
    configStore.saveConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle('flowdesk:pinned:save', (e, pinned) => {
    const cfg = configStore.loadConfig();
    cfg.pinned = Array.isArray(pinned) ? pinned.filter(Boolean).slice(0, 200) : [];
    configStore.saveConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle('flowdesk:hidden:save', (e, hiddenItems) => {
    const cfg = configStore.loadConfig();
    const next = {};
    for (const [p, v] of Object.entries(hiddenItems || {})) {
      if (v) next[p] = true;
    }
    cfg.hiddenItems = next;
    configStore.saveConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle('flowdesk:style', (e, id, style) => {
    const cfg = configStore.loadConfig();
    const cur = (cfg.containers || {})[id] || {};
    cfg.containers[id] = { ...cur, style: style || null };
    configStore.saveConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle('flowdesk:hideItem', (e, p, hidden) => {
    const cfg = configStore.loadConfig();
    cfg.hiddenItems = cfg.hiddenItems || {};
    if (hidden) cfg.hiddenItems[p] = true;
    else delete cfg.hiddenItems[p];
    configStore.saveConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle('flowdesk:settings:get', () => buildData(ctx).settings);

  ipcMain.handle('flowdesk:settings:set', (e, patch) => {
    const cfg = configStore.loadConfig();
    cfg.settings = { ...cfg.settings, ...(patch || {}) };
    configStore.saveConfig(cfg);
    if (typeof patch.autoStart === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.autoStart });
    }
    return { ok: true, settings: cfg.settings };
  });

  ipcMain.handle('flowdesk:icon', async (e, p, mtimeMs) => {
    const key = `${p}|${mtimeMs}`;
    if (iconDataCache.has(key)) return iconDataCache.get(key);
    let item = scanner.items.find((it) => it.path === p);
    if (!item) {
      // 手动添加的桌面外条目：按需提取真实图标
      if (!p || !fs.existsSync(p)) return null;
      const st = fs.statSync(p);
      item = { path: p, mtimeMs: st.mtimeMs, name: path.basename(p), ext: extOf(path.basename(p)), isDir: st.isDirectory() };
      const file = await scanner.ensureIcon(item);
      if (file) {
        const url = toDataUrl(file);
        iconDataCache.set(key, url);
        return url;
      }
      return null;
    }
    const file = scanner.iconCachePath(item);
    if (!fs.existsSync(file)) return null;
    const url = toDataUrl(file);
    iconDataCache.set(key, url);
    return url;
  });

  ipcMain.handle('flowdesk:icons:status', async () => ({ hidden: await require('./win32').getDesktopIconsHidden() }));

  ipcMain.handle('flowdesk:icons:toggle', async (e, hidden) => {
    const res = await require('./win32').toggleDesktopIcons(hidden);
    ctx.state.iconsHidden = res.hidden === null ? hidden : res.hidden === 1;
    return { hidden: ctx.state.iconsHidden, refreshed: res.refreshed, ok: res.ok };
  });

  ipcMain.handle('flowdesk:usage:clear', () => {
    usage.data = { version: 2, items: {} };
    usage.save();
    return { ok: true };
  });

  ipcMain.handle('flowdesk:style:all', (e, style) => {
    const cfg = configStore.loadConfig();
    cfg.containers = cfg.containers || {};
    for (const id of Object.keys(cfg.containers)) {
      cfg.containers[id] = { ...(cfg.containers[id] || {}), style: style || null };
    }
    cfg.containers['app'] = { ...(cfg.containers['app'] || {}), style: style || null };
    configStore.saveConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle('flowdesk:app:info', () => ({
    version: app.getVersion(),
    dataDir: configStore.dataDir,
    arch: process.arch,
    platform: process.platform,
  }));

  ipcMain.on('flowdesk:mouseover', (e, over) => {
    const win = resolveWin(ctx);
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!over, { forward: true });
  });

  // 搜索框等需要键盘输入时临时切换窗口可聚焦（输入结束恢复，避免抢焦点）
  ipcMain.on('flowdesk:focus-mode', (e, on) => {
    const win = resolveWin(ctx);
    if (!win || win.isDestroyed()) return;
    if (on) {
      win.setFocusable(true);
      win.focus();
    } else {
      win.setFocusable(false);
      win.blur();
    }
  });

  ipcMain.on('flowdesk:renderer-ready', () => {
    ctx.state.rendererReadyAt = Date.now();
  });

  ipcMain.on('flowdesk:quit', () => app.quit());
}

module.exports = { registerIpc, buildData };
