'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDataDir, loadJson, saveJsonAtomic, deepMerge, DEFAULT_SETTINGS, ConfigStore } = require('../src/main/config');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flowdesk-test-'));
}

test('resolveDataDir：优先 APPDATA 且可写', () => {
  const appData = tmp();
  const dir = resolveDataDir({ appData, localAppData: '', home: '', appDir: '', cwd: '' });
  assert.equal(dir, path.join(appData, 'FlowDesk'));
  assert.ok(fs.existsSync(dir));
});

test('resolveDataDir：APPDATA 不可写时回退', () => {
  const base = tmp();
  const appData = path.join(base, 'appdata');
  fs.writeFileSync(appData, 'file-not-dir'); // 让 mkdir 失败
  const localAppData = path.join(base, 'local');
  const dir = resolveDataDir({ appData, localAppData, home: path.join(base, 'home'), appDir: '', cwd: '' });
  assert.equal(dir, path.join(localAppData, 'FlowDesk'));
});

test('loadJson：损坏文件回退默认并备份', () => {
  const dir = tmp();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{broken json', 'utf8');
  const out = loadJson(file, { a: 1 });
  assert.deepEqual(out, { a: 1 });
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('config.json.corrupt-')));
});

test('saveJsonAtomic：往返一致', () => {
  const dir = tmp();
  const file = path.join(dir, 'data.json');
  saveJsonAtomic(file, { hello: '世界', n: 42 });
  assert.deepEqual(loadJson(file, {}), { hello: '世界', n: 42 });
});

test('deepMerge：覆盖与保留', () => {
  const base = { a: 1, b: { c: 2, d: 3 }, list: [1, 2] };
  const override = { b: { c: 9 }, list: [5] };
  const out = deepMerge(base, override);
  assert.equal(out.a, 1);
  assert.equal(out.b.c, 9);
  assert.equal(out.b.d, 3);
  assert.deepEqual(out.list, [5]);
});

test('ConfigStore.loadConfig：容器缺失 w 时自愈为统一默认宽度', () => {
  const dir = tmp();
  const store = new ConfigStore({ dataDir: dir });
  store.saveConfig({
    version: 3,
    settings: {},
    containers: {
      doc: { x: 10, y: 20, h: 100, userMoved: true },   // 缺失 w → 自愈 300
      app: { x: 1, y: 2, w: 240, h: 100 },              // 已有有效宽度 → 保留
    },
    hiddenItems: {},
    pinned: [],
    manualItems: {},
  });
  const out = store.loadConfig();
  assert.equal(out.containers.doc.w, 300);
  assert.equal(out.containers.app.w, 240);
});

test('默认设置存在', () => {
  assert.equal(typeof DEFAULT_SETTINGS.recommendCount, 'number');
  assert.equal(DEFAULT_SETTINGS.autoStart, false);
  assert.equal(DEFAULT_SETTINGS.panelTransitionDuration, 620);
  assert.equal(DEFAULT_SETTINGS.categoryStyle, null);
});
