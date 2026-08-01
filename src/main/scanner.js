'use strict';
/** 桌面扫描、快捷方式解析、图标缓存、实时监听。 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const { classifyItem, extOf, isSkippableName } = require('./classifier');
const { resolveDesktopDirs } = require('./paths');

const POWERSHELL = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

// PowerShell 是外部进程，不能读取 app.asar 内的虚拟文件；正式版脚本会被解包到 app.asar.unpacked。
function runtimeScriptPath(name) {
  const appRoot = path.resolve(__dirname, '..', '..');
  const packed = path.join(appRoot, 'scripts', name);
  const unpackedRoot = appRoot.replace(/([\\/])app\.asar(?=([\\/]|$))/i, '$1app.asar.unpacked');
  const unpacked = path.join(unpackedRoot, 'scripts', name);
  return unpacked !== packed && fs.existsSync(unpacked) ? unpacked : packed;
}

function runPs(scriptFile, input) {
  return new Promise((resolve) => {
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e) }));
    child.on('close', (code) => {
      try {
        const trimmed = out.trim();
        if (!trimmed) return resolve({ ok: false, error: err.trim() || `exit ${code}` });
        resolve({ ok: true, data: JSON.parse(trimmed) });
      } catch {
        resolve({ ok: false, error: out.trim() || err.trim() || `exit ${code}` });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

class DesktopScanner {
  /**
   * @param {object} opts { dataDir, iconsDir, categoryOverrides, usage }
   */
  constructor(opts = {}) {
    this.dataDir = opts.dataDir;
    this.iconsDir = opts.iconsDir || path.join(this.dataDir, 'icons');
    this.getOverrides = opts.getCategoryOverrides || (() => ({}));
    this.lnkCacheFile = path.join(this.dataDir, 'lnk-cache.json');
    this.dirs = [];
    this.items = [];
    this.watcher = null;
    this.lnkCache = this._loadLnkCache();
  }

  _loadLnkCache() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.lnkCacheFile, 'utf8'));
      const items = raw && raw.items ? raw.items : {};
      // 丢弃 target 为空的缓存：旧版解析失败（如中文路径/ .url 的 URL= 未解析）会留下空目标，需重新解析
      for (const [k, v] of Object.entries(items)) {
        if (!v || !v.target) delete items[k];
      }
      return items;
    } catch {
      return {};
    }
  }

  _saveLnkCache() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.lnkCacheFile, JSON.stringify({ version: 1, items: this.lnkCache }, null, 2), 'utf8');
    } catch { /* ignore */ }
  }

  /** 解析桌面目录（可注入测试） */
  setDesktopDirs(dirs) {
    this.dirs = Array.isArray(dirs) ? dirs : resolveDesktopDirs(dirs || {});
  }

  /**
   * 扫描所有桌面目录顶层内容。
   * @param {object} inputs 可选：{ shellDesktop, publicDesktop, oneDriveDesktop, userHome }
   */
  async scan(inputs) {
    if (inputs) this.setDesktopDirs(inputs);
    const overrides = this.getOverrides() || {};
    const entries = [];

    for (const dir of this.dirs) {
      let list;
      try {
        list = await fsp.readdir(dir.path, { withFileTypes: true });
      } catch {
        continue; // 目录不存在/无权限则跳过
      }
      for (const ent of list) {
        const name = ent.name;
        if (isSkippableName(name)) continue;
        const full = path.join(dir.path, name);
        let st = null;
        try {
          st = await fsp.stat(full);
        } catch {
          continue; // 竞态删除
        }
        const isDir = ent.isDirectory() || st.isDirectory();
        const ext = extOf(name);
        const item = {
          path: full,
          name,
          ext,
          kind: isDir ? 'dir' : 'file',
          isDir,
          source: dir.source,
          size: isDir ? 0 : st.size,
          mtimeMs: st.mtimeMs,
          mtime: st.mtimeMs ? new Date(st.mtimeMs).toISOString() : null,
          targetPath: '',
          targetArgs: '',
          targetIcon: '',
          category: '',
        };
        entries.push(item);
      }
    }
    // 快捷方式目标解析：一次 PowerShell 批量调用（带 mtime 缓存），再统一分类
    await this._resolveShortcuts(entries);
    for (const item of entries) {
      item.category = overrides[item.path] || classifyItem(item);
    }
    // 按名称排序（中文按 locale 排序）
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    this.items = entries;
    return entries;
  }

  /** 行数据规范化：PowerShell 5.1 的 ConvertTo-Json 对单元素数组会输出对象而非数组 */
  static normalizeRows(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return [data];
    return [];
  }

  /** 批量解析快捷方式目标（一次 PowerShell 调用；只缓存有目标的条目，失败的条目下次扫描自动重试） */
  async _resolveShortcuts(items) {
    const pending = [];
    for (const item of items) {
      if (item.isDir || (item.ext !== '.lnk' && item.ext !== '.url')) continue;
      const cached = this.lnkCache[item.path];
      if (cached && cached.mtimeMs === item.mtimeMs) {
        item.targetPath = cached.target || '';
        item.targetArgs = cached.args || '';
        item.targetIcon = cached.icon || '';
      } else {
        pending.push(item);
      }
    }
    if (pending.length === 0) return;
    const res = await runPs(runtimeScriptPath('shortcut-info.ps1'), pending.map((it) => ({ path: it.path })));
    const byPath = new Map();
    if (res.ok) {
      for (const r of DesktopScanner.normalizeRows(res.data)) {
        if (r && r.path) byPath.set(r.path, r);
      }
    }
    for (const item of pending) {
      const info = byPath.get(item.path);
      if (info) {
        item.targetPath = info.target || '';
        item.targetArgs = info.args || '';
        item.targetIcon = info.icon || '';
      }
      if (item.targetPath) {
        this.lnkCache[item.path] = { mtimeMs: item.mtimeMs, target: item.targetPath, args: item.targetArgs, icon: item.targetIcon, ts: Date.now() };
      }
    }
    this._saveLnkCache();
  }

  /** 图标缓存文件名：按 path+mtime 哈希，避免旧图标残留 */
  iconCachePath(item) {
    const h = crypto.createHash('sha1').update(item.path + '|' + item.mtimeMs).digest('hex').slice(0, 20);
    return path.join(this.iconsDir, `${h}.png`);
  }

  /** 批量补齐缺失图标（一次最多 N 个，避免 PowerShell 拖慢启动） */
  async ensureIcons(items, max = 40) {
    const todo = [];
    for (const it of items) {
      const file = this.iconCachePath(it);
      if (fs.existsSync(file)) continue;
      todo.push({ path: it.path, output: file });
      if (todo.length >= max) break;
    }
    if (todo.length === 0) return [];
    const res = await runPs(runtimeScriptPath('extract-icons.ps1'), todo);
    const ok = [];
    if (res.ok) {
      for (const r of DesktopScanner.normalizeRows(res.data)) if (r && r.ok) ok.push(r.path);
    }
    return ok;
  }

  /** 单条图标提取（卡片首次可见时按需调用） */
  async ensureIcon(item) {
    const file = this.iconCachePath(item);
    if (fs.existsSync(file)) return file;
    const res = await runPs(runtimeScriptPath('extract-icons.ps1'), [{ path: item.path, output: file }]);
    const rows = DesktopScanner.normalizeRows(res.data);
    if (res.ok && rows[0] && rows[0].ok) return file;
    return null;
  }

  /** 监听桌面目录变化，回调收到 { type: 'rescan' } */
  watch(onChange) {
    if (this.watcher) this.watcher.close();
    const paths = this.dirs.filter((d) => fs.existsSync(d.path)).map((d) => d.path);
    if (paths.length === 0) return;
    let timer = null;
    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      depth: 0,
      ignorePermissionErrors: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });
    const fire = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        onChange && onChange({ type: 'rescan' });
      }, 400);
    };
    this.watcher.on('add', fire);
    this.watcher.on('unlink', fire);
    this.watcher.on('addDir', fire);
    this.watcher.on('unlinkDir', fire);
    this.watcher.on('error', () => {});
  }

  close() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
  }
}

module.exports = { DesktopScanner, runPs };
