'use strict';
/** Preload：向渲染进程暴露受限的 flowdesk API（sandbox + contextIsolation）。 */
const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

const api = {
  // 数据
  data: () => ipcRenderer.invoke('flowdesk:data'),
  refresh: () => ipcRenderer.invoke('flowdesk:refresh'),

  // 条目操作
  open: (p) => ipcRenderer.invoke('flowdesk:open', p),
  reveal: (p) => ipcRenderer.invoke('flowdesk:reveal', p),
  setCategory: (p, c) => ipcRenderer.invoke('flowdesk:setCategory', p, c),
  manualAdd: (p, c) => ipcRenderer.invoke('flowdesk:manual:add', p, c),
  manualRemove: (p) => ipcRenderer.invoke('flowdesk:manual:remove', p),

  // 布局与样式
  saveContainers: (containers) => ipcRenderer.invoke('flowdesk:containers:save', containers),
  saveHidden: (hiddenItems) => ipcRenderer.invoke('flowdesk:hidden:save', hiddenItems),
  savePinned: (pinned) => ipcRenderer.invoke('flowdesk:pinned:save', pinned),
  applyStyle: (id, style) => ipcRenderer.invoke('flowdesk:style', id, style),
  hideItem: (p, hidden) => ipcRenderer.invoke('flowdesk:hideItem', p, hidden),

  // 设置
  getSettings: () => ipcRenderer.invoke('flowdesk:settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('flowdesk:settings:set', patch),

  // 图标
  icon: (p, mtimeMs) => ipcRenderer.invoke('flowdesk:icon', p, mtimeMs),

  // 系统图标隐藏/恢复
  iconsStatus: () => ipcRenderer.invoke('flowdesk:icons:status'),
  iconsToggle: (hidden) => ipcRenderer.invoke('flowdesk:icons:toggle', hidden),

  // 鼠标穿透与就绪
  mouseover: (over) => ipcRenderer.send('flowdesk:mouseover', Boolean(over)),
  focusMode: (on) => ipcRenderer.send('flowdesk:focus-mode', Boolean(on)),
  ready: () => ipcRenderer.send('flowdesk:renderer-ready'),
  quit: () => ipcRenderer.send('flowdesk:quit'),
  usageClear: () => ipcRenderer.invoke('flowdesk:usage:clear'),
  styleAll: (style) => ipcRenderer.invoke('flowdesk:style:all', style),
  appInfo: () => ipcRenderer.invoke('flowdesk:app:info'),

  // 文件 URL（沙箱 preload 可用 url 模块）
  fileUrl: (p) => (p ? pathToFileURL(p).href : ''),

  // 事件订阅
  on: (channel, cb) => {
    const valid = ['flowdesk:data', 'flowdesk:icons-ready', 'flowdesk:viewport', 'flowdesk:gpu-fallback', 'flowdesk:show-settings'];
    if (!valid.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('flowdesk', api);
