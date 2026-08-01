'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideOverlayState } = require('../src/main/overlay');

const DESKTOP = { hwnd: 1n, isDesktop: true, isFullscreen: true };
const APP = { hwnd: 2n, isDesktop: false, isFullscreen: false };
const GAME = { hwnd: 3n, isDesktop: false, isFullscreen: true };
const APP_FULLSCREEN = { hwnd: 4n, isDesktop: false, isFullscreen: true };

test('桌面焦点 → active（正常显示并响应）', () => {
  assert.equal(decideOverlayState({ info: DESKTOP }), 'active');
});

test('本应用自身在前台 → active（搜索框聚焦等）', () => {
  assert.equal(decideOverlayState({ info: APP, ourHwnd: APP.hwnd }), 'active');
});

test('非全屏应用窗口 → inert（显示但不响应）', () => {
  assert.equal(decideOverlayState({ info: APP }), 'inert');
});

test('全屏应用/游戏 → hide（不显示）', () => {
  assert.equal(decideOverlayState({ info: GAME }), 'hide');
  assert.equal(decideOverlayState({ info: APP_FULLSCREEN }), 'hide');
});

test('无前台窗口信息 → null（不改变现状）', () => {
  assert.equal(decideOverlayState({ info: null }), null);
  assert.equal(decideOverlayState({}), null);
});
