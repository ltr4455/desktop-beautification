'use strict';
/**
 * 悬浮层状态决策的纯函数（可单测）。
 *
 * - 'active'：悬浮层正常显示并响应（桌面焦点 / 本应用自身 / 非全屏应用窗口聚焦）。
 *   注意：非全屏应用窗口聚焦时，悬浮层是否响应由「鼠标是否位于前台应用窗口内」
 *   的位置判定（win32.isCursorInsideForegroundWindow）决定，而不是直接失效。
 * - 'hide'  ：焦点在全屏应用/无边框全屏游戏上 → 悬浮层直接隐藏（不显示）。
 */

/**
 * 根据前台窗口信息决定悬浮层的目标状态。
 * @param {object} opts
 * @param {object|null} opts.info      前台窗口信息（null 表示无前台窗口）
 * @param {bigint}     opts.info.hwnd         窗口句柄
 * @param {boolean}    opts.info.isDesktop    是否桌面相关窗口（Progman/WorkerW/任务栏等）
 * @param {boolean}    opts.info.isFullscreen 是否覆盖整块显示器
 * @param {bigint|null} opts.ourHwnd          本应用窗口句柄（避免把自己的窗口当外部应用）
 * @returns {'active'|'hide'|null} null 表示信息不足、不改变现状
 */
function decideOverlayState({ info, ourHwnd } = {}) {
  if (!info || !info.hwnd) return null;
  if (ourHwnd != null && info.hwnd === ourHwnd) return 'active'; // 本应用在前台（如搜索框聚焦）
  if (info.isDesktop) return 'active';
  if (info.isFullscreen) return 'hide';
  return 'active'; // 非全屏应用窗口 → 保持显示；交互交给位置判定
}

module.exports = { decideOverlayState };
