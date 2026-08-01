'use strict';
/**
 * 全屏应用/游戏自动隐藏的决策纯函数（可单测）。
 * 悬浮层窗口在正常使用时应「置底」显示在桌面上；当用户进入全屏应用/游戏时自动隐藏，
 * 避免遮挡游戏画面或响应鼠标（弹悬浮提示等）。
 */

/**
 * 根据前台窗口信息决定悬浮层的下一步动作。
 * @param {object} opts
 * @param {object|null} opts.info     前台窗口信息（null 表示无前台窗口）
 * @param {bigint}     opts.info.hwnd        窗口句柄
 * @param {boolean}    opts.info.isDesktop   是否桌面相关窗口（Progman/WorkerW/任务栏等）
 * @param {boolean}    opts.info.isFullscreen 是否覆盖整块显示器
 * @param {bigint|null} opts.ourHwnd         本应用窗口句柄（避免把自己的全屏窗口当外部应用）
 * @param {boolean}    opts.interacting      用户最近是否正在操作悬浮层（宽限期）
 * @param {boolean}    opts.hidden           当前是否已因全屏而隐藏
 * @param {boolean}    opts.enabled          设置开关 hideOnFullscreen（默认开启）
 * @returns {'hide'|'show'|'none'} 'hide'=隐藏悬浮层；'show'=恢复显示；'none'=保持现状
 */
function decideFullscreenAction({ info, ourHwnd, interacting = false, hidden = false, enabled = true } = {}) {
  if (enabled === false) return hidden ? 'show' : 'none';
  if (!info || !info.hwnd) return 'none';
  if (ourHwnd != null && info.hwnd === ourHwnd) return 'none'; // 本应用在前台（如搜索框聚焦）
  if (info.isDesktop) return hidden ? 'show' : 'none';
  if (info.isFullscreen) {
    if (interacting || hidden) return 'none';
    return 'hide';
  }
  return hidden ? 'show' : 'none';
}

module.exports = { decideFullscreenAction };
