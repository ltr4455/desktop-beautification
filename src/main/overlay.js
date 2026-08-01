'use strict';
/**
 * 悬浮层状态决策的纯函数（可单测）。
 *
 * 三种状态：
 * - 'active'：焦点在桌面（或本应用自身）→ 悬浮层正常显示并响应
 * - 'inert' ：焦点在非全屏应用窗口 → 悬浮层保持显示，但不做任何响应（点击穿透、无悬停/动效/提示）
 * - 'hide'  ：焦点在全屏应用/无边框全屏游戏 → 悬浮层直接隐藏（不显示）
 */

/**
 * 根据前台窗口信息决定悬浮层的目标状态。
 * @param {object} opts
 * @param {object|null} opts.info      前台窗口信息（null 表示无前台窗口）
 * @param {bigint}     opts.info.hwnd         窗口句柄
 * @param {boolean}    opts.info.isDesktop    是否桌面相关窗口（Progman/WorkerW/任务栏等）
 * @param {boolean}    opts.info.isFullscreen 是否覆盖整块显示器
 * @param {bigint|null} opts.ourHwnd          本应用窗口句柄（避免把自己的窗口当外部应用）
 * @returns {'active'|'inert'|'hide'|null} null 表示信息不足、不改变现状
 */
function decideOverlayState({ info, ourHwnd } = {}) {
  if (!info || !info.hwnd) return null;
  if (ourHwnd != null && info.hwnd === ourHwnd) return 'active'; // 本应用在前台（如搜索框聚焦）
  if (info.isDesktop) return 'active';
  if (info.isFullscreen) return 'hide';
  return 'inert';
}

module.exports = { decideOverlayState };
