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

let native = null;
let state = { available: false, error: null, pinned: 0 };

function probe() {
  if (native) return native;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    const api = {
      koffi,
      SetWindowPos: user32.func('int SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, unsigned int uFlags)'),
      SystemParametersInfoA: user32.func('int SystemParametersInfoA(unsigned int uiAction, unsigned int uiParam, void *pvParam, unsigned int fWinIni)'),
      GetDesktopWindow: user32.func('void *GetDesktopWindow()'),
      SHChangeNotify: shell32.func('void SHChangeNotify(int wEventId, unsigned int uFlags, void *dwItem1, void *dwItem2)'),
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

module.exports = {
  probe, isNativeAvailable, lastError, pinToBottom, refreshIcons,
  toggleDesktopIcons, getDesktopIconsHidden, regSetHideIcons,
};
