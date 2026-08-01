'use strict';
/** 使用统计与推荐评分（纯函数 + 存储）。 */
const fs = require('fs');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 90;

function validHistory(history, nowMs = Date.now()) {
  if (!Array.isArray(history)) return [];
  const now = Number(nowMs) || Date.now();
  return history
    .map(Number)
    .filter((t) => Number.isFinite(t) && t > 0 && t <= now + 60 * 1000)
    .sort((a, b) => a - b)
    .slice(-HISTORY_LIMIT);
}

function decay(ageDays, halfLifeDays) {
  return Math.exp(-Math.LN2 * Math.max(0, ageDays) / halfLifeDays);
}

/**
 * 推荐评分：以近期习惯为主、长期偏好为辅。
 *
 * - 最近一次打开：反映当前任务（半衰期 5 天）
 * - 最近 30 天的打开动量：避免“只打开一次”长期占位（半衰期 10 天）
 * - 活跃天数：奖励多天持续使用，而不是单日连续误点
 * - 累计使用：保留长期常用项目的基础权重
 *
 * 旧版 usage.json 没有 history 时会平滑退化为 opens + lastOpened，不会丢失既有习惯。
 */
function computeScore(opens, lastOpenedMs, mtimeMs, nowMs = Date.now(), history = []) {
  const count = Math.max(0, Number(opens) || 0);
  const last = Number(lastOpenedMs) || 0;
  const now = Number(nowMs) || Date.now();
  const events = validHistory(history, now);

  const recencyDays = last > 0 ? Math.max(0, (now - last) / DAY) : Infinity;
  const recency = Number.isFinite(recencyDays) ? decay(recencyDays, 5) : 0;

  const recentMomentum = events.reduce((sum, t) => sum + decay((now - t) / DAY, 10), 0);
  // 一个最近事件能带来适度加成，多日多次才逐步接近 1。
  const historyFrequency = 1 - Math.exp(-recentMomentum / 3);
  const fallbackFrequency = Math.min(1, Math.log10(count + 1) / Math.log10(31));
  const frequency = events.length ? historyFrequency : fallbackFrequency;

  const activeDays = new Set(events.filter((t) => now - t <= 30 * DAY).map((t) => Math.floor(t / DAY))).size;
  const consistency = Math.min(1, activeDays / 7);
  const lifetime = Math.min(1, Math.log10(count + 1) / Math.log10(31));

  return 0.42 * recency + 0.25 * frequency + 0.18 * consistency + 0.15 * lifetime;
}

/** 合并评分与展示字段，取 Top N */
function rankItems(items, usage, options = {}) {
  const now = Date.now();
  const scored = items
    .filter((it) => it && !it.hidden)
    .map((it) => {
      const u = (usage.items && usage.items[it.path]) || {};
      const score = computeScore(u.opens, u.lastOpened, it.mtimeMs, now, u.history);
      return { item: it, usage: u, score };
    })
    .sort((a, b) => b.score - a.score);
  const n = Math.max(1, Math.min(100, Number(options.topN) || 8));
  return scored.slice(0, n);
}

class UsageStore {
  constructor(file) {
    this.file = file;
    this.debounceTimer = null;
    this.data = { version: 2, items: {} };
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = raw && raw.items ? raw : { version: 2, items: {} };
      }
    } catch {
      this.data = { version: 2, items: {} };
    }
    return this.data;
  }

  recordOpen(p) {
    const key = path.normalize(p);
    const u = (this.data.items[key] = this.data.items[key] || { opens: 0, lastOpened: 0, history: [] });
    u.opens = (u.opens || 0) + 1;
    u.lastOpened = Date.now();
    u.history = validHistory([...(u.history || []), u.lastOpened], u.lastOpened);
    this.data.version = 2;
    this.scheduleSave();
  }

  /** 从 Recent 目录解析到的打开事件批量合入（按 lnk mtime 增量） */
  mergeRecent(recentEvents, sinceMs) {
    let changed = false;
    for (const ev of recentEvents) {
      const key = path.normalize(ev.path);
      if (!this.data.items[key]) this.data.items[key] = { opens: 0, lastOpened: 0, history: [] };
      const u = this.data.items[key];
      if (ev.timeMs > (u.lastOpened || 0)) u.lastOpened = ev.timeMs;
      u.history = validHistory([...(u.history || []), ev.timeMs]);
      changed = true;
    }
    if (changed) this.scheduleSave();
    return changed;
  }

  scheduleSave() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.save(), 1500);
  }

  save() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { computeScore, rankItems, UsageStore, validHistory, DAY, HISTORY_LIMIT };
