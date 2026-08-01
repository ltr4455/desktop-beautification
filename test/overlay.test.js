'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideOverlayVisibility } = require('../src/main/overlay');

const DESKTOP = { hwnd: 1n, isDesktop: true };
const APP = { hwnd: 2n, isDesktop: false };
const GAME = { hwnd: 3n, isDesktop: false };

test('桌面焦点：可见时保持，隐藏时恢复显示', () => {
  assert.equal(decideOverlayVisibility({ info: DESKTOP, hidden: false }), 'none');
  assert.equal(decideOverlayVisibility({ info: DESKTOP, hidden: true }), 'show');
});

test('应用窗口焦点：可见时隐藏', () => {
  assert.equal(decideOverlayVisibility({ info: APP, hidden: false }), 'hide');
});

test('全屏游戏焦点：同样隐藏（属于非桌面应用）', () => {
  assert.equal(decideOverlayVisibility({ info: GAME, hidden: false }), 'hide');
});

test('应用窗口焦点：已隐藏时保持隐藏', () => {
  assert.equal(decideOverlayVisibility({ info: APP, hidden: true }), 'none');
});

test('本应用自身在前台时忽略（搜索框聚焦等）', () => {
  assert.equal(decideOverlayVisibility({ info: APP, ourHwnd: APP.hwnd, hidden: false }), 'none');
});

test('开关关闭时不自动隐藏，已隐藏则恢复', () => {
  assert.equal(decideOverlayVisibility({ info: APP, hidden: false, enabled: false }), 'none');
  assert.equal(decideOverlayVisibility({ info: APP, hidden: true, enabled: false }), 'show');
});

test('无前台窗口信息时保持现状', () => {
  assert.equal(decideOverlayVisibility({ info: null, hidden: false }), 'none');
});
