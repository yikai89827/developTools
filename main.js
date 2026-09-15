const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session, desktopCapturer, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
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
      enableRemoteModule: true
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
