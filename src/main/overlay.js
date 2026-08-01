'use strict';
/**
 * 悬浮层显示策略的决策纯函数（可单测）。
 * 策略：只在「桌面焦点」时显示并响应；当焦点在任意其他应用窗口（含全屏游戏）上时自动隐藏，
 * 避免悬浮层遮挡应用或误响应鼠标（悬停提示/放大等）。用户可关闭该策略恢复常显。
 */

/**
 * 根据前台窗口信息决定悬浮层的下一步动作。
 * @param {object} opts
 * @param {object|null} opts.info     前台窗口信息（null 表示无前台窗口）
 * @param {bigint}     opts.info.hwnd        窗口句柄
 * @param {boolean}    opts.info.isDesktop   是否桌面相关窗口（Progman/WorkerW/任务栏等）
 * @param {bigint|null} opts.ourHwnd         本应用窗口句柄（避免把自己的窗口当外部应用）
 * @param {boolean}    opts.hidden           当前是否已因策略而隐藏
 * @param {boolean}    opts.enabled          设置开关 desktopOnly（默认开启）
 * @returns {'hide'|'show'|'none'} 'hide'=隐藏悬浮层；'show'=恢复显示；'none'=保持现状
 */
function decideOverlayVisibility({ info, ourHwnd, hidden = false, enabled = true } = {}) {
  if (enabled === false) return hidden ? 'show' : 'none';
  if (!info || !info.hwnd) return 'none';
  if (ourHwnd != null && info.hwnd === ourHwnd) return 'none'; // 本应用在前台（如搜索框聚焦）
  if (info.isDesktop) return hidden ? 'show' : 'none';
  return hidden ? 'none' : 'hide'; // 任何非桌面应用在前台 → 隐藏悬浮层
}

module.exports = { decideOverlayVisibility };
