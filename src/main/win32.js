'use strict';
/**
 * Win32 原生层（koffi FFI 集中封装）。
 * 所有调用都做能力探测与失败降级：native 不可用时返回 false/记录错误，
 * 上层据此退回「普通置底窗口」模式，绝不导致应用崩溃。
 */
const { execFile } = require('child_process');

const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE; // 0x0013

const SPI_SETICONS = 0x0058;
const SPIF_SENDCHANGE = 0x0002;
const SHCNE_ASSOCCHANGED = 0x08000000;
const SHCNF_FLUSH = 0x1000;
const MONITOR_DEFAULTTONEAREST = 0x00000002;

let native = null;
let state = { available: false, error: null, pinned: 0 };

function probe() {
  if (native) return native;
  try {
    const koffi = require('koffi');
    koffi.struct('POINT', { x: 'long', y: 'long' });
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    const api = {
      koffi,
      SetWindowPos: user32.func('int SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, unsigned int uFlags)'),
      SystemParametersInfoA: user32.func('int SystemParametersInfoA(unsigned int uiAction, unsigned int uiParam, void *pvParam, unsigned int fWinIni)'),
      GetDesktopWindow: user32.func('void *GetDesktopWindow()'),
      SHChangeNotify: shell32.func('void SHChangeNotify(int wEventId, unsigned int uFlags, void *dwItem1, void *dwItem2)'),
      // 前台窗口探测（全屏应用/游戏自动隐藏用）
      GetForegroundWindow: user32.func('void *GetForegroundWindow()'),
      GetWindowRect: user32.func('int GetWindowRect(void *hWnd, int *lpRect)'),
      GetClassNameA: user32.func('int GetClassNameA(void *hWnd, char *lpClassName, int nMaxCount)'),
      MonitorFromWindow: user32.func('void *MonitorFromWindow(void *hWnd, unsigned int dwFlags)'),
      GetMonitorInfoA: user32.func('int GetMonitorInfoA(void *hMonitor, void *lpmi)'),
      GetShellWindow: user32.func('void *GetShellWindow()'),
      // 交互门卫：确认鼠标位置的最顶层窗口是本悬浮层，避免上层透明/穿透窗口漏事件
      GetCursorPos: user32.func('int GetCursorPos(int *lpPoint)'),
      WindowFromPoint: user32.func('void *WindowFromPoint(POINT point)'),
      GetAncestor: user32.func('void *GetAncestor(void *hWnd, unsigned int gaFlags)'),
    };
    // 探测：调用一次无害 API 验证 FFI 正常
    api.GetDesktopWindow();
    native = api;
    state = { available: true, error: null, pinned: 0 };
  } catch (err) {
    native = null;
    state = { available: false, error: String((err && err.message) || err) };
  }
  return native;
}

function isNativeAvailable() {
  return Boolean(probe());
}

function lastError() {
  return state.error;
}

/**
 * 将窗口置底（位于桌面图标之上、普通应用窗口之下）。
 * @param {Buffer} hwndBuffer Electron getNativeWindowHandle() 返回值
 * @returns {boolean}
 */
function pinToBottom(hwndBuffer) {
  const api = probe();
  if (!api || !hwndBuffer || hwndBuffer.length === 0) return false;
  try {
    const hwnd = Number(hwndBuffer.readBigUInt64LE(0)); // 8 字节小端 = HWND 数值
    const ok = api.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_FLAGS);
    if (ok) state.pinned = Date.now();
    return Boolean(ok);
  } catch (err) {
    state.error = String((err && err.message) || err);
    return false;
  }
}

/** 刷新桌面图标显示（配合注册表 HideIcons） */
function refreshIcons() {
  const api = probe();
  if (!api) return false;
  try {
    api.SystemParametersInfoA(SPI_SETICONS, 0, null, SPIF_SENDCHANGE);
    api.SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, null, null);
    return true;
  } catch (err) {
    state.error = String((err && err.message) || err);
    return false;
  }
}

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';

function regQueryHideIcons() {
  return new Promise((resolve) => {
    execFile('reg', ['query', REG_KEY, '/v', 'HideIcons'], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /HideIcons\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(stdout || '');
      resolve(m ? parseInt(m[1], 16) : null);
    });
  });
}

function regSetHideIcons(value) {
  return new Promise((resolve) => {
    execFile('reg', ['add', REG_KEY, '/v', 'HideIcons', '/t', 'REG_DWORD', '/d', value ? '1' : '0', '/f'], { windowsHide: true, timeout: 8000 }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * 隐藏/恢复桌面图标（用户主动点击时才调用）。
 * @returns {{hidden: (boolean|null), refreshed: boolean, ok: boolean}}
 */
async function toggleDesktopIcons(hidden) {
  const ok = await regSetHideIcons(hidden);
  const refreshed = ok ? refreshIcons() : false;
  const current = await regQueryHideIcons();
  return { hidden: current, refreshed, ok };
}

async function getDesktopIconsHidden() {
  const v = await regQueryHideIcons();
  return v === 1;
}


/**
 * 前台窗口信息（全屏应用/游戏自动隐藏用）。
 * @returns {{hwnd: bigint, className: string, rect: {left,top,right,bottom}}|null}
 */
function foregroundInfo() {
  const api = probe();
  if (!api) return null;
  try {
    const hwnd = api.GetForegroundWindow();
    if (!hwnd) return null;
    const rectBuf = Buffer.alloc(16);
    api.GetWindowRect(hwnd, rectBuf);
    const clsBuf = Buffer.alloc(256);
    const n = api.GetClassNameA(hwnd, clsBuf, 256);
    return {
      hwnd,
      className: n > 0 ? clsBuf.toString('latin1', 0, n) : '',
      rect: {
        left: rectBuf.readInt32LE(0), top: rectBuf.readInt32LE(4),
        right: rectBuf.readInt32LE(8), bottom: rectBuf.readInt32LE(12),
      },
    };
  } catch (err) {
    state.error = String((err && err.message) || err);
    return null;
  }
}

/** 是否桌面相关窗口（桌面图标宿主 / 任务栏），此时悬浮层应正常显示。 */
function isDesktopWindow(hwnd) {
  const api = probe();
  if (!api || !hwnd) return false;
  try {
    if (hwnd === api.GetShellWindow()) return true;
    const clsBuf = Buffer.alloc(64);
    const n = api.GetClassNameA(hwnd, clsBuf, 64);
    const cls = n > 0 ? clsBuf.toString('latin1', 0, n) : '';
    return cls === 'Progman' || cls === 'WorkerW' || cls === 'Shell_TrayWnd';
  } catch (err) {
    state.error = String((err && err.message) || err);
    return false;
  }
}

/**
 * 前台窗口是否覆盖其所在显示器（全屏应用/无边框全屏游戏）。
 * 同时匹配整块屏幕与工作区（含任务栏可见的无边框全屏），容差 4px。
 */
function isFullscreenWindow(hwnd) {
  const api = probe();
  if (!api || !hwnd) return false;
  try {
    const mon = api.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (!mon) return false;
    const mi = Buffer.alloc(40);
    mi.writeInt32LE(40, 0); // cbSize
    if (!api.GetMonitorInfoA(mon, mi)) return false;
    const rectBuf = Buffer.alloc(16);
    if (!api.GetWindowRect(hwnd, rectBuf)) return false;
    const wL = rectBuf.readInt32LE(0), wT = rectBuf.readInt32LE(4);
    const wR = rectBuf.readInt32LE(8), wB = rectBuf.readInt32LE(12);
    const tol = 4;
    const covers = (mL, mT, mR, mB) => wL <= mL + tol && wT <= mT + tol && wR >= mR - tol && wB >= mB - tol;
    // rcMonitor 在偏移 4，rcWork 在偏移 20（MONITORINFO: cbSize + rcMonitor + rcWork + dwFlags）
    return covers(mi.readInt32LE(4), mi.readInt32LE(8), mi.readInt32LE(12), mi.readInt32LE(16))
      || covers(mi.readInt32LE(20), mi.readInt32LE(24), mi.readInt32LE(28), mi.readInt32LE(32));
  } catch (err) {
    state.error = String((err && err.message) || err);
    return false;
  }
}

/**
 * 交互门卫：判断鼠标当前位置的最顶层窗口是否为本悬浮层。
 * 用于防止上层应用窗口（含透明/点击穿透区域）把鼠标事件漏到悬浮层导致误触发。
 * 探测失败时放行（返回 true），保证悬浮层正常可用。
 */
function isTopWindowAtCursor(ourHwnd) {
  const api = probe();
  if (!api || !ourHwnd) return true;
  try {
    const pt = Buffer.alloc(8);
    if (!api.GetCursorPos(pt)) return false;
    const top = api.WindowFromPoint({ x: pt.readInt32LE(0), y: pt.readInt32LE(4) });
    if (!top) return false;
    const root = api.GetAncestor(top, 2); // GA_ROOT
    return root === ourHwnd;
  } catch (err) {
    state.error = String((err && err.message) || err);
    return true;
  }
}
module.exports = {
  probe, isNativeAvailable, lastError, pinToBottom, refreshIcons,
  toggleDesktopIcons, getDesktopIconsHidden, regSetHideIcons,
  foregroundInfo, isDesktopWindow, isFullscreenWindow, isTopWindowAtCursor,
};
