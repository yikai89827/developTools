const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session, desktopCapturer, Tray, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const axios = require('axios');
const { TOOLS, SHORTCUT_MAP, SCREENSHOT_SHORTCUT } = require('./js/tools-config');

let mainWindow;
let floatWindow;
let tray = null;
let captureWindow = null;
let currentTool = 'generator';
let isCapturing = false;
let capturePromiseResolve = null;
let capturePromiseReject = null;
// 标记是否真正退出，用于区分关闭按钮（最小化到托盘）和托盘退出
let isQuiting = false;

// ── 打卡提醒 ──
let clockReminderWindows = []; // 多屏时每个屏幕一个窗口
let clockTimer = null;
let clockConfig = null;
let clockSnoozeTimer = null;
let lastReminderKey = ''; // 防止同一提醒点重复触发

const CLOCK_CONFIG_FILE = path.join(
  (process.env.APPDATA || process.env.HOME || '.'),
  'dev-tools-clock.json'
);

// ── 新闻聚合提醒 ──
let newsTimer = null;
let newsConfig = null;
let newsReminderWindows = [];
let newsSnoozeTimer = null;
let lastNewsReminderKey = '';
let newsWebViewWindows = [];
let newsReaderWindow = null;
let newsReaderReady = false;
let newsReaderQueue = [];

const NEWS_CONFIG_FILE = path.join(
  (process.env.APPDATA || process.env.HOME || '.'),
  'dev-tools-news-config.json'
);

const DEFAULT_NEWS_CONFIG = {
  enabled: true,
  time: '10:00'
};

// 新闻数据获取模块（延迟 require，需要 app.getPath）
let newsFetcher = null;
function getNewsFetcher() {
  if (!newsFetcher) {
    newsFetcher = require('./js/news-fetcher');
  }
  return newsFetcher;
}

const COLLAPSED_WIDTH = 56;
const COLLAPSED_HEIGHT = 56;
const EXPANDED_WIDTH = 210;
const EXPANDED_MAX_HEIGHT = 520;

// 图标资源：统一从 assets/ 加载，开发版和打包版路径一致
// assets/ 通过 files 配置打包到 asar 内
const ICON_ICO = path.join(__dirname, 'assets', 'icon.ico');
const ICON_PNG = path.join(__dirname, 'assets', 'icon.png');

function getAppIcon() {
  // 优先加载 .ico（含 16/32/48/256 多尺寸，Windows 自动选最合适）
  if (fs.existsSync(ICON_ICO)) {
    return ICON_ICO;
  }
  if (fs.existsSync(ICON_PNG)) {
    return ICON_PNG;
  }
  return undefined;
}

function getTrayIconImage() {
  // Tray 在某些 Windows 版本对 asar 内的 PNG 加载不稳定，用 nativeImage 显式处理
  let img;
  if (fs.existsSync(ICON_ICO)) {
    img = nativeImage.createFromPath(ICON_ICO);
    if (!img.isEmpty()) return img;
  }
  if (fs.existsSync(ICON_PNG)) {
    img = nativeImage.createFromPath(ICON_PNG);
    if (!img.isEmpty()) {
      // 256x256 太大，托盘显示会模糊；缩小到 16x16 更清晰
      return img.resize({ width: 16, height: 16 });
    }
  }
  return nativeImage.createEmpty();
}

// 悬浮窗尺寸：球态固定 56x56，展开为固定宽度面板
function getFloatSize(expanded) {
  if (expanded) {
    const display = screen.getPrimaryDisplay();
    const sh = display.workAreaSize.height;
    return {
      width: EXPANDED_WIDTH,
      height: Math.min(EXPANDED_MAX_HEIGHT, sh - 40)
    };
  }
  return { width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT };
}

// 计算贴边后的位置：吸附到最近的屏幕边缘，露出半圆
function getDockedBounds(x, y, w, h, expanded) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const { x: sx, y: sy } = display.workArea;

  if (expanded) {
    // 展开面板：贴右侧
    return {
      x: sx + sw - w,
      y: sy + Math.max(0, Math.min(y - sy, sh - h)),
      width: w,
      height: h
    };
  }

  // 球态：判断离哪条边最近
  const half = w / 2;
  const distLeft = x - sx;
  const distRight = (sx + sw) - (x + w);
  const distTop = y - sy;
  const distBottom = (sy + sh) - (y + h);

  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  let dockX, dockY;
  if (minDist === distLeft) {
    // 贴左：露右半圆
    dockX = sx - half;
    dockY = y;
  } else if (minDist === distRight) {
    // 贴右：露左半圆
    dockX = sx + sw - half;
    dockY = y;
  } else if (minDist === distTop) {
    // 贴上：露下半圆
    dockX = x;
    dockY = sy - half;
  } else {
    // 贴下：露上半圆
    dockX = x;
    dockY = sy + sh - half;
  }

  // 限制在屏幕范围内（避免完全飞出）
  dockY = Math.max(sy - half, Math.min(dockY, sy + sh - half));
  dockX = Math.max(sx - half, Math.min(dockX, sx + sw - half));

  return { x: dockX, y: dockY, width: w, height: h };
}

// 保存/恢复悬浮窗位置
const FLOAT_POS_FILE = path.join(
  (process.env.APPDATA || process.env.HOME || '.'),
  'dev-tools-float-pos.json'
);

function saveFloatPosition(x, y, edge) {
  try {
    fs.writeFileSync(FLOAT_POS_FILE, JSON.stringify({ x, y, edge }, null, 2));
  } catch (e) {
    console.error('[float] 保存位置失败:', e.message);
  }
}

function loadFloatPosition() {
  try {
    if (fs.existsSync(FLOAT_POS_FILE)) {
      return JSON.parse(fs.readFileSync(FLOAT_POS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[float] 读取位置失败:', e.message);
  }
  return null;
}

function getDefaultFloatBounds() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const { x: sx, y: sy } = display.workArea;
  // 默认贴右边缘，垂直居中
  const half = COLLAPSED_WIDTH / 2;
  return {
    x: sx + sw - half,
    y: sy + Math.floor((sh - COLLAPSED_HEIGHT) / 2),
    width: COLLAPSED_WIDTH,
    height: COLLAPSED_HEIGHT
  };
}

function isMainWindowActive() {
  return mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();
}

// 从隐藏/最小化状态恢复窗口（解决 hide() 后 show() 不激活的问题）
function bringMainWindowToFront() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  // 不用 setAlwaysOnTop 切换，避免 Windows 窗口管理器异常最小化
  // 直接 focus + showInactive 组合确保激活
  mainWindow.showInactive();
  mainWindow.focus();
  hideFloatWindow();
}

function openTool(tool) {
  if (!mainWindow) return;
  currentTool = tool;
  bringMainWindowToFront();
  mainWindow.webContents.send('open-tool', tool);
}

function handleToolShortcut(tool) {
  if (!mainWindow) return;
  if (isMainWindowActive() && currentTool === tool) {
    // 已显示且是同一工具 → 隐藏到托盘
    hideMainWindowToTray();
    return;
  }
  openTool(tool);
}

function restoreMainWindow() {
  if (!mainWindow) return;
  bringMainWindowToFront();
}

// 最小化/隐藏到托盘
function hideMainWindowToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  showFloatWindow();
}

function createFloatWindow() {
  if (floatWindow) return;

  // 读取上次位置，没有则用默认（贴右居中）
  const saved = loadFloatPosition();
  const initialBounds = saved
    ? { x: saved.x, y: saved.y, width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }
    : getDefaultFloatBounds();

  floatWindow = new BrowserWindow({
    ...initialBounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  floatWindow.setAlwaysOnTop(true, 'screen-saver');
  floatWindow.loadFile('float.html');

  // 加载完成后通知前端当前是否贴边
  floatWindow.webContents.on('did-finish-load', () => {
    if (saved && saved.edge) {
      floatWindow.webContents.send('float-set-edge', saved.edge);
    }
  });

  floatWindow.on('closed', () => {
    floatWindow = null;
  });
}

function showFloatWindow() {
  if (!floatWindow) createFloatWindow();
  if (!floatWindow) return;
  // 恢复到球态，保持上次位置
  const saved = loadFloatPosition();
  const bounds = saved
    ? { x: saved.x, y: saved.y, width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }
    : getDefaultFloatBounds();
  floatWindow.setBounds(bounds);
  if (saved && saved.edge) {
    floatWindow.webContents.send('float-set-edge', saved.edge);
  }
  floatWindow.webContents.send('float-collapse');
  floatWindow.showInactive();
  // 重新置顶到最高层级，防止被其他窗口遮挡
  floatWindow.setAlwaysOnTop(true, 'screen-saver');
}

function hideFloatWindow() {
  if (floatWindow && floatWindow.isVisible()) {
    floatWindow.hide();
  }
}

function createTray() {
  try {
    const iconImage = getTrayIconImage();
    if (!iconImage.isEmpty()) {
      tray = new Tray(iconImage);
    } else if (fs.existsSync(ICON_PNG)) {
      tray = new Tray(ICON_PNG);
    } else {
      console.error('[tray] 图标文件不存在，跳过托盘创建');
      return;
    }

    const contextMenu = Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => restoreMainWindow() },
      { type: 'separator' },
      { label: '退出', click: () => { isQuiting = true; app.quit(); } }
    ]);

    tray.setToolTip('豆豆开发者工具');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      // 切换显示/隐藏
      if (isMainWindowActive()) {
        hideMainWindowToTray();
      } else {
        restoreMainWindow();
      }
    });
  } catch (err) {
    console.error('[tray] 创建托盘失败:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webviewTag: true
    },
    icon: getAppIcon(),
    skipTaskbar: false,
    show: true
  });

  mainWindow.loadFile('index.html');

  // 最小化 → 隐藏到托盘，不在任务栏显示
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    hideMainWindowToTray();
  });

  // 关闭按钮 → 隐藏到托盘，只有 isQuiting 时才真正关闭
  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      hideMainWindowToTray();
    }
  });

  mainWindow.on('restore', () => {
    hideFloatWindow();
  });

  mainWindow.on('show', () => {
    if (!mainWindow.isMinimized()) {
      hideFloatWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (floatWindow) {
      floatWindow.close();
      floatWindow = null;
    }
  });
}

function buildMenu() {
  const toolItems = TOOLS.map(tool => {
    const item = {
      label: tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label,
      click: () => openTool(tool.id)
    };
    // 若全局快捷键注册失败，挂上菜单加速器作为回退（窗口聚焦时可用）
    if (tool.shortcut && failedShortcuts.has(tool.shortcut)) {
      item.accelerator = tool.shortcut;
    }
    return item;
  });

  const screenshotItem = {
    label: `区域截图 (${SCREENSHOT_SHORTCUT})`,
    click: () => triggerScreenshot()
  };
  if (failedShortcuts.has(SCREENSHOT_SHORTCUT)) {
    screenshotItem.accelerator = SCREENSHOT_SHORTCUT;
  }

  const template = [
    {
      label: '工具',
      submenu: [
        ...toolItems,
        { type: 'separator' },
        screenshotItem,
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键', accelerator: 'F1', click: () => mainWindow?.webContents.send('show-shortcuts') }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function triggerScreenshot() {
  if (isCapturing || !mainWindow) return;
  openTool('image');
  mainWindow.webContents.send('trigger-screenshot');
}

// 全局快捷键注册失败的回退表（用于在窗口菜单上提供加速器作为备用）
const failedShortcuts = new Set();

function registerGlobalShortcuts() {
  // 先清理之前可能存在的注册（重复启动场景）
  globalShortcut.unregisterAll();

  let okCount = 0;

  Object.entries(SHORTCUT_MAP).forEach(([key, toolId]) => {
    const acc = `Ctrl+${key}`;
    let ok;
    try {
      ok = globalShortcut.register(acc, () => handleToolShortcut(toolId));
    } catch (e) {
      ok = false;
    }
    if (ok === false) {
      failedShortcuts.add(acc);
    } else {
      okCount++;
      failedShortcuts.delete(acc);
    }
  });

  try {
    const ok = globalShortcut.register(SCREENSHOT_SHORTCUT, () => triggerScreenshot());
    if (ok !== false) okCount++;
    else failedShortcuts.add(SCREENSHOT_SHORTCUT);
  } catch (e) {
    failedShortcuts.add(SCREENSHOT_SHORTCUT);
  }

  if (okCount > 0) {
    console.log(`[shortcut] 全局快捷键注册成功 ${okCount} 个`);
  }
  if (failedShortcuts.size > 0) {
    console.warn(`[shortcut] 注册失败（可能被其他程序占用）: ${Array.from(failedShortcuts).join(', ')}`);
    console.warn('[shortcut] 失败的快捷键已挂载到菜单加速器，主窗口聚焦时可用');
  }
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback(sources.length ? { video: sources[0], audio: false } : {});
    }).catch(() => callback({}));
  });

  createWindow();
  createFloatWindow();
  createTray();
  // 先注册快捷键（填充 failedShortcuts 表），再构建菜单（消费该表挂载加速器回退）
  registerGlobalShortcuts();
  buildMenu();
  // 初始化打卡提醒
  initClockReminder();
  // 初始化新闻聚合提醒
  initNewsReminder();
  // 开机自启动：读取配置，若用户已启用则写入系统注册表
  syncAutoLaunch();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// macOS 上保持运行；其他平台只有窗口真正关闭（非隐藏到托盘）才退出
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // mainWindow 非空说明是 hide() 不是 close，保持运行
  if (mainWindow !== null) return;
  app.quit();
});

// before-quit 确保快捷键在退出前已注销，避免残留
app.on('before-quit', () => {
  isQuiting = true;
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

ipcMain.on('set-current-tool', (event, tool) => {
  currentTool = tool;
});

ipcMain.on('tool-shortcut', (event, tool) => {
  handleToolShortcut(tool);
});

ipcMain.on('float-open-tool', (event, tool) => {
  openTool(tool);
});

ipcMain.on('float-restore-main', () => {
  restoreMainWindow();
});

// 展开/收起：动态调整窗口尺寸，并保持位置合理
ipcMain.on('float-set-expanded', (event, expanded) => {
  if (!floatWindow) return;
  const current = floatWindow.getBounds();
  const size = getFloatSize(expanded);
  if (expanded) {
    // 展开为右侧面板：以当前球心为基准，面板靠右
    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = display.workAreaSize;
    const { x: sx, y: sy } = display.workArea;
    const newY = sy + Math.max(0, Math.min(current.y - sy, sh - size.height));
    floatWindow.setBounds({
      x: sx + sw - size.width,
      y: newY,
      width: size.width,
      height: size.height
    });
  } else {
    // 收起为球态：在当前位置贴边
    const docked = getDockedBounds(current.x, current.y, size.width, size.height, false);
    floatWindow.setBounds(docked);
    // 保存位置和边缘
    const edge = detectEdge(docked.x, docked.y, size.width, size.height);
    saveFloatPosition(docked.x, docked.y, edge);
  }
});

// 拖动状态管理
let floatDragging = false;
let floatDragTimer = null;
let floatDragStartPos = null;

// 拖动开始：记录起点，启动轮询
ipcMain.on('float-drag-start', () => {
  if (!floatWindow || floatDragging) return;
  floatDragging = true;
  floatDragStartPos = screen.getCursorScreenPoint();
  const size = getFloatSize(false);

  // Windows 下用 hookWindowMessage 监听全局鼠标释放
  if (process.platform === 'win32') {
    try {
      // WM_LBUTTONUP = 0x0202
      floatWindow.hookWindowMessage(0x0202, () => {
        if (floatDragging) {
          endFloatDrag();
        }
      });
    } catch (e) {
      // 回退：用轮询检测鼠标停止
    }
  }

  // 每 16ms 轮询鼠标位置，更新窗口位置
  if (floatDragTimer) clearInterval(floatDragTimer);
  floatDragTimer = setInterval(() => {
    if (!floatDragging || !floatWindow) return;
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - floatDragStartPos.x;
    const dy = cursor.y - floatDragStartPos.y;

    // 移动超过 4px 才算拖动
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      const newX = cursor.x - size.width / 2;
      const newY = cursor.y - size.height / 2;
      floatWindow.setBounds({ x: newX, y: newY, width: size.width, height: size.height });
      floatWindow.webContents.send('float-dragging');
    }
  }, 16);
});

// 结束拖动：贴边吸附
function endFloatDrag() {
  if (!floatDragging) return;
  floatDragging = false;
  if (floatDragTimer) {
    clearInterval(floatDragTimer);
    floatDragTimer = null;
  }
  // 取消 Windows 消息钩子
  if (process.platform === 'win32' && floatWindow && !floatWindow.isDestroyed()) {
    try {
      floatWindow.unhookWindowMessage(0x0202);
    } catch (e) {}
  }
  if (!floatWindow) return;
  const size = getFloatSize(false);
  const cursor = screen.getCursorScreenPoint();
  const realX = cursor.x - size.width / 2;
  const realY = cursor.y - size.height / 2;
  const docked = getDockedBounds(realX, realY, size.width, size.height, false);
  floatWindow.setBounds(docked);
  const edge = detectEdge(docked.x, docked.y, size.width, size.height);
  saveFloatPosition(docked.x, docked.y, edge);
  floatWindow.webContents.send('float-set-edge', edge);
}

// 拖动结束：前端 mouseup 触发（如果 hookWindowMessage 已处理则忽略重复调用）
ipcMain.on('float-drag-end', () => {
  endFloatDrag();
});

// 判断当前贴边方向
function detectEdge(x, y, w, h) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const { x: sx, y: sy } = display.workArea;
  const half = w / 2;
  // 窗口边缘超出屏幕边缘半圆宽度算作贴边
  if (x <= sx - half + 2) return 'left';
  if (x + w >= sx + sw + half - 2) return 'right';
  if (y <= sy - half + 2) return 'top';
  if (y + h >= sy + sh + half - 2) return 'bottom';
  return 'none';
}

function getScreenSource(sources, display) {
  const displayId = String(display.id);
  return sources.find(s => s.display_id === displayId) || sources[0];
}

async function captureRegion(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const scaleFactor = display.scaleFactor;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scaleFactor),
      height: Math.round(display.size.height * scaleFactor)
    }
  });

  const source = getScreenSource(sources, display);
  if (!source) throw new Error('未找到可截取的屏幕');

  const cropX = Math.round((bounds.x - display.bounds.x) * scaleFactor);
  const cropY = Math.round((bounds.y - display.bounds.y) * scaleFactor);
  const cropW = Math.round(bounds.width * scaleFactor);
  const cropH = Math.round(bounds.height * scaleFactor);

  return source.thumbnail.crop({
    x: Math.max(0, cropX),
    y: Math.max(0, cropY),
    width: cropW,
    height: cropH
  }).toDataURL();
}

function closeCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.destroy();
  }
  captureWindow = null;
}

function finishCapture(dataUrl) {
  isCapturing = false;
  closeCaptureWindow();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  if (capturePromiseResolve) {
    capturePromiseResolve(dataUrl);
    capturePromiseResolve = null;
    capturePromiseReject = null;
  }
}

function abortCapture(error) {
  isCapturing = false;
  closeCaptureWindow();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  if (capturePromiseReject) {
    capturePromiseReject(error);
    capturePromiseResolve = null;
    capturePromiseReject = null;
  }
}

function openCaptureOverlay() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  captureWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  captureWindow.setAlwaysOnTop(true, 'screen-saver');

  captureWindow.webContents.on('did-finish-load', () => {
    captureWindow.webContents.send('capture-init', { x, y });
    captureWindow.show();
    captureWindow.focus();
  });

  captureWindow.loadFile('screenshot-overlay.html');

  captureWindow.on('closed', () => {
    captureWindow = null;
    if (isCapturing) {
      abortCapture(new Error('已取消截图'));
    }
  });
}

ipcMain.handle('start-region-capture', async () => {
  if (isCapturing) throw new Error('截图进行中');

  return new Promise((resolve, reject) => {
    capturePromiseResolve = resolve;
    capturePromiseReject = reject;
    isCapturing = true;

    hideFloatWindow();
    if (mainWindow) mainWindow.hide();

    setTimeout(() => openCaptureOverlay(), 280);
  });
});

ipcMain.on('capture-region-confirm', async (event, bounds) => {
  try {
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.hide();
    }
    await new Promise(r => setTimeout(r, 180));
    const dataUrl = await captureRegion(bounds);
    finishCapture(dataUrl);
  } catch (error) {
    abortCapture(error);
  }
});

ipcMain.on('capture-region-cancel', () => {
  abortCapture(new Error('已取消截图'));
});

ipcMain.on('save-file', (event, data) => {
  const { content, filePath } = data;
  fs.writeFileSync(filePath, content);
  event.reply('save-file-reply', '保存成功');
});

ipcMain.on('read-file', (event, filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  event.reply('read-file-reply', content);
});

// ═══════════════════════════════════════════════
//  图片批量尺寸修改
// ═══════════════════════════════════════════════

// 默认输出目录：跟随应用安装目录（或开发目录），避免用户配置目录不可写
function getDefaultBatchOutputDir() {
  const appRoot = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
  return path.join(appRoot, 'batch-images');
}

// 渲染层查询默认输出目录
ipcMain.handle('resize-get-default-dir', () => {
  const dir = getDefaultBatchOutputDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
});

// 渲染层选择新输出目录
ipcMain.handle('resize-select-output-dir', async () => {
  if (!mainWindow) return { ok: false };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择批量输出目录'
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  return { ok: true, dir: result.filePaths[0] };
});

// 渲染层打开文件夹
ipcMain.handle('resize-open-folder', async (event, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return { ok: false, error: '目录不存在' };
  shell.openPath(dirPath);
  return { ok: true };
});

// ═══════════════════════════════════════════════
//  打卡提醒功能
// ═══════════════════════════════════════════════

const DEFAULT_CLOCK_CONFIG = {
  enabled: true,
  workdaysOnly: true,
  onTime: '09:00',
  offTime: '18:00',
  onBeforeMinutes: 10,
  offAfterMinutes: 10
};

function loadClockConfig() {
  try {
    if (fs.existsSync(CLOCK_CONFIG_FILE)) {
      const raw = fs.readFileSync(CLOCK_CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CLOCK_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('[clock] 加载配置失败:', e.message);
  }
  return { ...DEFAULT_CLOCK_CONFIG };
}

function saveClockConfig(cfg) {
  try {
    fs.writeFileSync(CLOCK_CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[clock] 保存配置失败:', e.message);
  }
}

function initClockReminder() {
  clockConfig = loadClockConfig();
  startClockTimer();
}

function startClockTimer() {
  if (clockTimer) clearInterval(clockTimer);
  // 每 30 秒检查一次
  clockTimer = setInterval(checkClockReminder, 30000);
  // 立即检查一次
  checkClockReminder();
}

function checkClockReminder() {
  if (!clockConfig || !clockConfig.enabled) return;
  if (clockReminderWindows.length) return; // 已在提醒中

  const now = new Date();
  const day = now.getDay(); // 0=周日, 6=周六

  // 仅工作日
  if (clockConfig.workdaysOnly && (day === 0 || day === 6)) return;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const currentHM = `${hh}:${mm}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // 计算上班提醒时间
  const [onH, onM] = clockConfig.onTime.split(':').map(Number);
  const onTotal = onH * 60 + onM;
  const onReminderTotal = onTotal - clockConfig.onBeforeMinutes;
  const onReminderKey = `on_${now.toDateString()}`;

  // 计算下班提醒时间
  const [offH, offM] = clockConfig.offTime.split(':').map(Number);
  const offTotal = offH * 60 + offM;
  const offReminderTotal = offTotal + clockConfig.offAfterMinutes;
  const offReminderKey = `off_${now.toDateString()}`;

  // 检查上班提醒：在提醒时间点±1分钟内触发
  if (lastReminderKey !== onReminderKey &&
      nowMinutes >= onReminderTotal && nowMinutes <= onReminderTotal + 1) {
    lastReminderKey = onReminderKey;
    showClockReminder('on', clockConfig.onTime);
    return;
  }

  // 检查下班提醒
  if (lastReminderKey !== offReminderKey &&
      nowMinutes >= offReminderTotal && nowMinutes <= offReminderTotal + 1) {
    lastReminderKey = offReminderKey;
    showClockReminder('off', clockConfig.offTime);
    return;
  }

  // 每天零点重置 lastReminderKey
  if (now.getHours() === 0 && now.getMinutes() < 1) {
    lastReminderKey = '';
  }
}

function showClockReminder(type, workTime) {
  if (clockReminderWindows.length) return;

  // 多屏办公：为每个显示器创建一个覆盖窗口
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;

  displays.forEach((display) => {
    // display.bounds 是该屏幕在虚拟桌面中的真实坐标矩形
    const { x, y, width, height } = display.bounds;

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    win.setAlwaysOnTop(true, 'screen-saver');

    win.loadFile('clock-reminder.html', {
      query: { type, time: workTime }
    });

    // 主屏 focus，其他屏 showInactive，避免抢焦点冲突
    win.webContents.on('did-finish-load', () => {
      if (display.id === primaryId) {
        win.show();
        win.focus();
      } else {
        win.showInactive();
      }
    });

    win.on('closed', () => {
      clockReminderWindows = clockReminderWindows.filter(w => w !== win);
    });

    clockReminderWindows.push(win);
  });
}

function closeClockReminder() {
  if (clockSnoozeTimer) {
    clearTimeout(clockSnoozeTimer);
    clockSnoozeTimer = null;
  }
  // 关闭所有屏幕的提醒窗口
  clockReminderWindows.forEach(w => {
    if (!w.isDestroyed()) w.destroy();
  });
  clockReminderWindows = [];
}

function snoozeClockReminder(type) {
  closeClockReminder();
  // 5分钟后再次提醒
  clockSnoozeTimer = setTimeout(() => {
    const workTime = type === 'on' ? clockConfig.onTime : clockConfig.offTime;
    showClockReminder(type, workTime);
  }, 5 * 60 * 1000);
}

// IPC: 保存打卡配置
ipcMain.on('clock-save-config', (event, cfg) => {
  clockConfig = { ...DEFAULT_CLOCK_CONFIG, ...cfg };
  saveClockConfig(clockConfig);
  startClockTimer();
  event.reply('clock-config-saved', true);
});

// IPC: 读取打卡配置
ipcMain.handle('clock-get-config', () => {
  return clockConfig || loadClockConfig();
});

// IPC: 预览上班/下班提醒
ipcMain.on('clock-test-reminder', (event, type) => {
  const workTime = type === 'on' ? clockConfig.onTime : clockConfig.offTime;
  showClockReminder(type, workTime);
});

// IPC: 关闭提醒窗口
ipcMain.on('clock-reminder-close', () => {
  closeClockReminder();
});

// IPC: 稍后提醒
ipcMain.on('clock-reminder-snooze', (event, type) => {
  snoozeClockReminder(type);
});

// IPC: 获取下次提醒信息
ipcMain.handle('clock-get-next-reminder', () => {
  if (!clockConfig || !clockConfig.enabled) return { next: '未启用', enabled: false };
  const now = new Date();
  const day = now.getDay();
  if (clockConfig.workdaysOnly && (day === 0 || day === 6)) {
    return { next: '周末不提醒', enabled: true };
  }
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [onH, onM] = clockConfig.onTime.split(':').map(Number);
  const [offH, offM] = clockConfig.offTime.split(':').map(Number);
  const onReminderTotal = onH * 60 + onM - clockConfig.onBeforeMinutes;
  const offReminderTotal = offH * 60 + offM + clockConfig.offAfterMinutes;

  if (nowMinutes < onReminderTotal) {
    return { next: `上班提醒 ${clockConfig.onTime}（提前${clockConfig.onBeforeMinutes}分钟）`, enabled: true };
  } else if (nowMinutes < offReminderTotal) {
    return { next: `下班提醒 ${clockConfig.offTime}（延后${clockConfig.offAfterMinutes}分钟）`, enabled: true };
  }
  return { next: '今日提醒已过', enabled: true };
});

// ═══════════════════════════════════════════════
//  新闻聚合提醒
// ═══════════════════════════════════════════════

function loadNewsConfig() {
  try {
    if (fs.existsSync(NEWS_CONFIG_FILE)) {
      const raw = fs.readFileSync(NEWS_CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_NEWS_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('[news] 加载配置失败:', e.message);
  }
  return { ...DEFAULT_NEWS_CONFIG };
}

function saveNewsConfig(cfg) {
  try {
    fs.writeFileSync(NEWS_CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[news] 保存配置失败:', e.message);
  }
}

function initNewsReminder() {
  newsConfig = loadNewsConfig();
  startNewsTimer();
}

function startNewsTimer() {
  if (newsTimer) clearInterval(newsTimer);
  newsTimer = setInterval(checkNewsReminder, 30000);
  checkNewsReminder();
}

function checkNewsReminder() {
  if (!newsConfig || !newsConfig.enabled) return;
  if (newsReminderWindows.length) return;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [tH, tM] = (newsConfig.time || '10:00').split(':').map(Number);
  const targetTotal = tH * 60 + tM;
  const reminderKey = `news_${now.toDateString()}`;

  if (lastNewsReminderKey !== reminderKey &&
      nowMinutes >= targetTotal && nowMinutes <= targetTotal + 1) {
    lastNewsReminderKey = reminderKey;
    showNewsReminder();
  }

  // 零点重置
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    lastNewsReminderKey = '';
  }
}

function showNewsReminder() {
  if (newsReminderWindows.length) return;

  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;

  displays.forEach((display) => {
    const { x, y, width, height } = display.bounds;

    const win = new BrowserWindow({
      x, y, width, height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile('news-reminder.html');

    win.webContents.on('did-finish-load', () => {
      if (display.id === primaryId) {
        win.show();
        win.focus();
      } else {
        win.showInactive();
      }
    });

    win.on('closed', () => {
      newsReminderWindows = newsReminderWindows.filter(w => w !== win);
    });

    newsReminderWindows.push(win);
  });
}

function closeNewsReminder() {
  if (newsSnoozeTimer) {
    clearTimeout(newsSnoozeTimer);
    newsSnoozeTimer = null;
  }
  newsReminderWindows.forEach(w => {
    try { w.close(); } catch {}
  });
  newsReminderWindows = [];
}

function snoozeNewsReminder() {
  closeNewsReminder();
  newsSnoozeTimer = setTimeout(() => {
    showNewsReminder();
  }, 10 * 60 * 1000);
}

// 打开新闻阅读窗口（单窗口多页签）
function openNewsReaderTab(url, title) {
  if (!url) return;

  if (newsReaderWindow && !newsReaderWindow.isDestroyed()) {
    // 窗口已存在
    if (newsReaderReady) {
      newsReaderWindow.webContents.send('news-add-tab', { url, title });
    } else {
      newsReaderQueue.push({ url, title });
    }
    // 把窗口提到前面
    if (newsReaderWindow.isMinimized()) newsReaderWindow.restore();
    newsReaderWindow.focus();
  } else {
    // 创建新窗口
    newsReaderReady = false;
    newsReaderQueue = [{ url, title }];
    newsReaderWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      title: '新闻阅读',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webviewTag: true
      }
    });
    newsReaderWindow.loadFile('news-reader.html');
    newsReaderWindow.on('closed', () => {
      newsReaderWindow = null;
      newsReaderReady = false;
      newsReaderQueue = [];
    });
  }
}

// ── 新闻 IPC ──
ipcMain.handle('news-get-all', async (event, force) => {
  try {
    return await getNewsFetcher().fetchAllNews(!!force);
  } catch (e) {
    console.error('[news] fetchAllNews 失败:', e.message);
    return { timestamp: Date.now(), sources: {}, error: e.message };
  }
});

ipcMain.handle('news-refresh', async () => {
  try {
    return await getNewsFetcher().fetchAllNews(true);
  } catch (e) {
    return { timestamp: Date.now(), sources: {}, error: e.message };
  }
});

ipcMain.handle('news-refresh-source', async (event, sourceId) => {
  try {
    return await getNewsFetcher().fetchSingleSource(sourceId);
  } catch (e) {
    return { id: sourceId, ok: false, error: e.message, items: [] };
  }
});

ipcMain.on('news-save-config', (event, cfg) => {
  newsConfig = { ...DEFAULT_NEWS_CONFIG, ...cfg };
  saveNewsConfig(newsConfig);
  startNewsTimer();
  event.reply('news-config-saved', true);
});

ipcMain.handle('news-get-config', () => {
  return newsConfig || loadNewsConfig();
});

ipcMain.on('news-open-tab', (event, url, title) => {
  openNewsReaderTab(url, title);
});

ipcMain.on('news-open-webview', (event, url, title) => {
  openNewsReaderTab(url, title);
});

ipcMain.on('news-reader-ready', () => {
  newsReaderReady = true;
  // 发送排队的页签
  for (const item of newsReaderQueue) {
    if (newsReaderWindow && !newsReaderWindow.isDestroyed()) {
      newsReaderWindow.webContents.send('news-add-tab', item);
    }
  }
  newsReaderQueue = [];
});

ipcMain.on('news-test-reminder', () => {
  showNewsReminder();
});

ipcMain.on('news-reminder-close', () => {
  closeNewsReminder();
});

ipcMain.on('news-reminder-snooze', () => {
  snoozeNewsReminder();
});

ipcMain.on('news-reminder-view-all', () => {
  closeNewsReminder();
  openTool('news');
});

// ═══════════════════════════════════════════════
//  力扣每日10题 / GitHub Trending / 技术日报
// ═══════════════════════════════════════════════

// 力扣经典题库：244 道高频面试题，按日期轮换选 10 题（纯本地，无网络请求，杜绝 400）
const LEETCODE_POOL = [
  { id: '1', title: '两数之和', slug: 'two-sum', diff: '简单' },
  { id: '41', title: '缺失的第一个正数', slug: 'first-missing-positive', diff: '困难' },
  { id: '128', title: '最长连续序列', slug: 'longest-consecutive-sequence', diff: '中等' },
  { id: '169', title: '多数元素', slug: 'majority-element', diff: '简单' },
  { id: '217', title: '存在重复元素', slug: 'contains-duplicate', diff: '简单' },
  { id: '219', title: '存在重复元素II', slug: 'contains-duplicate-ii', diff: '简单' },
  { id: '242', title: '有效的字母异位词', slug: 'valid-anagram', diff: '简单' },
  { id: '268', title: '丢失的数字', slug: 'missing-number', diff: '简单' },
  { id: '349', title: '两个数组的交集', slug: 'intersection-of-two-arrays', diff: '简单' },
  { id: '350', title: '两个数组的交集II', slug: 'intersection-of-two-arrays-ii', diff: '简单' },
  { id: '383', title: '赎金信', slug: 'ransom-note', diff: '简单' },
  { id: '387', title: '字符串中的第一个唯一字符', slug: 'first-unique-character-in-a-string', diff: '简单' },
  { id: '448', title: '找到所有数组中消失的数字', slug: 'find-all-numbers-disappeared-in-an-array', diff: '简单' },
  { id: '454', title: '四数相加II', slug: '4sum-ii', diff: '中等' },
  { id: '560', title: '和为K的子数组', slug: 'subarray-sum-equals-k', diff: '中等' },
  { id: '706', title: '设计哈希映射', slug: 'design-hashmap', diff: '简单' },
  { id: '771', title: '宝石与石头', slug: 'jewels-and-stones', diff: '简单' },
  { id: '11', title: '盛最多水的容器', slug: 'container-with-most-water', diff: '中等' },
  { id: '15', title: '三数之和', slug: '3sum', diff: '中等' },
  { id: '75', title: '颜色分类', slug: 'sort-colors', diff: '中等' },
  { id: '167', title: '两数之和II', slug: 'two-sum-ii-input-array-is-sorted', diff: '中等' },
  { id: '283', title: '移动零', slug: 'move-zeroes', diff: '简单' },
  { id: '287', title: '寻找重复数', slug: 'find-the-duplicate-number', diff: '中等' },
  { id: '344', title: '反转字符串', slug: 'reverse-string', diff: '简单' },
  { id: '345', title: '反转字符串中的元音字母', slug: 'reverse-vowels-of-a-string', diff: '简单' },
  { id: '977', title: '有序数组的平方', slug: 'squares-of-a-sorted-array', diff: '简单' },
  { id: '3', title: '无重复字符的最长子串', slug: 'longest-substring-without-repeating-characters', diff: '中等' },
  { id: '76', title: '最小覆盖子串', slug: 'minimum-window-substring', diff: '困难' },
  { id: '239', title: '滑动窗口最大值', slug: 'sliding-window-maximum', diff: '困难' },
  { id: '438', title: '找到字符串中所有字母异位词', slug: 'find-all-anagrams-in-a-string', diff: '中等' },
  { id: '567', title: '字符串的排列', slug: 'permutation-in-string', diff: '中等' },
  { id: '643', title: '子数组最大平均数I', slug: 'maximum-average-subarray-i', diff: '简单' },
  { id: '33', title: '搜索旋转排序数组', slug: 'search-in-rotated-sorted-array', diff: '中等' },
  { id: '34', title: '在排序数组中查找元素的第一个和最后一个位置', slug: 'find-first-and-last-position-of-element-in-sorted-array', diff: '中等' },
  { id: '35', title: '搜索插入位置', slug: 'search-insert-position', diff: '简单' },
  { id: '69', title: 'x的平方根', slug: 'sqrtx', diff: '简单' },
  { id: '74', title: '搜索二维矩阵', slug: 'search-a-2d-matrix', diff: '中等' },
  { id: '153', title: '寻找旋转排序数组中的最小值', slug: 'find-minimum-in-rotated-sorted-array', diff: '中等' },
  { id: '162', title: '寻找峰值', slug: 'find-peak-element', diff: '中等' },
  { id: '278', title: '第一个错误的版本', slug: 'first-bad-version', diff: '简单' },
  { id: '374', title: '猜数字大小', slug: 'guess-number-higher-or-lower', diff: '简单' },
  { id: '704', title: '二分查找', slug: 'binary-search', diff: '简单' },
  { id: '852', title: '山脉数组的峰顶索引', slug: 'peak-index-in-a-mountain-array', diff: '简单' },
  { id: '875', title: '爱吃香蕉的珂珂', slug: 'koko-eating-bananas', diff: '中等' },
  { id: '2', title: '两数相加', slug: 'add-two-numbers', diff: '中等' },
  { id: '19', title: '删除链表的倒数第N个结点', slug: 'remove-nth-node-from-end-of-list', diff: '中等' },
  { id: '21', title: '合并两个有序链表', slug: 'merge-two-sorted-lists', diff: '简单' },
  { id: '23', title: '合并K个升序链表', slug: 'merge-k-sorted-lists', diff: '困难' },
  { id: '24', title: '两两交换链表中的节点', slug: 'swap-nodes-in-pairs', diff: '中等' },
  { id: '25', title: 'K个一组翻转链表', slug: 'reverse-nodes-in-k-group', diff: '困难' },
  { id: '83', title: '删除排序链表中的重复元素', slug: 'remove-duplicates-from-sorted-list', diff: '简单' },
  { id: '86', title: '分隔链表', slug: 'partition-list', diff: '中等' },
  { id: '92', title: '反转链表II', slug: 'reverse-linked-list-ii', diff: '中等' },
  { id: '138', title: '复制带随机指针的链表', slug: 'copy-list-with-random-pointer', diff: '中等' },
  { id: '141', title: '环形链表', slug: 'linked-list-cycle', diff: '简单' },
  { id: '142', title: '环形链表II', slug: 'linked-list-cycle-ii', diff: '中等' },
  { id: '143', title: '重排链表', slug: 'reorder-list', diff: '中等' },
  { id: '148', title: '排序链表', slug: 'sort-list', diff: '中等' },
  { id: '160', title: '相交链表', slug: 'intersection-of-two-linked-lists', diff: '简单' },
  { id: '203', title: '移除链表元素', slug: 'remove-linked-list-elements', diff: '简单' },
  { id: '206', title: '反转链表', slug: 'reverse-linked-list', diff: '简单' },
  { id: '234', title: '回文链表', slug: 'palindrome-linked-list', diff: '简单' },
  { id: '237', title: '删除链表中的节点', slug: 'delete-node-in-a-linked-list', diff: '中等' },
  { id: '328', title: '奇偶链表', slug: 'odd-even-linked-list', diff: '中等' },
  { id: '445', title: '两数相加II', slug: 'add-two-numbers-ii', diff: '中等' },
  { id: '876', title: '链表的中间结点', slug: 'middle-of-the-linked-list', diff: '简单' },
  { id: '94', title: '二叉树的中序遍历', slug: 'binary-tree-inorder-traversal', diff: '简单' },
  { id: '95', title: '不同的二叉搜索树II', slug: 'unique-binary-search-trees-ii', diff: '中等' },
  { id: '96', title: '不同的二叉搜索树', slug: 'unique-binary-search-trees', diff: '中等' },
  { id: '98', title: '验证二叉搜索树', slug: 'validate-binary-search-tree', diff: '中等' },
  { id: '100', title: '相同的树', slug: 'same-tree', diff: '简单' },
  { id: '101', title: '对称二叉树', slug: 'symmetric-tree', diff: '简单' },
  { id: '102', title: '二叉树的层序遍历', slug: 'binary-tree-level-order-traversal', diff: '中等' },
  { id: '103', title: '二叉树的锯齿形层序遍历', slug: 'binary-tree-zigzag-level-order-traversal', diff: '中等' },
  { id: '104', title: '二叉树的最大深度', slug: 'maximum-depth-of-binary-tree', diff: '简单' },
  { id: '105', title: '从前序与中序遍历序列构造二叉树', slug: 'construct-binary-tree-from-preorder-and-inorder-traversal', diff: '中等' },
  { id: '108', title: '将有序数组转换为二叉搜索树', slug: 'convert-sorted-array-to-binary-search-tree', diff: '简单' },
  { id: '110', title: '平衡二叉树', slug: 'balanced-binary-tree', diff: '简单' },
  { id: '111', title: '二叉树的最小深度', slug: 'minimum-depth-of-binary-tree', diff: '简单' },
  { id: '112', title: '路径总和', slug: 'path-sum', diff: '简单' },
  { id: '113', title: '路径总和II', slug: 'path-sum-ii', diff: '中等' },
  { id: '124', title: '二叉树中的最大路径和', slug: 'binary-tree-maximum-path-sum', diff: '困难' },
  { id: '129', title: '求根节点到叶节点数字之和', slug: 'sum-root-to-leaf-numbers', diff: '中等' },
  { id: '144', title: '二叉树的前序遍历', slug: 'binary-tree-preorder-traversal', diff: '简单' },
  { id: '145', title: '二叉树的后序遍历', slug: 'binary-tree-postorder-traversal', diff: '简单' },
  { id: '199', title: '二叉树的右侧视图', slug: 'binary-tree-right-side-view', diff: '中等' },
  { id: '226', title: '翻转二叉树', slug: 'invert-binary-tree', diff: '简单' },
  { id: '230', title: '二叉搜索树中第K小的元素', slug: 'kth-smallest-element-in-a-bst', diff: '中等' },
  { id: '235', title: '二叉搜索树的最近公共祖先', slug: 'lowest-common-ancestor-of-a-binary-search-tree', diff: '简单' },
  { id: '236', title: '二叉树的最近公共祖先', slug: 'lowest-common-ancestor-of-a-binary-tree', diff: '中等' },
  { id: '257', title: '二叉树的所有路径', slug: 'binary-tree-paths', diff: '简单' },
  { id: '337', title: '打家劫舍III', slug: 'house-robber-iii', diff: '中等' },
  { id: '404', title: '左叶子之和', slug: 'sum-of-left-leaves', diff: '简单' },
  { id: '437', title: '路径总和III', slug: 'path-sum-iii', diff: '中等' },
  { id: '450', title: '删除二叉搜索树中的节点', slug: 'delete-node-in-a-bst', diff: '中等' },
  { id: '501', title: '二叉搜索树中的众数', slug: 'find-mode-in-binary-search-tree', diff: '简单' },
  { id: '530', title: '二叉搜索树的最小绝对差', slug: 'minimum-absolute-difference-in-bst', diff: '简单' },
  { id: '538', title: '把二叉搜索树转换为累加树', slug: 'convert-bst-to-greater-tree', diff: '中等' },
  { id: '543', title: '二叉树的直径', slug: 'diameter-of-binary-tree', diff: '简单' },
  { id: '572', title: '另一棵树的子树', slug: 'subtree-of-another-tree', diff: '简单' },
  { id: '589', title: 'N叉树的前序遍历', slug: 'n-ary-tree-preorder-traversal', diff: '简单' },
  { id: '617', title: '合并二叉树', slug: 'merge-two-binary-trees', diff: '简单' },
  { id: '669', title: '修剪二叉搜索树', slug: 'trim-a-binary-search-tree', diff: '中等' },
  { id: '671', title: '二叉树中第二小的节点', slug: 'second-minimum-node-in-a-binary-tree', diff: '简单' },
  { id: '687', title: '最长同值路径', slug: 'longest-univalue-path', diff: '中等' },
  { id: '700', title: '二叉搜索树中的搜索', slug: 'search-in-a-binary-search-tree', diff: '简单' },
  { id: '701', title: '二叉搜索树中的插入操作', slug: 'insert-into-a-binary-search-tree', diff: '中等' },
  { id: '938', title: '二叉搜索树的范围和', slug: 'range-sum-of-bst', diff: '简单' },
  { id: '79', title: '单词搜索', slug: 'word-search', diff: '中等' },
  { id: '130', title: '被围绕的区域', slug: 'surrounded-regions', diff: '中等' },
  { id: '133', title: '克隆图', slug: 'clone-graph', diff: '中等' },
  { id: '200', title: '岛屿数量', slug: 'number-of-islands', diff: '中等' },
  { id: '207', title: '课程表', slug: 'course-schedule', diff: '中等' },
  { id: '210', title: '课程表II', slug: 'course-schedule-ii', diff: '中等' },
  { id: '417', title: '太平洋大西洋水流问题', slug: 'pacific-atlantic-water-flow', diff: '中等' },
  { id: '695', title: '岛屿的最大面积', slug: 'max-area-of-island', diff: '中等' },
  { id: '733', title: '图像渲染', slug: 'flood-fill', diff: '简单' },
  { id: '784', title: '字母大小写全排列', slug: 'letter-case-permutation', diff: '中等' },
  { id: '994', title: '腐烂的橘子', slug: 'rotting-oranges', diff: '中等' },
  { id: '5', title: '最长回文子串', slug: 'longest-palindromic-substring', diff: '中等' },
  { id: '10', title: '正则表达式匹配', slug: 'regular-expression-matching', diff: '困难' },
  { id: '32', title: '最长有效括号', slug: 'longest-valid-parentheses', diff: '困难' },
  { id: '42', title: '接雨水', slug: 'trapping-rain-water', diff: '困难' },
  { id: '44', title: '通配符匹配', slug: 'wildcard-matching', diff: '困难' },
  { id: '45', title: '跳跃游戏II', slug: 'jump-game-ii', diff: '中等' },
  { id: '53', title: '最大子数组和', slug: 'maximum-subarray', diff: '中等' },
  { id: '55', title: '跳跃游戏', slug: 'jump-game', diff: '中等' },
  { id: '62', title: '不同路径', slug: 'unique-paths', diff: '中等' },
  { id: '63', title: '不同路径II', slug: 'unique-paths-ii', diff: '中等' },
  { id: '64', title: '最小路径和', slug: 'minimum-path-sum', diff: '中等' },
  { id: '70', title: '爬楼梯', slug: 'climbing-stairs', diff: '简单' },
  { id: '72', title: '编辑距离', slug: 'edit-distance', diff: '中等' },
  { id: '91', title: '解码方法', slug: 'decode-ways', diff: '中等' },
  { id: '115', title: '不同的子序列', slug: 'distinct-subsequences', diff: '困难' },
  { id: '120', title: '三角形最小路径和', slug: 'triangle', diff: '中等' },
  { id: '121', title: '买卖股票的最佳时机', slug: 'best-time-to-buy-and-sell-stock', diff: '简单' },
  { id: '122', title: '买卖股票的最佳时机II', slug: 'best-time-to-buy-and-sell-stock-ii', diff: '中等' },
  { id: '123', title: '买卖股票的最佳时机III', slug: 'best-time-to-buy-and-sell-stock-iii', diff: '困难' },
  { id: '139', title: '单词拆分', slug: 'word-break', diff: '中等' },
  { id: '152', title: '乘积最大子数组', slug: 'maximum-product-subarray', diff: '中等' },
  { id: '188', title: '买卖股票的最佳时机IV', slug: 'best-time-to-buy-and-sell-stock-iv', diff: '困难' },
  { id: '198', title: '打家劫舍', slug: 'house-robber', diff: '中等' },
  { id: '213', title: '打家劫舍II', slug: 'house-robber-ii', diff: '中等' },
  { id: '221', title: '最大正方形', slug: 'maximal-square', diff: '中等' },
  { id: '264', title: '丑数II', slug: 'ugly-number-ii', diff: '中等' },
  { id: '279', title: '完全平方数', slug: 'perfect-squares', diff: '中等' },
  { id: '300', title: '最长递增子序列', slug: 'longest-increasing-subsequence', diff: '中等' },
  { id: '309', title: '买卖股票的最佳时机含冷冻期', slug: 'best-time-to-buy-and-sell-stock-with-cooldown', diff: '中等' },
  { id: '322', title: '零钱兑换', slug: 'coin-change', diff: '中等' },
  { id: '343', title: '整数拆分', slug: 'integer-break', diff: '中等' },
  { id: '416', title: '分割等和子集', slug: 'partition-equal-subset-sum', diff: '中等' },
  { id: '474', title: '一和零', slug: 'ones-and-zeroes', diff: '中等' },
  { id: '494', title: '目标和', slug: 'target-sum', diff: '中等' },
  { id: '516', title: '最长回文子序列', slug: 'longest-palindromic-subsequence', diff: '中等' },
  { id: '518', title: '零钱兑换II', slug: 'coin-change-ii', diff: '中等' },
  { id: '646', title: '最长数对链', slug: 'maximum-length-of-pair-chain', diff: '中等' },
  { id: '647', title: '回文子串', slug: 'palindromic-substrings', diff: '中等' },
  { id: '673', title: '最长递增子序列的个数', slug: 'number-of-longest-increasing-subsequence', diff: '中等' },
  { id: '718', title: '最长重复子数组', slug: 'maximum-length-of-repeated-subarray', diff: '中等' },
  { id: '746', title: '使用最小花费爬楼梯', slug: 'min-cost-climbing-stairs', diff: '简单' },
  { id: '877', title: '石子游戏', slug: 'stone-game', diff: '中等' },
  { id: '1143', title: '最长公共子序列', slug: 'longest-common-subsequence', diff: '中等' },
  { id: '17', title: '电话号码的字母组合', slug: 'letter-combinations-of-a-phone-number', diff: '中等' },
  { id: '22', title: '括号生成', slug: 'generate-parentheses', diff: '中等' },
  { id: '39', title: '组合总和', slug: 'combination-sum', diff: '中等' },
  { id: '40', title: '组合总和II', slug: 'combination-sum-ii', diff: '中等' },
  { id: '46', title: '全排列', slug: 'permutations', diff: '中等' },
  { id: '47', title: '全排列II', slug: 'permutations-ii', diff: '中等' },
  { id: '51', title: 'N皇后', slug: 'n-queens', diff: '困难' },
  { id: '52', title: 'N皇后II', slug: 'n-queens-ii', diff: '困难' },
  { id: '77', title: '组合', slug: 'combinations', diff: '中等' },
  { id: '78', title: '子集', slug: 'subsets', diff: '中等' },
  { id: '90', title: '子集II', slug: 'subsets-ii', diff: '中等' },
  { id: '93', title: '复原IP地址', slug: 'restore-ip-addresses', diff: '中等' },
  { id: '131', title: '分割回文串', slug: 'palindrome-partitioning', diff: '中等' },
  { id: '216', title: '组合总和III', slug: 'combination-sum-iii', diff: '中等' },
  { id: '401', title: '二进制手表', slug: 'binary-watch', diff: '简单' },
  { id: '134', title: '加油站', slug: 'gas-station', diff: '中等' },
  { id: '135', title: '分发糖果', slug: 'candy', diff: '困难' },
  { id: '376', title: '摆动序列', slug: 'wiggle-subsequence', diff: '中等' },
  { id: '392', title: '判断子序列', slug: 'is-subsequence', diff: '简单' },
  { id: '406', title: '根据身高重建队列', slug: 'queue-reconstruction-by-height', diff: '中等' },
  { id: '435', title: '无重叠区间', slug: 'non-overlapping-intervals', diff: '中等' },
  { id: '452', title: '用最少数量的箭引爆气球', slug: 'minimum-number-of-arrows-to-burst-balloons', diff: '中等' },
  { id: '455', title: '分发饼干', slug: 'assign-cookies', diff: '简单' },
  { id: '502', title: 'IPO', slug: 'ipo', diff: '困难' },
  { id: '524', title: '通过删除字母匹配到字典里最长单词', slug: 'longest-word-in-dictionary-through-deleting', diff: '中等' },
  { id: '605', title: '种花问题', slug: 'can-place-flowers', diff: '简单' },
  { id: '621', title: '任务调度器', slug: 'task-scheduler', diff: '中等' },
  { id: '649', title: 'Dota2参议院', slug: 'dota2-senate', diff: '中等' },
  { id: '763', title: '划分字母区间', slug: 'partition-labels', diff: '中等' },
  { id: '921', title: '使括号有效的最少添加', slug: 'minimum-add-to-make-parentheses-valid', diff: '中等' },
  { id: '20', title: '有效的括号', slug: 'valid-parentheses', diff: '简单' },
  { id: '84', title: '柱状图中最大的矩形', slug: 'largest-rectangle-in-histogram', diff: '困难' },
  { id: '88', title: '合并两个有序数组', slug: 'merge-sorted-array', diff: '简单' },
  { id: '150', title: '逆波兰表达式求值', slug: 'evaluate-reverse-polish-notation', diff: '中等' },
  { id: '155', title: '最小栈', slug: 'min-stack', diff: '中等' },
  { id: '225', title: '用队列实现栈', slug: 'implement-stack-using-queues', diff: '简单' },
  { id: '232', title: '用栈实现队列', slug: 'implement-queue-using-stacks', diff: '简单' },
  { id: '295', title: '数据流的中位数', slug: 'find-median-from-data-stream', diff: '困难' },
  { id: '380', title: 'O(1)时间插入删除和获取随机元素', slug: 'insert-delete-getrandom-o1', diff: '中等' },
  { id: '739', title: '每日温度', slug: 'daily-temperatures', diff: '中等' },
  { id: '946', title: '验证栈序列', slug: 'validate-stack-sequences', diff: '中等' },
  { id: '6', title: 'Z字形变换', slug: 'zigzag-conversion', diff: '中等' },
  { id: '8', title: '字符串转换整数', slug: 'string-to-integer-atoi', diff: '中等' },
  { id: '14', title: '最长公共前缀', slug: 'longest-common-prefix', diff: '简单' },
  { id: '28', title: '找出字符串中第一个匹配项的下标', slug: 'find-the-index-of-the-first-occurrence-in-a-string', diff: '简单' },
  { id: '58', title: '最后一个单词的长度', slug: 'length-of-last-word', diff: '简单' },
  { id: '67', title: '二进制求和', slug: 'add-binary', diff: '简单' },
  { id: '125', title: '验证回文串', slug: 'valid-palindrome', diff: '简单' },
  { id: '151', title: '反转字符串中的单词', slug: 'reverse-words-in-a-string', diff: '中等' },
  { id: '190', title: '颠倒二进制位', slug: 'reverse-bits', diff: '简单' },
  { id: '191', title: '位1的个数', slug: 'number-of-1-bits', diff: '简单' },
  { id: '231', title: '2的幂', slug: 'power-of-two', diff: '简单' },
  { id: '258', title: '各位相加', slug: 'add-digits', diff: '简单' },
  { id: '263', title: '丑数', slug: 'ugly-number', diff: '简单' },
  { id: '292', title: 'Nim游戏', slug: 'nim-game', diff: '简单' },
  { id: '326', title: '3的幂', slug: 'power-of-three', diff: '简单' },
  { id: '342', title: '4的幂', slug: 'power-of-four', diff: '简单' },
  { id: '367', title: '有效的完全平方数', slug: 'valid-perfect-square', diff: '简单' },
  { id: '389', title: '找不同', slug: 'find-the-difference', diff: '简单' },
  { id: '409', title: '最长回文串', slug: 'longest-palindrome', diff: '简单' },
  { id: '412', title: 'FizzBuzz', slug: 'fizz-buzz', diff: '简单' },
  { id: '415', title: '字符串相加', slug: 'add-strings', diff: '简单' },
  { id: '443', title: '压缩字符串', slug: 'string-compression', diff: '中等' },
  { id: '461', title: '汉明距离', slug: 'hamming-distance', diff: '简单' },
  { id: '468', title: '验证IP地址', slug: 'validate-ip-address', diff: '中等' },
  { id: '507', title: '完美数', slug: 'perfect-number', diff: '简单' },
  { id: '520', title: '检测大写字母', slug: 'detect-capital', diff: '简单' },
  { id: '566', title: '重塑矩阵', slug: 'reshape-the-matrix', diff: '简单' },
  { id: '56', title: '合并区间', slug: 'merge-intervals', diff: '中等' },
  { id: '57', title: '插入区间', slug: 'insert-interval', diff: '中等' },
  { id: '179', title: '最大数', slug: 'largest-number', diff: '中等' },
  { id: '215', title: '数组中的第K个最大元素', slug: 'kth-largest-element-in-an-array', diff: '中等' },
  { id: '252', title: '会议室', slug: 'meeting-rooms', diff: '简单' },
  { id: '253', title: '会议室II', slug: 'meeting-rooms-ii', diff: '中等' },
  { id: '297', title: '二叉树的序列化与反序列化', slug: 'serialize-and-deserialize-binary-tree', diff: '困难' },
  { id: '347', title: '前K个高频元素', slug: 'top-k-frequent-elements', diff: '中等' },
  { id: '451', title: '根据字符出现频率排序', slug: 'sort-characters-by-frequency', diff: '中等' },
  { id: '692', title: '前K个高频单词', slug: 'top-k-frequent-words', diff: '中等' },
  { id: '703', title: '数据流中的第K大元素', slug: 'kth-largest-element-in-a-stream', diff: '简单' },
  { id: '973', title: '最接近原点的K个点', slug: 'k-closest-points-to-origin', diff: '中等' },
  { id: '1046', title: '最后一块石头的重量', slug: 'last-stone-weight', diff: '简单' },
  { id: '1137', title: '第N个泰波那契数', slug: 'n-th-tribonacci-number', diff: '简单' },
];

// 力扣每日 10 题：50 题池按日期轮换选 10 题（纯本地，秒回，不 400）
ipcMain.handle('leetcode-fetch-daily', async () => {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  // 步长 7 轮换起始位，50 题池每天起点不同，5 天一圈
  const start = (dayOfYear * 7) % LEETCODE_POOL.length;
  const items = [];
  for (let i = 0; i < 10; i++) {
    const q = LEETCODE_POOL[(start + i) % LEETCODE_POOL.length];
    items.push({
      questionFrontendId: q.id,
      questionTitle: q.title,
      titleSlug: q.slug,
      difficulty: q.diff,
    });
  }
  return { items, date: now.toISOString().slice(0, 10), pool: true };
});

// GitHub Trending 离线兜底（断网时展示热门仓库）
const TRENDING_FALLBACK = [
  { author: 'langchain-ai', name: 'langchain', description: 'Build context-aware reasoning applications with LLMs.', language: 'Python', languageColor: '#3572A5', stars: 96000, forks: 15700, starsToday: 120, url: 'https://github.com/langchain-ai/langchain' },
  { author: 'microsoft', name: 'generative-ai-for-beginners', description: '21 lessons covering Generative AI fundamentals.', language: 'Jupyter Notebook', languageColor: '#DA5B0B', stars: 58000, forks: 31000, starsToday: 90, url: 'https://github.com/microsoft/generative-ai-for-beginners' },
  { author: 'ollama', name: 'ollama', description: 'Get up and running with Llama 3, Mistral, Gemma, and other LLMs locally.', language: 'Go', languageColor: '#00ADD8', stars: 85000, forks: 6500, starsToday: 110, url: 'https://github.com/ollama/ollama' },
  { author: 'openai', name: 'whisper', description: 'Robust Speech Recognition via Large-scale Weak Supervision.', language: 'Python', languageColor: '#3572A5', stars: 64000, forks: 7400, starsToday: 60, url: 'https://github.com/openai/whisper' },
  { author: 'lobehub', name: 'lobe-chat', description: 'LLM Frontend / Framework with ChatGPT / Ollama / Claude support.', language: 'TypeScript', languageColor: '#3178c6', stars: 40000, forks: 9500, starsToday: 80, url: 'https://github.com/lobehub/lobe-chat' },
  { author: 'electron', name: 'electron', description: 'Build cross-platform desktop apps with JavaScript, HTML, and CSS.', language: 'C++', languageColor: '#f34b7d', stars: 112000, forks: 15000, starsToday: 40, url: 'https://github.com/electron/electron' },
  { author: 'sindresorhus', name: 'awesome', description: 'Awesome lists about all kinds of interesting topics.', language: '', languageColor: '', stars: 310000, forks: 27000, starsToday: 150, url: 'https://github.com/sindresorhus/awesome' },
  { author: 'twbs', name: 'bootstrap', description: 'The most popular HTML, CSS, and JS framework for responsive, mobile-first projects.', language: 'JavaScript', languageColor: '#f1e05a', stars: 168000, forks: 78600, starsToday: 35, url: 'https://github.com/twbs/bootstrap' },
  { author: 'vuejs', name: 'vue', description: 'Vue.js is a progressive, incrementally-adoptable JS framework for building UI on the web.', language: 'Vue', languageColor: '#41b883', stars: 207000, forks: 33600, starsToday: 50, url: 'https://github.com/vuejs/vue' },
  { author: 'facebook', name: 'react', description: 'The library for web and native user interfaces.', language: 'JavaScript', languageColor: '#f1e05a', stars: 226000, forks: 46000, starsToday: 70, url: 'https://github.com/facebook/react' },
];

// GitHub Trending（解析 HTML，正则兼容新旧两种 article 结构）
ipcMain.handle('github-fetch-trending', async (event, lang, since) => {
  try {
    const url = `https://github.com/trending/${lang || ''}?since=${since || 'daily'}`;
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });
    const html = resp.data;
    const repos = [];
    // 兼容 Box-row / TrendingBody > article 两种结构
    const blockRe = /<article[^>]*class="[^"]*(?:Box-row|trending-item)[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
    let m;
    while ((m = blockRe.exec(html)) && repos.length < 25) {
      const block = m[1];
      // 仓库全名：href="/author/name"
      const fullMatch = block.match(/href="\/([^"\/]+)\/([^"\/]+)"/);
      const author = fullMatch ? fullMatch[1] : '';
      const name = fullMatch ? fullMatch[2] : '';
      if (!author || !name || author === 'sponsors' || author === 'topics') continue;
      const desc = (block.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
      const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</);
      const langColor = (block.match(/<svg[^>]*>\s*<circle[^>]*fill="([^"]+)"/) || [])[1];
      const stars = parseInt((block.match(/([\d,]+)\s*stars?\s*(?:today|this week|this month)/i) || [])[1]?.replace(/,/g, '') || '0', 10);
      // 总 star：匹配 /stargazers 链接后的数字
      const totalStars = parseInt((block.match(/\/stargazers[^>]*>[\s\S]*?(\d[\d,]*)/) || [])[1]?.replace(/,/g, '') || '0', 10);
      const forks = parseInt((block.match(/\/forks[^>]*>[\s\S]*?(\d[\d,]*)/) || [])[1]?.replace(/,/g, '') || '0', 10);
      repos.push({
        author,
        name,
        description: desc.replace(/<[^>]+>/g, '').trim(),
        language: langMatch ? langMatch[1].trim() : '',
        languageColor: langColor || '',
        stars: totalStars || 0,
        forks: forks || 0,
        starsToday: stars,
        url: `https://github.com/${author}/${name}`,
      });
    }
    if (!repos.length) return { items: TRENDING_FALLBACK, fallback: true };
    return { items: repos, fallback: false };
  } catch (e) {
    return { items: TRENDING_FALLBACK, fallback: true, error: e.message };
  }
});

// 技术日报离线兜底（断网时展示近期热门）
const TECH_DAILY_FALLBACK = {
  v2ex: [
    { title: '大家最近在读什么技术书？', url: 'https://www.v2ex.com/', replies: 234 },
    { title: '2024 年程序员副业方向讨论', url: 'https://www.v2ex.com/', replies: 189 },
    { title: '远程办公一年，聊聊体验', url: 'https://www.v2ex.com/', replies: 156 },
    { title: '推荐几个小众但好用的开发工具', url: 'https://www.v2ex.com/', replies: 132 },
    { title: '关于 AI 编程助手的真实使用感受', url: 'https://www.v2ex.com/', replies: 298 },
    { title: '后端转前端的可行性？', url: 'https://www.v2ex.com/', replies: 87 },
    { title: 'Mac 上有哪些必装的开发软件', url: 'https://www.v2ex.com/', replies: 145 },
    { title: '35 岁程序员的出路在哪', url: 'https://www.v2ex.com/', replies: 412 },
  ],
  juejin: [
    { title: '2024 前端趋势：RSC、信号、构建工具三件套', url: 'https://juejin.cn/' },
    { title: '用 TypeScript 类型体操把同事逼疯', url: 'https://juejin.cn/' },
    { title: '从零实现一个 Promise，搞懂微任务队列', url: 'https://juejin.cn/' },
    { title: 'Vue3.4 的性能优化到底做了什么', url: 'https://juejin.cn/' },
    { title: '大厂面试官最爱问的 20 道闭包题', url: 'https://juejin.cn/' },
    { title: '一次线上 OOM 排查全过程', url: 'https://juejin.cn/' },
    { title: '手写 React-Router 核心原理', url: 'https://juejin.cn/' },
    { title: 'CSS 容器查询实战，告别媒体查询', url: 'https://juejin.cn/' },
  ],
  hn: [
    { title: 'Show HN: A local-first note app with end-to-end encryption', url: 'https://news.ycombinator.com/', score: 842 },
    { title: 'The state of Rust in 2024', url: 'https://news.ycombinator.com/', score: 678 },
    { title: 'Why I left Google to build my own thing', url: 'https://news.ycombinator.com/', score: 534 },
    { title: 'LLM-powered code review: 6 months in production', url: 'https://news.ycombinator.com/', score: 489 },
    { title: 'A new approach to incremental computation', url: 'https://news.ycombinator.com/', score: 421 },
    { title: 'SQLite is enough for most apps', url: 'https://news.ycombinator.com/', score: 398 },
    { title: 'The hidden cost of microservices', url: 'https://news.ycombinator.com/', score: 365 },
    { title: 'Building a CRDT-based collaborative editor from scratch', url: 'https://news.ycombinator.com/', score: 312 },
  ],
};

// 技术日报：V2EX + 掘金 + Hacker News（任一源失败用兜底，保证总有内容）
ipcMain.handle('tech-daily-fetch', async () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const result = {};
  let anyOk = false;

  // V2EX 热门：优先官方 API，失败回退 RSS
  try {
    const r = await axios.get('https://www.v2ex.com/api/topics/hot.json', {
      headers: { 'User-Agent': UA }, timeout: 10000,
    });
    if (Array.isArray(r.data) && r.data.length) {
      result.v2ex = r.data.slice(0, 15).map(it => ({ title: it.title, url: it.url, replies: it.replies }));
      anyOk = true;
    } else { result.v2ex = []; }
  } catch (e) {
    // 回退 RSS
    try {
      const r = await axios.get('https://www.v2ex.com/feed', { headers: { 'User-Agent': UA }, timeout: 10000, responseType: 'text' });
      const items = (r.data.match(/<item>([\s\S]*?)<\/item>/g) || []).slice(0, 15).map(b => ({
        title: (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '',
        url: (b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '',
        replies: 0,
      }));
      result.v2ex = items;
      anyOk = anyOk || items.length > 0;
    } catch (e2) { result.v2ex = []; }
  }

  // 掘金热榜：优先官方 API，失败回退 RSSHub
  try {
    const r = await axios.post('https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed', {
      cursor: '0', id_type: 2, limit: 15, sort_type: 200,
    }, { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, timeout: 10000 });
    const arr = r.data && r.data.data;
    if (Array.isArray(arr) && arr.length) {
      result.juejin = arr.map(it => ({
        title: (it.article_info && it.article_info.title) || '',
        url: (it.article_info && it.article_info.article_id) ? `https://juejin.cn/post/${it.article_info.article_id}` : '',
      })).filter(x => x.title);
      anyOk = true;
    } else { result.juejin = []; }
  } catch (e) {
    try {
      const r = await axios.get('https://rsshub.app/juejin/trending/0', { headers: { 'User-Agent': UA }, timeout: 10000, responseType: 'text' });
      const items = (r.data.match(/<item>([\s\S]*?)<\/item>/g) || []).slice(0, 15).map(block => {
        const title = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/) || block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
        return { title: title.replace(/<!\[CDATA\[|\]\]>/g, ''), url: link };
      });
      result.juejin = items;
      anyOk = anyOk || items.length > 0;
    } catch (e2) { result.juejin = []; }
  }

  // Hacker News（Firebase API，最稳定）
  try {
    const r = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', {
      headers: { 'User-Agent': UA }, timeout: 8000,
    });
    const ids = r.data.slice(0, 15);
    const items = await Promise.all(ids.map(id =>
      axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { headers: { 'User-Agent': UA }, timeout: 8000 })
        .then(rr => ({ title: rr.data.title, url: rr.data.url || `https://news.ycombinator.com/item?id=${id}`, score: rr.data.score }))
        .catch(() => null)
    ));
    result.hn = items.filter(Boolean);
    anyOk = anyOk || result.hn.length > 0;
  } catch (e) { result.hn = []; }

  // 任一源拿到数据即视为成功；全失败则注入兜底，保证页面有内容
  if (!anyOk) {
    return Object.assign({}, TECH_DAILY_FALLBACK, { fallback: true });
  }
  // 对个别失败的源补兜底
  if (!result.v2ex || !result.v2ex.length) result.v2ex = TECH_DAILY_FALLBACK.v2ex;
  if (!result.juejin || !result.juejin.length) result.juejin = TECH_DAILY_FALLBACK.juejin;
  if (!result.hn || !result.hn.length) result.hn = TECH_DAILY_FALLBACK.hn;
  result.fallback = false;
  return result;
});

// ═══════════════════════════════════════════════
//  开机自启动
// ═══════════════════════════════════════════════

// 注册表项名（固定 ASCII，避免中文键名在某些机器上的编码问题）
const AUTO_LAUNCH_REG_KEY = 'DevToolsAutoLaunch';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

// 构建启动命令行：打包后用 app.getPath('exe')，开发模式用 electron.exe + 应用目录
function buildLaunchCommand() {
  if (app.isPackaged) {
    return `"${process.execPath}"`;
  }
  // 开发模式：electron.exe + 应用根目录
  const electronExe = process.execPath; // electron 启动后这是 electron.exe
  const appRoot = app.getAppPath();    // 应用根目录
  return `"${electronExe}" "${appRoot}"`;
}

// 查询注册表是否已写入该项
function readRegRunValue() {
  try {
    const out = execSync(
      `reg query "${RUN_KEY}" /v "${AUTO_LAUNCH_REG_KEY}"`,
      { windowsHide: true }
    ).toString();
    return out.includes(AUTO_LAUNCH_REG_KEY);
  } catch (e) {
    return false; // 项不存在 → reg query 返回非零
  }
}

// 写入 / 删除注册表自启动项
function writeRegAutoLaunch(enable) {
  if (enable) {
    const cmd = buildLaunchCommand();
    // reg add 的 /d 参数：整体用 " 包裹，内部引号用 \" 转义
    // 这样注册表值会保留 "path1" "path2" 格式，含空格的路径也能正确启动
    const escaped = cmd.replace(/"/g, '\\"');
    execSync(
      `reg add "${RUN_KEY}" /v "${AUTO_LAUNCH_REG_KEY}" /t REG_SZ /d "${escaped}" /f`,
      { windowsHide: true }
    );
  } else {
    execSync(
      `reg delete "${RUN_KEY}" /v "${AUTO_LAUNCH_REG_KEY}" /f`,
      { windowsHide: true }
    );
  }
}

// 从配置文件读取 autoLaunch 字段
function isAutoLaunchEnabled() {
  try {
    if (fs.existsSync(CLOCK_CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CLOCK_CONFIG_FILE, 'utf-8'));
      return !!raw.autoLaunch;
    }
  } catch (e) {
    console.error('[autoLaunch] 读取配置失败:', e.message);
  }
  return false;
}

// 启动时同步：配置文件状态 → 注册表
function syncAutoLaunch() {
  const enabled = isAutoLaunchEnabled();
  try {
    // 以配置文件为准，避免配置文件说开但注册表丢失，或反之
    const regExists = readRegRunValue();
    if (enabled && !regExists) {
      writeRegAutoLaunch(true);
    } else if (!enabled && regExists) {
      writeRegAutoLaunch(false);
    }
    console.log('[autoLaunch] 同步完成，开机启动:', enabled, '注册表已存在:', readRegRunValue());
  } catch (e) {
    console.error('[autoLaunch] 同步失败:', e.message);
  }
}

// IPC: 查询开机自启动状态（以注册表实际状态为准）
ipcMain.handle('auto-launch-get', () => {
  return { enabled: readRegRunValue() };
});

// IPC: 开关开机自启动
ipcMain.handle('auto-launch-set', (event, enabled) => {
  try {
    // 先更新配置文件
    let cfg = {};
    if (fs.existsSync(CLOCK_CONFIG_FILE)) {
      cfg = JSON.parse(fs.readFileSync(CLOCK_CONFIG_FILE, 'utf-8'));
    }
    cfg.autoLaunch = !!enabled;
    fs.writeFileSync(CLOCK_CONFIG_FILE, JSON.stringify(cfg, null, 2));

    // 再写入注册表
    writeRegAutoLaunch(!!enabled);

    // 验证写入结果
    const actual = readRegRunValue();
    return { ok: true, enabled: actual };
  } catch (e) {
    console.error('[autoLaunch] 设置失败:', e.message);
    return { ok: false, error: e.message };
  }
});
