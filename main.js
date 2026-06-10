const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { TOOLS, SHORTCUT_MAP } = require('./js/tools-config');

let mainWindow;
let floatWindow;

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

function openTool(tool) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  hideFloatWindow();
  mainWindow.webContents.send('open-tool', tool);
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
    icon: path.join(__dirname, 'build/icon.ico')
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('minimize', () => {
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
    label: tool.label,
    accelerator: tool.shortcut || undefined,
    click: () => openTool(tool.id)
  }));

  const template = [
    {
      label: '工具',
      submenu: [
        ...toolItems,
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

function registerGlobalShortcuts() {
  Object.entries(SHORTCUT_MAP).forEach(([key, toolId]) => {
    globalShortcut.register(`Ctrl+${key}`, () => openTool(toolId));
  });
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback(sources.length ? { video: sources[0], audio: false } : {});
    }).catch(() => callback({}));
  });

  createWindow();
  createFloatWindow();
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

ipcMain.handle('capture-screen', async () => {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scaleFactor = display.scaleFactor;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor)
    }
  });

  if (!sources.length) {
    throw new Error('未找到可截取的屏幕');
  }

  const primaryId = String(display.id);
  const source = sources.find(s => s.display_id === primaryId) || sources[0];
  return source.thumbnail.toDataURL();
});

ipcMain.on('save-file', (event, data) => {
  const { content, filePath } = data;
  fs.writeFileSync(filePath, content);
  event.reply('save-file-reply', '保存成功');
});

ipcMain.on('read-file', (event, fi