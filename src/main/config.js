'use strict';
/** 配置与数据存储：%APPDATA%\FlowDesk，写入失败回退到应用目录 ./data（可单测，依赖注入）。 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_SETTINGS = {
  recommendCount: 8,
  autoStart: false,
  hardwareAcceleration: true,
  iconSize: 64,
  cardWidth: 200,
  cardHeight: 236,
  cardGap: 24,
  hiddenIcons: false,
  layoutVersion: 3, // 布局版本（>=3 表示使用新版停靠栏 + 分类条布局，含外观/动效持久化）
  dockIconSize: 38,
  dockBgOpacity: 0.9,  // 停靠栏背景透明度（0.1-1）
  dockIconOpacity: 1,  // 停靠栏图标透明度（0.1-1）
  dockPosition: 'bottom-center', // 停靠栏位置: bottom-center/bottom-left/bottom-right/top-center/top-left/top-right
  dockOffsetX: 0,  // 停靠栏水平偏移（px，正数向右）
  dockOffsetY: 0,  // 停靠栏垂直偏移（px，正数向下）
  dockMagnify: true,  // 停靠栏悬浮放大动效
  dockWheelInvert: false,  // 反转停靠栏滚轮方向（false=滚轮向上看右侧应用，true=相反）
  rightSide: 'right',
  animEnabled: true,
  animType: 'rise',
  animDuration: 300,
  panelTransitionDuration: 620, // 分类展开与单独打开窗口的过渡时长（ms）
  categoryStyle: null, // 所有分类条共享的外观；单个分类条可通过 containers[id].style 覆盖
  hoverEffect: true,
  hideOnFullscreen: true, // 全屏应用/游戏时自动隐藏悬浮层
  language: 'zh-CN',
};

const DEFAULT_CONFIG = {
  version: 3,
  settings: { ...DEFAULT_SETTINGS },
  containers: {},   // categoryId -> { x, y, w, h, style?, hidden?, collapsed?, autoFit? }
  hiddenItems: {},  // path -> true 表示该条目已隐藏（可从设置恢复）
  pinned: [],       // 置顶常驻的分类条 id 列表
  manualItems: {},  // 手动拖入的桌面外条目: path -> { category, isDir }
};

function probeWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok', { encoding: 'utf8' });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 找到可写的数据目录。
 * 优先级：%APPDATA%\FlowDesk -> %LOCALAPPDATA%\FlowDesk -> 用户主目录/.flowdesk -> <appDir>/data -> 系统临时目录。
 */
function resolveDataDir({ appData, localAppData, home, appDir, cwd } = {}) {
  const candidates = [
    appData && path.join(appData, 'FlowDesk'),
    localAppData && path.join(localAppData, 'FlowDesk'),
    home && path.join(home, '.flowdesk'),
    appDir && path.join(appDir, 'data'),
    cwd && path.join(cwd, 'data'),
    path.join(os.tmpdir(), 'flowdesk-data'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (probeWritable(dir)) return dir;
  }
  return candidates[candidates.length - 1];
}

function defaultEnv() {
  return {
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    home: os.homedir(),
    appDir: process.env.FLOWDESK_APP_DIR || process.cwd(),
    cwd: process.cwd(),
  };
}

/** 读取 JSON，缺失/损坏时回退默认值并备份损坏文件 */
function loadJson(file, defaults) {
  try {
    if (!fs.existsSync(file)) return structuredClone(defaults);
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
    return structuredClone(defaults);
  } catch (err) {
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    return structuredClone(defaults);
  }
}

/** 原子写入 JSON（临时文件 + rename） */
function saveJsonAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 深度合并（用于默认配置与用户配置合并） */
function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override !== undefined ? structuredClone(override) : structuredClone(base);
  }
  if (base && override && typeof base === 'object' && typeof override === 'object') {
    const out = structuredClone(base);
    for (const [k, v] of Object.entries(override)) {
      out[k] = v !== undefined ? deepMerge(base[k], v) : out[k];
    }
    return out;
  }
  return override !== undefined ? override : base;
}

class ConfigStore {
  constructor({ dataDir } = {}) {
    this.dataDir = dataDir || resolveDataDir(defaultEnv());
    this.configFile = path.join(this.dataDir, 'config.json');
    this.usageFile = path.join(this.dataDir, 'usage.json');
    this.categoriesFile = path.join(this.dataDir, 'categories.json');
    this.iconsDir = path.join(this.dataDir, 'icons');
  }

  loadConfig() {
    const raw = loadJson(this.configFile, DEFAULT_CONFIG);
    const merged = deepMerge(DEFAULT_CONFIG, raw);
    merged.settings = deepMerge(DEFAULT_SETTINGS, raw.settings || {});
    // 自愈：容器缺少有效宽度时回退到统一默认宽度，避免分类条窗框按内容（最长文件名）收缩
    for (const id of Object.keys(merged.containers || {})) {
      const c = merged.containers[id];
      if (!c || typeof c !== 'object') { delete merged.containers[id]; continue; }
      if (!Number.isFinite(c.w) || c.w < 160) c.w = 300; // 与渲染层 DEF_W 保持一致
    }
    return merged;
  }

  saveConfig(config) {
    saveJsonAtomic(this.configFile, config);
  }

  loadUsage() {
    const raw = loadJson(this.usageFile, { version: 1, items: {} });
    if (!raw.items || typeof raw.items !== 'object') raw.items = {};
    return raw;
  }

  saveUsage(usage) {
    saveJsonAtomic(this.usageFile, usage);
  }

  loadCategoryOverrides() {
    return loadJson(this.categoriesFile, { version: 1, items: {} }).items || {};
  }

  saveCategoryOverrides(items) {
    saveJsonAtomic(this.categoriesFile, { version: 1, items });
  }
}

module.exports = { ConfigStore, resolveDataDir, loadJson, saveJsonAtomic, deepMerge, DEFAULT_SETTINGS, DEFAULT_CONFIG };

