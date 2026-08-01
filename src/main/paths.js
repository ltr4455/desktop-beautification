'use strict';
/** 路径/目录解析纯函数（无 Electron 依赖，可单测）。 */

function normalizeSlashes(p) {
  if (!p) return '';
  return String(p).replace(/\//g, '\\');
}

/** 规范化并去尾部反斜杠（保留盘符根如 C:\） */
function normalizePath(p) {
  const s = normalizeSlashes(p).trim();
  if (!s) return '';
  const out = s.replace(/\\+$/, '');
  return out.length === 2 && out[1] === ':' ? out + '\\' : out;
}

function samePath(a, b) {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/**
 * 解析桌面目录列表（去重、去无效）。
 * @param {object} inputs { shellDesktop, publicDesktop, oneDriveDesktop, userHome }
 * 优先级：注册表 Shell Folders 的 Desktop（已含 OneDrive 重定向）> OneDrive Desktop > 用户主目录 Desktop。
 */
function resolveDesktopDirs(inputs = {}) {
  const { shellDesktop, publicDesktop, oneDriveDesktop, userHome } = inputs;
  const dirs = [];
  const seen = new Set();

  const push = (p, source) => {
    const n = normalizePath(p);
    if (!n) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    dirs.push({ path: n, source });
  };

  // 注册表 Shell Folders 已自动跟随 OneDrive 重定向，优先使用
  push(shellDesktop, 'shell');
  if (oneDriveDesktop) push(oneDriveDesktop, 'onedrive');
  // 仅当注册表/OneDrive 都未提供桌面时，才回退到用户主目录下的 Desktop
  if (userHome && dirs.length === 0) push(require('path').join(userHome, 'Desktop'), 'home');
  if (publicDesktop) push(publicDesktop, 'public');
  return dirs;
}

/** 判断一个路径是否位于给定目录集合内 */
function isUnderAnyDirs(target, dirs) {
  const t = normalizePath(target).toLowerCase();
  return dirs.some((d) => {
    const p = normalizePath(d.path).toLowerCase();
    return t === p || t.startsWith(p + '\\');
  });
}

/** 简单字节大小格式化 */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

module.exports = { normalizePath, normalizeSlashes, samePath, resolveDesktopDirs, isUnderAnyDirs, formatSize };

