'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideFullscreenAction } = require('../src/main/fullscreen');

const GAME = { hwnd: 11n, isDesktop: false, isFullscreen: true };
const DESKTOP = { hwnd: 22n, isDesktop: true, isFullscreen: true };
const APP = { hwnd: 33n, isDesktop: false, isFullscreen: false };

test('全屏自动隐藏：游戏全屏在前台且未在操作 → 隐藏', () => {
  assert.equal(decideFullscreenAction({ info: GAME, hidden: false, interacting: false }), 'hide');
});

test('全屏自动隐藏：正在操作悬浮层时（宽限期）不隐藏', () => {
  assert.equal(decideFullscreenAction({ info: GAME, hidden: false, interacting: true }), 'none');
});

test('全屏自动隐藏：已隐藏时保持隐藏', () => {
  assert.equal(decideFullscreenAction({ info: GAME, hidden: true }), 'none');
});

test('全屏自动隐藏：回到桌面时恢复显示', () => {
  assert.equal(decideFullscreenAction({ info: DESKTOP, hidden: true }), 'show');
  assert.equal(decideFullscreenAction({ info: DESKTOP, hidden: false }), 'none');
});

test('全屏自动隐藏：普通应用前台时不干预（置底窗口本就不可见）', () => {
  assert.equal(decideFullscreenAction({ info: APP, hidden: false }), 'none');
  assert.equal(decideFullscreenAction({ info: APP, hidden: true }), 'show'); // 从全屏退出到普通窗口 → 恢复
});

test('全屏自动隐藏：本应用自身在前台时忽略（搜索框聚焦等）', () => {
  assert.equal(decideFullscreenAction({ info: GAME, ourHwnd: GAME.hwnd, hidden: false }), 'none');
});

test('全屏自动隐藏：开关关闭时不隐藏，已隐藏则恢复', () => {
  assert.equal(decideFullscreenAction({ info: GAME, hidden: false, enabled: false }), 'none');
  assert.equal(decideFullscreenAction({ info: GAME, hidden: true, enabled: false }), 'show');
});

test('全屏自动隐藏：无前台窗口信息时保持现状', () => {
  assert.equal(decideFullscreenAction({ info: null, hidden: false }), 'none');
});
