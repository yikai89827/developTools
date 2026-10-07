# 新闻聚合功能实现计划

## Context

用户需要一个新闻聚合页面，自动搜集全网新闻（百度热榜、微博热搜、抖音热榜、小红书热门笔记、知乎热榜、猫眼票房榜、国内外权威媒体头条、科技圈新闻、中央及湖南省政策新闻），只显示标题/词条，点击用 WebView 打开原文链接。每天上午 10 点全屏弹出提醒查看。

## 数据源策略

由于各大平台（微博/抖音/小红书/知乎等）无公开 API，采用**免费聚合 API + 官方 API/RSS** 混合方案，每个源独立 fetch、独立容错：

| 分类 | 数据源 | 方式 |
|------|--------|------|
| 百度热榜/微博热搜/抖音热榜/知乎热榜/小红书/猫眼 | `https://api.vvhan.com/api/hotlist/*` 各端点 | HTTP GET，返回 JSON 数组 `{title, url, hot}` |
| 科技新闻 | Hacker News 官方 API `https://hacker-news.firebaseio.com/v0/topstories.json` | 取前 15 条，再批量取 item 详情 |
| 国际媒体头条 | RSS 订阅源（BBC/Reuters/CNN via `rsshub.app`） | RSS 解析（内置简易 XML parser） |
| 国内媒体 | 新华社/人民网 RSS | 同上 |
| 中央政策 | 中国政府网 RSS `rsshub.app/gov/china/policy` | 同上 |
| 湖南省政策 | `rsshub.app/gov/hunan/policy` | 同上 |

> 聚合 API 可能不稳定，每个源 try-catch 独立处理，失败显示"获取失败"不阻塞其他源。结果缓存到本地 JSON 文件，30 分钟内不重复请求。

## 实现步骤

### 1. 主进程：新闻数据获取模块 `js/news-fetcher.js`（新建）

- 导出 `fetchAllNews()` — 并发 fetch 所有源，返回 `{ source, items: [{title, url, hot?}], ok, error }`
- 导出 `getCachedNews()` — 读取本地缓存 `dev-tools-news.json`
- 导出 `fetchSingleSource(sourceId)` — 单源刷新
- 内置简易 RSS XML parser（`DOMParser` 在主进程不可用，用正则提取 `<item><title>` 和 `<link>`）
- axios 已在 dependencies 中，直接使用
- 缓存文件路径：`app.getPath('userData')/dev-tools-news.json`，含 `timestamp` 和各源数据

### 2. 主进程：定时调度 + 全屏提醒窗口（main.js）

复用 clock reminder 的调度模式（`setInterval` 30s 检查 + `lastReminderKey` 防重复）：

- 新增变量：`newsTimer`, `newsConfig`, `newsReminderWindows[]`
- 新增配置文件：`dev-tools-news-config.json`，默认 `{ enabled: true, time: '10:00' }`
- `initNewsReminder()` — 在 `app.whenReady()` 中调用，加载配置 + 启动定时器
- `checkNewsReminder()` — 检查是否到点，触发 `showNewsReminder()`
- `showNewsReminder()` — 复用 clock reminder 的多屏全屏窗口模式，加载 `news-reminder.html`
- IPC handlers：
  - `ipcMain.handle('news-get-all')` — 返回缓存/刷新的新闻数据
  - `ipcMain.handle('news-refresh')` — 强制刷新所有源
  - `ipcMain.handle('news-refresh-source', (e, id))` — 刷新单个源
  - `ipcMain.on('news-save-config')` — 保存提醒配置
  - `ipcMain.handle('news-get-config')` — 读取配置
  - `ipcMain.on('news-open-webview', (e, url, title))` — 创建 WebView 窗口
  - `ipcMain.on('news-reminder-close')` — 关闭全屏提醒

### 3. WebView 窗口（main.js）

- `openNewsWebView(url, title)` — 创建 `BrowserWindow`（800×600，有标题栏），`loadURL(url)`
- 限制同时打开最多 5 个 WebView 窗口

### 4. 全屏提醒页面 `news-reminder.html`（新建）

- 复用 `clock-reminder.html` 的全屏透明覆盖窗口样式
- 内容：标题"今日新闻速览" + 时间，按分类展示前 5 条标题
- 点击标题 → `ipcRenderer.send('news-open-webview', url, title)`
- 底部按钮："查看全部"（打开主窗口新闻面板）、"稍后提醒"（10 分钟后再弹）、"关闭"

### 5. 新闻聚合面板（index.html + js/tools/news.js）

**index.html**：
- 侧边栏添加：`<button class="tool-btn" data-tool="news"><span class="icon">📰</span><span class="label">新闻聚合</span></button>`（在 clock 按钮前）
- 面板区添加：`<div id="news-tool" class="tool-panel">` — 包含：
  - 顶部工具栏：刷新全部按钮、最后更新时间、提醒设置（启用 checkbox + 时间 input + 保存）
  - 新闻分类区：每个源一个 `<div class="news-source-block">`，含源名、状态、标题列表
  - 标题列表：`<a class="news-item">` 只显示文字，点击发 IPC 打开 WebView

**tools-config.js**：
- TOOLS 数组添加 `{ id: 'news', icon: '📰', label: '新闻聚合' }`（无快捷键，或分配 Ctrl+Q 如果用户需要）

**js/tools/news.js**（新建）：
- `initNewsTool()` — 获取 DOM、绑定事件、首次加载数据
- `renderNews(data)` — 渲染各源新闻列表
- `renderSourceBlock(source, items, ok)` — 渲染单个源
- 事件：刷新全部、刷新单源、点击标题打开 WebView、保存提醒配置

### 6. 主入口初始化

- `js/main.js`（渲染进程入口）— 添加 `initNewsTool()` 调用
- `main.js`（主进程）— 在 `app.whenReady()` 的 `initClockReminder()` 后添加 `initNewsReminder()`

### 7. 样式 `styles.css`

追加新闻面板样式：
- `.news-toolbar` — 顶部工具栏 flex 布局
- `.news-source-block` — 每个源的卡片样式
- `.news-source-header` — 源名 + 状态标签 + 刷新按钮
- `.news-item` — 标题项，hover 高亮，cursor pointer
- `.news-item-hot` — 热度数字标签
- `.news-status-fail` — 失败状态红色
- `.news-reminder-*` — 全屏提醒页样式

## 关键复用

- **全屏窗口创建**：复用 [main.js:914-967](file:///d:/work/developTools/main.js#L914) 的 `showClockReminder()` 多屏窗口模式
- **定时调度**：复用 [main.js:857-911](file:///d:/work/developTools/main.js#L857) 的 `startClockTimer()` / `checkClockReminder()` 模式
- **配置持久化**：复用 [main.js:832-848](file:///d:/work/developTools/main.js#L832) 的 `loadClockConfig()` / `saveClockConfig()` JSON 文件模式
- **HTTP 请求**：使用已有的 `axios` 依赖
- **侧边栏切换**：复用 [js/sidebar.js](file:///d:/work/developTools/js/sidebar.js) 的 `switchTool()` 机制，只需在 index.html 添加对应 panel 和按钮

## 验证方式

1. `npm start` 启动应用，侧边栏出现"📰 新闻聚合"
2. 点击进入，各源新闻列表加载（部分可能因 API 不稳定显示"获取失败"，属正常）
3. 点击标题，弹出 WebView 窗口打开原文
4. 在提醒设置中修改时间为当前时间+2分钟，等待全屏提醒弹出
5. 全屏提醒中点击"查看全部"跳转主面板，点击"稍后提醒"10分钟后重弹
6. 关闭应用重启，配置和缓存保持
