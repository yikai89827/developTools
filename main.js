const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session, desktopCapturer, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
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

const COLLAPSED_WIDTH = 52;
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

function getFloatBounds(expanded) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const { x: sx, y: sy } = display.workArea;
  const w = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const h = expanded ? Math.min(EXPANDED_MAX_HEIGHT, sh - 40) : COLLAPSED_HEIGHT;
  return {
    x: sx + sw - w - 4,
    y: sy + Math.floor((sh - h) / 2),
    width: w,
    height: h
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

  floatWindow = new BrowserWindow({
    ...getFloatBounds(false),
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

  floatWindow.on('closed', () => {
    floatWindow = null;
  });
}

function showFloatWindow() {
  if (!floatWindow) createFloatWindow();
  if (!floatWindow) return;
  floatWindow.setBounds(getFloatBounds(false));
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

ipcMain.on('float-set-expanded', (event, expanded) => {
  if (!floatWindow) return;
  floatWindow.setBounds(getFloatBounds(expanded));
});

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

// 从打卡配置文件读取 autoLaunch 字段；不存在时默认 false
function isAutoLaunchEnabled() {
  try {
    if (fs.existsSync(CLOCK_CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CLOCK_CONFIG_FILE, 'utf-8'));
      return !!raw.autoLaunch;
    }
  } catch (e) {
    console.error('[autoLaunch] 读取失败:', e.message);
  }
  return false;
}

// 将 autoLaunch 状态同步到系统（Windows 注册表 / macOS LaunchAgent）
function syncAutoLaunch() {
  const enabled = isAutoLaunchEnabled();
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // 打包后的可执行名称；开发模式下 path 为 electron.exe，
      // setLoginItemSettings 会自动处理 dev/prod 差异
      args: ['--auto-launch']
    });
    console.log('[autoLaunch] 同步完成，开机启动:', enabled);
  } catch (e) {
    console.error('[autoLaunch] 设置失败:', e.message);
  }
}

// IPC: 查询开机自启动状态
ipcMain.handle('auto-launch-get', () => {
  return { enabled: isAutoLaunchEnabled() };
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

    // 再同步到系统
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      args: ['--auto-launch']
    });
    return { ok: true, enabled: !!enabled };
  } catch (e) {
    console.error('[autoLaunch] 设置失败:', e.message);
    return { ok: false, error: e.message };
  }
});
