const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session, desktopCapturer, Tray } = require('electron');
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

const COLLAPSED_WIDTH = 52;
const COLLAPSED_HEIGHT = 56;
const EXPANDED_WIDTH = 210;
const EXPANDED_MAX_HEIGHT = 520;

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

function openTool(tool) {
  if (!mainWindow) return;
  currentTool = tool;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  hideFloatWindow();
  mainWindow.webContents.send('open-tool', tool);
}

function handleToolShortcut(tool) {
  if (!mainWindow) return;
  if (isMainWindowActive() && currentTool === tool) {
    mainWindow.minimize();
    return;
  }
  openTool(tool);
}

function restoreMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  hideFloatWindow();
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

  floatWindow.setAlwaysOnTop(true, 'floating');
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
  tray = new Tray(path.join(__dirname, 'build/icon.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => restoreMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  
  tray.setToolTip('豆豆开发者工具');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
      showFloatWindow();
    } else {
      restoreMainWindow();
    }
  });
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
    icon: path.join(__dirname, 'build/icon.png'),
    skipTaskbar: true
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
    showFloatWindow();
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
  const toolItems = TOOLS.map(tool => ({
    label: tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label,
    click: () => openTool(tool.id)
  }));

  const template = [
    {
      label: '工具',
      submenu: [
        ...toolItems,
        { type: 'separator' },
        { label: `区域截图 (${SCREENSHOT_SHORTCUT})`, click: () => triggerScreenshot() },
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

function registerGlobalShortcuts() {
  Object.entries(SHORTCUT_MAP).forEach(([key, toolId]) => {
    globalShortcut.register(`Ctrl+${key}`, () => handleToolShortcut(toolId));
  });
  globalShortcut.register(SCREENSHOT_SHORTCUT, () => triggerScreenshot());
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
  buildMenu();
  registerGlobalShortcuts();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
