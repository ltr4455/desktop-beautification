# 灵动桌面 FlowDesk — 项目状态与交接文档

> 本文档用于在任意新对话中快速接续本项目，同时作为项目整体架构、已完成工作与约定事项的权威记录。
> 最后更新：2026-08-01 ｜ 当前版本：**v0.1.6**
> 一句话概括：Windows 桌面卡片化美化应用——把桌面内容变成「底部应用停靠栏 + 可展开分类条」，支持智能推荐、逐窗口外观/动效定制、自动扫描与拖放手动添加。

---

## 1. 当前状态（v0.1.6）

- ✅ **v0.1 功能全部完成**；**26 个单元测试全部通过**（`npm test`，5 个测试文件）。
- ✅ **打包已完成**：v0.1.6 产出 x64 NSIS 安装包（`dist/`）。按项目要求精简打包策略：**仅 x64 安装版，不做 ARM、不做便携 zip**。
- ✅ **代码整理（2026-08-01）**：修复 `config.js` / `index.js` 中被损坏的中文注释；移除 AI 质感功能遗留的 `aiTexturesDir` 代码与空目录（`assets/ai-textures`、`src/renderer/textures`）；清理 `dist/` 旧版构建残留；`PROJECT_STATE.md` 纳入版本管理并重写。
- ✅ **AI 质感功能已移除**（2026-08-01 早期）：删除 `src/main/texture.js` 及相关 IPC/preload/UI 入口；**保留**内置六种质感（毛玻璃/金属/木纹/布纹/星空/极简）与 `textureImage` 渲染支持（设置→外观与动效中可选质感）。
- ✅ **Bug 修复（2026-08-01）**：分类条窗框宽度按内容（最长文件名）收缩的问题——容器配置缺失 `w` 时渲染层回退 `DEF_W`，主进程 `loadConfig` 自动补 `w` 自愈，并修复了现有 `config.json`（见 `CHANGELOG.md`）。
- ⚠️ **`npm run smoke` 会模拟点击设置项（切靠左、改动效类型）并写入真实配置**，跑完后需手动把 `%APPDATA%\FlowDesk\config.json` 的 `settings.rightSide` 恢复为 `'right'`、`animType` 恢复为 `'rise'`。

## 2. 功能清单（v0.1 已完成）

- **桌面卡片**：扫描用户桌面 + 公共桌面（兼容 OneDrive 重定向），每个条目一张卡片，可自由拖动、双击打开、右键菜单操作。
- **分类浏览**：应用与游戏统一显示在停靠栏；文件夹/图片/文档（含常见代码与配置）/音视频/压缩包/网页链接/其他显示在分类条。规则引擎自动分类，卡片右键可手动改分类并持久化（`categories.json`）。
- **智能推荐**：按真实使用习惯排序（最近使用、近 30 天使用动量、跨天持续使用、长期偏好四因子评分，见第 11 节）；只记录通过本应用成功打开的项目，Top N 常驻推荐卡。
- **停靠栏位置与交互**：底部/顶部 × 左/中/右 6 向预设 + 水平/垂直偏移微调；滚轮横向滚动（方向可反转）；悬浮放大动效（跳跃 + 上浮跳出背景板）；置顶常驻；末尾 ▦ 应用仓库。
- **应用仓库（▦）**：质感主题（跟随停靠栏质感/主色）、约屏幕 1/3（`min(54vw,720px)` 宽 / 56vh 高）、内嵌细滚动条、顶部搜索框（名称实时过滤，聚焦时临时切换窗口可聚焦支持键盘输入）、头部应用数量 + ✕ 关闭、定位跟随停靠栏。
- **外观调整**：每张卡片可调主色、透明度、圆角、描边，内置毛玻璃/金属/木纹/布纹/星空/极简六种质感；设置面板整合为 常规 / 外观与动效 / 布局 / 关于 四个分类页签。
- **自动扫描**：chokidar 监听桌面文件夹变化，新增/删除自动同步重扫（depth 0，400ms 防抖 + awaitWriteFinish）。
- **拖放手动添加**：把任意文件/文件夹拖到对应分类窗口或停靠栏即可手动添加（桌面外条目存 `config.manualItems` 持久化，右键可移除）。
- **隐藏与恢复**：误隐藏条目可即时「↺ 撤销」，或到 设置 → 常规「已隐藏的条目」逐个/全部恢复；置顶会自动解除隐藏。
- **系统托盘**：右键 设置 / 隐藏 / 退出，左键切换显示。
- **桌面图标开关（可选）**：设置里可一键隐藏/恢复系统桌面图标（只在你主动点击时修改系统设置，默认不改）。
- **兼容**：多显示器 / 混合 DPI / explorer 重启自动恢复置底 / 无 GPU 环境自动降级 / 睡眠唤醒重扫 / 点击穿透。

## 3. 技术栈与环境

| 项 | 值 |
|---|---|
| 运行时 | Node 22.22.3（本机）；目标机无需 Node/Python |
| 框架 | Electron 43.2.0（x64 + arm64；Electron 44 起已移除 32 位） |
| 原生 FFI | koffi 3.1.4（预编译 win32-x64 / win32-arm64，集中封装在 `src/main/win32.js`） |
| 文件监听 | chokidar 4 |
| 打包 | electron-builder 26.15.3（NSIS + zip，见 `package.json` build 段） |
| 目标系统 | Windows 10 22H2+ / Windows 11，无管理员权限 |

## 4. 快速开始

```powershell
npm install        # 国内网络失败时：$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; node node_modules\electron\install.js
npm start          # 运行（--dev 开发模式，--smoke 冒烟自检）
npm test           # 单元测试（26 个）
npm run smoke      # 冒烟自检（会写真实配置，见第 1 节警告）
npm run dist       # 打包 x64 NSIS 安装包（dist/）
npm run dist:x64   # 同上（显式指定 x64）
```

## 5. 目录结构与职责

```
src/main/index.js      主进程入口：窗口创建、置底重挂、GPU 回退、explorer 重启监听、系统托盘、自动扫描接线、--smoke 模式
src/main/win32.js      koffi FFI：SetWindowPos(HWND_BOTTOM)、SystemParametersInfoA、SHChangeNotify、HideIcons 注册表
src/main/scanner.js    桌面扫描、.lnk/.url 目标解析（一次批量 PowerShell 调用）、图标提取、chokidar 监听
src/main/classifier.js 分类规则引擎（纯函数）：应用/游戏/文件夹/图片/文档/音视频/压缩包/网页链接/其他
src/main/usage.js      使用统计与推荐评分（纯函数 + 存储）
src/main/config.js     ConfigStore、数据目录回退、默认配置
src/main/paths.js      路径规范化、桌面目录解析（OneDrive 兼容）
src/main/ipc.js        IPC 处理器 + buildData（含 manualItems 合并）+ 键盘焦点模式
src/preload.js         contextBridge 暴露 window.flowdesk API（sandbox + contextIsolation）
src/renderer/          index.html + styles.css + app.js（全部渲染逻辑）
scripts/               shortcut-info.ps1 / extract-icons.ps1 / gen-icon.ps1（打包时 asarUnpack）
assets/                icon.ico、icon.png（应用图标）
test/                  5 个测试文件，26 个用例（node --test）
PROJECT_STATE.md       本文档（架构 + 状态 + 交接）
CHANGELOG.md           版本变更记录
```

## 6. 整体架构与数据流

三层 Electron 结构：**主进程（Node）** 负责窗口/原生能力/扫描/存储；**preload 桥** 用 `contextBridge` 暴露受限的 `window.flowdesk` API；**渲染层（Chromium）** 负责全部 UI 与交互（卡片、拖拽、菜单、外观、设置、推荐）。

```
桌面文件系统 ──► DesktopScanner（扫描/快捷方式解析/图标提取/监听）──► buildData()
                                                            │
config.json / usage.json / categories.json / lnk-cache.json  ◄── ConfigStore / UsageStore
                                                            │
renderer（app.js）◄── flowdesk:data（IPC invoke 快照）────┘
      │  用户操作（打开/拖动/改分类/外观/设置）
      ▼
preload（window.flowdesk.*）──IPC──► ipc.js 处理器 ──► 存储 + win32.js（原生）
```

- **主进程**：`index.js` 装配一切；`win32.js` 集中封装 koffi FFI（置底/刷新图标/注册表，全部 try/catch 失败降级）；`scanner.js` 负责目录扫描与快捷方式解析（一次批量 PowerShell 调用，约 0.5s）；`classifier.js`/`usage.js`/`paths.js` 为可单测的纯逻辑；`config.js` 提供数据目录回退（APPDATA → LOCALAPPDATA → home → appDir/data → 临时目录）。
- **渲染层**：`app.js` 承载全部交互（60KB 单体，函数见文件内注释）；`styles.css` 实现六种质感与动效；`index.html` 为唯一页面骨架。
- **数据流**：渲染层通过 `api.data()` 拉取全量快照（含 manualItems 合并），通过 `api.refresh()` 触发重扫；主进程在图标就绪/显示器变化/GPU 降级/托盘设置时向渲染层推送事件。

## 7. 数据模型与持久化

**运行时数据目录**：`%APPDATA%\FlowDesk\`（只读/失败自动回退到应用目录 `data/`）

- `config.json`：`version:3`，含 `settings`、`containers`、`hiddenItems`、`pinned`、`manualItems`
- `usage.json`：`version:2`，`items: { 路径: { opens, lastOpened, history[] } }` — **opens 只记录通过本软件打开的次数**
- `categories.json`：手动分类覆盖 `{ 路径: 类别id }`
- `config.json.manualItems`：拖放手动添加的桌面外条目 `{ 路径: { category, isDir } }`（manual 标记，右键可移除）
- `lnk-cache.json`：快捷方式目标解析缓存（空 target 条目会在加载时丢弃以便重新解析）
- `icons/`：提取的 PNG 图标缓存（按 path+mtime 哈希）

**settings 全部字段**（改配置时渲染层必须同步更新，见第 12 节坑 1）：

```
recommendCount:8  autoStart:false  hardwareAcceleration:true
iconSize:64  cardWidth:200  cardHeight:236  cardGap:24  hiddenIcons:false  layoutVersion:3
dockIconSize:38  dockBgOpacity:0.9  dockIconOpacity:1  dockPosition:'bottom-center'（6 向预设）
dockOffsetX:0  dockOffsetY:0  dockMagnify:true  dockWheelInvert:false
rightSide:'right'  animEnabled:true  animType:'rise'  animDuration:300  panelTransitionDuration:620
categoryStyle:null  hoverEffect:true  language:'zh-CN'
```

**containers**：按类别 id（`recommend/app/game/folder/image/doc/media/archive/link/other`）存 `{ x,y,w,h,hidden,collapsed,style,userMoved,reattached }`。`style` 可含：`color/opacity/texture/textureImage/radius/border/anim/hover/bgOpacity/iconOpacity/contentOpacity`（`textureImage` 仅保留渲染支持，AI 质感已删除不再生成）。

## 8. IPC 接口（preload 方法 → 主进程 channel）

| 方法 | channel | 说明 |
|---|---|---|
| data / refresh | flowdesk:data / refresh | 全量数据快照 / 重扫（后台补齐新图标并发 icons-ready） |
| open / reveal | flowdesk:open / reveal | 打开（.url 走 openExternal；桌面外 manual 条目直接 openPath）/ 打开所在位置 |
| setCategory | flowdesk:setCategory | 改分类并重扫 |
| manualAdd / manualRemove | flowdesk:manual:add / manual:remove | 拖放手动添加（桌面内走分类覆盖）/ 移除 |
| saveContainers / saveHidden / savePinned | containers:save / hidden:save / pinned:save | 布局、隐藏条目、停靠栏置顶 |
| applyStyle / styleAll | flowdesk:style / style:all | 单窗口/全部外观 |
| hideItem | flowdesk:hideItem | 隐藏单个条目 |
| getSettings / setSettings | settings:get / set | 读/改设置（autoStart 即时写登录项） |
| icon | flowdesk:icon | 取图标 dataURL（缓存缺失时对 manual 条目按需提取） |
| iconsStatus / iconsToggle | icons:status / icons:toggle | 系统桌面图标隐藏/恢复（仅用户主动点击时写注册表） |
| usageClear / appInfo | usage:clear / app:info | 清使用记录 / 版本与数据目录 |
| mouseover / focusMode / ready / quit | send 事件 | 鼠标穿透 / 搜索框键盘焦点模式（setFocusable 切换）/ 渲染就绪 / 退出 |
| 主进程→渲染 | flowdesk:data / icons-ready / viewport / gpu-fallback / show-settings | 数据推送、图标就绪、显示器变化、GPU 降级、托盘"设置"打开面板 |

## 9. 交互模型（务必保持）

- **应用停靠栏**：位置可在设置里改（顶部/底部 × 左/中/右 6 向预设 + 水平/垂直偏移微调）。只有图标（悬停显示名称）。置顶常驻在前（右键图标「📌 置顶/取消置顶」）。滚轮横向滚动（**方向可反转**）。悬浮放大动效（跳跃 1.5 倍 + 上浮跳出背景板 + 两侧推开），左右裁切边界在 `#dock` 自身、不遮挡 ▦ 按钮。
- **应用仓库（▦）**：跟随停靠栏质感/主色；约屏幕 1/3；内部 `#wh-scroll` 滚动（滚动条内嵌）；顶部**搜索框**（名称实时过滤；点击时临时 setFocusable 支持键盘输入，失焦/点击他处恢复）；头部带应用数量与 ✕ 关闭；定位跟随停靠栏（上半屏弹下方）。
- **右侧分类条**：除应用外类别默认**收起成 40px 小条**。点一下 → 就地展开（滚轮浏览）；再点 → 收起。右上角 ⤢ → **单独打开**（屏幕中央放大，其他窗口保留）；聚焦时点其他条直接切换；← 收回。
- **拖放手动添加**：把文件/文件夹拖到对应分类窗口或停靠栏（拖入时高亮）→ 桌面内条目走分类覆盖，桌面外条目存 `config.manualItems` 持久化；右键「🗑 移除手动添加」。
- **自动扫描**：chokidar 监听桌面目录（depth 0，400ms 防抖 + awaitWriteFinish），新增/删除/重命名自动触发 `refreshAll` 重扫；SMOKE 模式不启用。
- **隐藏与恢复**：隐藏条目带 4 秒「↺ 撤销」提示；设置→常规「已隐藏的条目」可逐个/全部恢复；置顶（固定）会自动解除该条目的隐藏。
- **系统托盘**：右键 设置（显示窗口并打开设置面板）/ 隐藏（隐藏覆盖层）/ 退出；左键托盘切换显示。
- **右键菜单**：任意窗口/停靠栏右键 → ⚙ 设置（顶部）、外观与动效、收起、重置归位、隐藏、刷新。条目右键 → 打开/位置/改分类/隐藏（手动条目含移除）。
- **点击穿透**：空白区域 `setIgnoreMouseEvents(true,{forward:true})`，悬停到 `.container/#dock-wrap/#warehouse/.menu/.panel` 时切回可交互。
- **面板可拖动**：设置面板按住标题栏可拖动。

## 10. 推荐评分算法（当前实现）

`usage.js` 中 `computeScore` 的四因子加权（不是旧版两因子公式）：

```
score = 0.42 * recency + 0.25 * frequency + 0.18 * consistency + 0.15 * lifetime

recency     = 最近一次打开（半衰期 5 天，反映当前任务）
frequency   = 近 30 天打开动量（半衰期 10 天；无 history 时回退 log10(opens) 归一化）
consistency = 近 30 天活跃天数 / 7（奖励多天持续使用，而非单日集中点击）
lifetime    = log10(累计 opens+1) / log10(31)（长期常用基础权重）
```

- `opens` 仅来自本软件打开（`usage.recordOpen`）；Recent 同步只更新 `lastOpened`，**不再自动 +1 次数**。
- `history[]` 保留最近 90 条打开时间戳；旧版 usage.json 无 history 时平滑退化为 opens + lastOpened，不丢既有习惯。
- 顶部默认显示 `recommendCount`（默认 8）条，渲染为「智能推荐」条内容。

## 11. 已知的坑（避免回退）

1. **设置改动必须同步渲染层**：`api.setSettings` 只写配置文件，渲染层读的是 `state.data.settings` 快照。所有设置处理器必须用 `applyLocalSettings(patch)`（先 `state.data.settings = {...}` 再持久化），否则改了不生效（曾因此出现「动效类型/靠左靠右改不动」的 bug）。
2. **改动效设置后要 `state.entranceDone = false` 再 render()**，才能重放入场动画让用户看到效果。
3. **PowerShell 下中文文件编辑**：用 `Set-Content -Encoding UTF8` 或 node 脚本（UTF-8）；`Get-Content` 不带 `-Encoding UTF8` 读无 BOM 文件会把中文变乱码；补丁脚本建议 ASCII 锚点或 UTF8 编码。
4. **模板字符串转义**：主进程 `executeJavaScript` 的字符串里写 `\\n` 才会在页面得到换行转义（`\n` 会在模板字符串求值时变成真实换行导致正则/字符串语法错误）。冒烟探测里嵌正则/反斜杠也要注意**双重转义**。
5. **命令长度**：PowerShell 单条命令太长会报「文件名或扩展名太长」，大文件分块写（Set-Content + Add-Content）。
6. **styles.css 曾因追加脚本异常被清空**：改完务必检查花括号配平（`{`/`}` 数量相等）。
7. koffi 返回 HWND 是 number；Electron `getNativeWindowHandle()` 是 Buffer，需 `Number(buf.readBigUInt64LE(0))` 再传给 `void*` 参数；类型用 `int` 代替 `BOOL`。
8. **透明窗口点击穿透初始状态**：boot 里 `api.mouseover(false)` 先置穿透，靠 `forward:true` 的 mousemove 触发悬停恢复。
9. **原生 `<select>` 下拉在点击穿透窗口下不可靠**（下拉打不开/点击无反应），设置控件一律用按钮/开关/滑块；「应用栏位置」「动效类型」（全局 + 逐窗口）均已改为按钮组（勿改回 select）。
10. **focusable:false 窗口里点击输入框不会触发 focus 事件**（activeElement 会设置但 focus 事件不派发）：仓库搜索框必须在 pointerdown 时就调 `api.focusMode(true)`（主进程 setFocusable(true)+focus()），并用「点击其它区域 / window blur」兜底恢复；不能只依赖 focus 事件。
11. **PowerShell 5.1 的 `ConvertTo-Json` 对单元素数组会输出对象而非数组**：scanner 解析快捷方式/提取图标必须用 `DesktopScanner.normalizeRows()` 规范化，否则单条解析静默失败（曾导致所有快捷方式 target 为空、.url 无法正确分类）。快捷方式目标解析已改为**一次批量 PowerShell 调用**（scan 约 0.5s）。
12. **停靠栏布局**：滚轮横滚用 `#dock-track` 的 translateX 实现；左右裁剪用 `#dock { overflow-x: clip; overflow-y: visible; }`（`overflow-x:auto` 会让 overflow-y 被计算为 auto，放大动效的图标会被背景板裁剪）。裁切边界必须在 `#dock` 自身（`max-width: calc(100% - var(--dock-icon-size) - 23px)` 预留分隔线+仓库按钮空间），不能放在 `#dock-wrap`，否则图标轨道会盖住 ▦ 仓库按钮。
13. **PowerShell 管道/heredoc 中文易损坏**：把含中文的补丁脚本经 PowerShell 管道喂给 Python 时，中文会被替换成 `?`。改源码注释/文档请用 Node（MCP node_repl）或 UTF-8 文件写入，避免经 PowerShell 传中文。

## 12. 兼容性要点（已实现）

- 打包策略：**仅 x64 NSIS**（按项目要求，不做 arm64/便携 zip）；koffi 仍按 `process.arch` 自动选预编译二进制。
- 原生层失败自动降级（win32.js 全 try/catch + 能力探测），不崩溃。
- 无 GPU 环境：启动 10s 未收到渲染就绪自动 `--disable-gpu` 重启（`gpuFallbackActive` 标记，正常启动自动清除）。
- 多显示器/混合 DPI：窗口覆盖虚拟屏幕并集，显示器增删/缩放变化重算 + `flowdesk:viewport` 通知渲染层。
- explorer 重启（15s 轮询 PID）与睡眠唤醒：自动重新置底 + 重扫。
- 桌面重定向：用注册表 Shell Folders 解析（OneDrive 兼容），公共桌面合并。
- 离线可用；核心功能不依赖网络。

## 13. 打包发布

```powershell
npm run dist       # x64 NSIS 安装包（dist/）
npm run dist:x64   # 同上（显式指定 x64）
```

- 产物：`灵动桌面 Setup 0.1.6.exe`（x64 安装版）。当前打包策略为仅 x64 NSIS（不做 ARM、不做便携 zip）。
- `asarUnpack: koffi/@koromix` 与 `scripts/**/*`（PowerShell 脚本需真实文件系统）已配好，勿移除。
- 打包前先 `npm test`；改渲染层大改后先 `npm run dist:x64` 验证再全量。

## 14. 已知限制与下一步候选（v2）

- v1 只做「查看/打开」，不提供移动/重命名/删除文件（避免误操作）。
- 逐窗口真毛玻璃（DWM Acrylic）、AI 自动分类、NTFS 最后访问时间（需管理员权限）列 v2。
- 停靠栏放大动效未做「自动吸附 / 预览名称气泡」，可后续加。
- 原生 select 兼容性问题已基本消除（控件已改按钮/开关/滑块）。
- 未做代码签名（预留后续接入自签名 / EV 签名），部分杀软可能误报。

## 15. 给新对话的推荐流程

1. 先读本文件 + `README.md` + `CHANGELOG.md`；
2. `npm test` 确认基线；`npm start` 人工过一遍交互模型（第 9 节）；
3. 小步改动 → `npm run smoke`（记得事后恢复配置）或 `npm test`；
4. 大改渲染层时注意第 11 节的坑；
5. 最终 `npm run dist` 产出安装包交付。
