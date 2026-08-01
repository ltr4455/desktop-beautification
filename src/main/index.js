'use strict';
/** FlowDesk 主进程入口：窗口创建、桌面置底/重挂、渲染回退、生命周期。 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app, BrowserWindow, screen, powerMonitor, Menu, Tray, nativeImage } = require('electron');

const { ConfigStore, resolveDataDir } = require('./config');
const { DesktopScanner } = require('./scanner');
const { UsageStore } = require('./usage');
const { resolveDesktopDirs } = require('./paths');
const win32 = require('./win32');
const { registerIpc, buildData } = require('./ipc');

const SMOKE = process.argv.includes('--smoke');
const DEV = process.argv.includes('--dev');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { /* 单实例，忽略重复启动 */ });

  const env = {
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    home: require('os').homedir(),
    appDir: app.getAppPath(),
    cwd: process.cwd(),
  };
  const dataDir = resolveDataDir(env);
  const configStore = new ConfigStore({ dataDir });
  let config = configStore.loadConfig();

  if (config.settings.hardwareAcceleration === false && !app.commandLine.hasSwitch('disable-gpu')) {
    app.disableHardwareAcceleration();
  }
  if (app.commandLine.hasSwitch('disable-gpu')) {
    config.settings.gpuFallbackActive = true;
    configStore.saveConfig(config);
  } else if (config.settings.gpuFallbackActive) {
    // 上次异常退出启用了 GPU 回退（--disable-gpu），本次正常启动则自动清除标记
    config.settings.gpuFallbackActive = false;
    configStore.saveConfig(config);
  }

  Menu.setApplicationMenu(null);

  const state = {
    iconsHidden: false,
    nativeAvailable: false,
    nativeError: null,
    rendererReadyAt: 0,
    lastExplorerPid: null,
    gpuRetried: false,
  };

  const scanner = new DesktopScanner({
    dataDir,
    getCategoryOverrides: () => configStore.loadCategoryOverrides(),
  });
  const usage = new UsageStore(configStore.usageFile);
  usage.load();
  let win = null;
  let repinTimer = null;
  let explorerTimer = null;

  function getSettings() {
    return configStore.loadConfig();
  }

  function saveSettings(cfg) {
    config = cfg;
    configStore.saveConfig(cfg);
  }

  function cleanupLegacyStartupEntries() {
    if (process.platform !== 'win32') return;
    const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    // 旧开发版把 Electron 本体写进了登录启动项，会在开机时打开 Electron 欢迎页。
    for (const name of ['electron.app.Electron', 'electron.app.灵动桌面', 'electron.app.desk-flow']) {
      execFile('reg.exe', ['delete', runKey, '/v', name, '/f'], { windowsHide: true, timeout: 5000 }, () => {});
    }
  }

  function setAutoStart(enabled) {
    const openAtLogin = Boolean(enabled);
    if (!app.isPackaged) return false;
    try {
      app.setLoginItemSettings({
        openAtLogin,
        path: process.execPath,
        args: ['--autostart'],
        enabled: openAtLogin,
        name: 'FlowDesk',
      });
      const status = app.getLoginItemSettings({ path: process.execPath, args: ['--autostart'] });
      return Boolean(status.openAtLogin);
    } catch {
      return openAtLogin;
    }
  }

  function virtualBounds() {
    const displays = screen.getAllDisplays();
    const b = displays.reduce(
      (acc, d) => ({
        x: Math.min(acc.x, d.bounds.x),
        y: Math.min(acc.y, d.bounds.y),
        right: Math.max(acc.right, d.bounds.x + d.bounds.width),
        bottom: Math.max(acc.bottom, d.bounds.y + d.bounds.height),
      }),
      { x: 0, y: 0, right: 0, bottom: 0 }
    );
    return { x: b.x, y: b.y, width: b.right - b.x, height: b.bottom - b.y };
  }

  let tray = null;
  function createTray() {
    if (tray || SMOKE) return;
    let img = null;
    const candidates = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon.png'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon.ico'),
      path.join(app.getAppPath(), 'assets', 'icon.png'),
      path.join(app.getAppPath(), 'assets', 'icon.ico'),
      path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    ];
    for (const file of candidates) {
      try {
        if (!fs.existsSync(file)) continue;
        const candidate = nativeImage.createFromBuffer(fs.readFileSync(file));
        if (!candidate.isEmpty()) { img = candidate; break; }
      } catch { /* try the next packaged location */ }
    }
    if (!img || img.isEmpty()) return;
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('灵动桌面 FlowDesk');
    const showWin = () => {
      if (!win || win.isDestroyed()) return;
      if (!win.isVisible()) win.showInactive();
    };
    const rebuildMenu = () => {
      const visible = !win || win.isDestroyed() || win.isVisible();
      tray.setContextMenu(Menu.buildFromTemplate([
        {
          label: '⚙ 设置',
          click: () => {
            showWin();
            if (win && !win.isDestroyed()) win.webContents.send('flowdesk:show-settings');
          },
        },
        {
          label: visible ? '🙈 隐藏' : '👁 显示',
          click: () => {
            if (!win || win.isDestroyed()) return;
            if (win.isVisible()) win.hide();
            else { showWin(); rebuildMenu(); }
          },
        },
        { type: 'separator' },
        { label: '❌ 退出', click: () => app.quit() },
      ]));
    };
    rebuildMenu();
    tray.on('click', () => {
      if (!win || win.isDestroyed()) return;
      if (win.isVisible()) win.hide();
      else { showWin(); rebuildMenu(); }
    });
    tray.on('double-click', () => {
      showWin();
      if (win && !win.isDestroyed()) win.webContents.send('flowdesk:show-settings');
    });
  }

  function createWindow() {
    const bounds = SMOKE ? { x: 0, y: 0, width: 640, height: 480 } : virtualBounds();
    const isWin11 = require('os').release().startsWith('10.0.2'); // 仅供参考

    win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      backgroundThrottling: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    if (SMOKE || DEV) {
      win.webContents.on('console-message', (event) => {
        console.log('[renderer]', event.message + ' @' + event.lineNumber + ':' + event.sourceId);
      });
      win.webContents.on('render-process-gone', (e, details) => {
        console.log('[renderer-gone]', JSON.stringify(details));
      });
    }

    win.once('ready-to-show', () => {
      if (SMOKE) {
        win.show();
      } else {
        win.showInactive();
        repin();
      }
    });

    win.on('closed', () => {
      win = null;
      clearInterval(repinTimer);
      clearInterval(explorerTimer);
    });
  }

  function getHwnd() {
    if (!win || win.isDestroyed()) return null;
    const buf = win.getNativeWindowHandle();
    return buf && buf.length ? buf : null;
  }

  function repin() {
    if (!win || win.isDestroyed() || SMOKE) return false;
    if (win.isMinimized() || !win.isVisible()) return false;
    return win32.pinToBottom(getHwnd());
  }

  function getExplorerPid() {
    return new Promise((resolve) => {
      execFile('tasklist', ['/fi', 'imagename eq explorer.exe', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(null);
        const m = /"explorer\.exe","(\d+)"/i.exec(stdout || '');
        resolve(m ? m[1] : null);
      });
    });
  }

  async function refreshAll() {
    await scanner.scan({
      shellDesktop: app.getPath('desktop'),
      publicDesktop: path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
      oneDriveDesktop: '',
      userHome: app.getPath('home'),
    });
    state.iconsHidden = await win32.getDesktopIconsHidden();
    pushData();
    // 后台预热图标缓存
    scanner.ensureIcons(scanner.items, 200).then((okList) => {
      if (okList.length && win && !win.isDestroyed()) {
        win.webContents.send('flowdesk:icons-ready');
      }
    }).catch(() => {});
  }

  function pushData() {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('flowdesk:data', buildData({ app, win: () => win, configStore, scanner, usage, getSettings, saveSettings, state }));
  }
  function setupTimers() {
    clearInterval(repinTimer);
    repinTimer = setInterval(() => {
      if (win && !win.isDestroyed()) repin();
    }, 5000);

    clearInterval(explorerTimer);
    explorerTimer = setInterval(async () => {
      const pid = await getExplorerPid();
      if (pid && state.lastExplorerPid && pid !== state.lastExplorerPid) {
        // explorer 重启：重新置底并刷新（桌面图标已重绘）
        repin();
        refreshAll();
      }
      state.lastExplorerPid = pid;
    }, 15000);
  }

  function watchDisplays() {
    const onMetrics = () => {
      if (!win || win.isDestroyed() || SMOKE) return;
      const b = virtualBounds();
      win.setBounds(b);
      repin();
      win.webContents.send('flowdesk:viewport', { bounds: b });
    };
    screen.on('display-added', onMetrics);
    screen.on('display-removed', onMetrics);
    screen.on('display-metrics-changed', onMetrics);
    powerMonitor.on('resume', () => {
      repin();
      refreshAll();
    });
  }

  app.whenReady().then(async () => {
    state.nativeAvailable = win32.isNativeAvailable();
    state.nativeError = win32.lastError();
    cleanupLegacyStartupEntries();

    if (app.isPackaged && config.settings.autoStart) setAutoStart(true);
    else if (!app.isPackaged && config.settings.autoStart) {
      config.settings.autoStart = false;
      configStore.saveConfig(config);
    }

    registerIpc({
      app,
      win: () => win,
      configStore,
      scanner,
      usage,
      getSettings,
      saveSettings,
      setAutoStart,
      state,
    });

    createWindow();
    watchDisplays();
    setupTimers();
    createTray();
    await refreshAll();
    // 桌面文件变更自动重扫（chokidar 监听桌面目录）
    if (!SMOKE) scanner.watch(() => { refreshAll().catch(() => {}); });
    if (SMOKE) {
      await new Promise((r) => setTimeout(r, 2200));
      let dom = null;
      try {
        dom = await win.webContents.executeJavaScript(`(async () => {
          const focusBtn = document.querySelector('.container[data-id="recommend"] .cont-focus-btn');
          if (focusBtn) focusBtn.click();
          await new Promise((r) => setTimeout(r, 150));
            const sideBtn = document.getElementById('set-side-left');
          if (sideBtn) sideBtn.click();
          const animBtn = document.querySelector('#set-anim-type-row .mini-btn[data-type="zoom"]');
          if (animBtn) animBtn.click();
          await new Promise((r) => setTimeout(r, 200));
          return {
          containers: document.querySelectorAll('.container').length,
          cells: document.querySelectorAll('.cell').length,
          listRows: document.querySelectorAll('.list-row').length,
          recRows: document.querySelectorAll('.rec-row').length,
          dockIcons: document.querySelectorAll('.dock-icon').length,
          dockHidden: document.getElementById('dock-wrap').classList.contains('hidden'),
          iconsLoaded: document.querySelectorAll('.cell img:not(.hidden), .li-icon img:not(.hidden), .dock-icon img:not(.hidden), .rec-row img[src]').length,
          text: document.body.innerText.slice(0, 220).split('\\n').join(' | '),
          layout: [...document.querySelectorAll('.container')].map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }),
          dockRect: (() => { const d = document.getElementById('dock-wrap'); if (d.classList.contains('hidden')) return null; const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); const dock = document.getElementById('dock'); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight, pos: cs.position, bottom: cs.bottom, display: cs.display, dockChildren: dock.children.length, dockH: dock.offsetHeight, dockScrollW: dock.scrollWidth, dockClientW: dock.clientWidth, iconH: dock.children[0] ? dock.children[0].offsetHeight : 0 }; })(),
          focusedId: document.querySelector('.container.focused') ? document.querySelector('.container.focused').dataset.id : null,
          focusedRect: (() => { const f = document.querySelector('.container.focused'); if (!f) return null; const r = f.getBoundingClientRect(); return { id: f.dataset.id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })(),
          sideCheck: [...document.querySelectorAll('.container:not(.focused)')].map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, x: Math.round(r.left) }; }),
          animSaved: (() => { const b = document.querySelector('#set-anim-type-row .mini-btn.active'); return b ? b.dataset.type : null; })()
        };
        })()`);
      } catch (err) {
        dom = { error: String(err && err.message || err) };
      }
      console.log('[smoke-dom]', JSON.stringify(dom));
      console.log('[smoke] window:', !!win, 'items:', scanner.items.length, 'native:', state.nativeAvailable, 'rendererReady:', state.rendererReadyAt > 0, 'dataDir:', dataDir);
      app.exit(0);
    }

    // GPU 渲染回退：10 秒内未收到渲染就绪则禁用 GPU 重启
    if (!SMOKE && !app.commandLine.hasSwitch('disable-gpu') && !state.gpuRetried) {
      setTimeout(() => {
        if (state.rendererReadyAt === 0 && win && !win.isDestroyed()) {
          state.gpuRetried = true;
          app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu']) });
          app.exit(0);
        }
      }, 10000);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

