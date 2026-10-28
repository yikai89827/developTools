const { BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { createInputPoller } = require('./input-poller');

const CONFIG_FILE = path.join(
  process.env.APPDATA || process.env.HOME || '.',
  'dev-tools-pet.json'
);

const BASE_WIDTH = 520;
const BASE_HEIGHT = 340;

let petWindow = null;
let poller = null;
let config = loadConfig();
let dragAnchor = null;
let listenError = '';

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      enabled: saved.enabled !== false,
      scale: clampScale(saved.scale),
      x: Number.isFinite(saved.x) ? saved.x : null,
      y: Number.isFinite(saved.y) ? saved.y : null
    };
  } catch {
    return { enabled: true, scale: 100, x: null, y: null };
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
}

function clampScale(value) {
  const n = Number(value) || 100;
  return Math.max(70, Math.min(160, n));
}

function windowSize() {
  const scale = config.scale / 100;
  return {
    width: Math.round(BASE_WIDTH * scale),
    height: Math.round(BASE_HEIGHT * scale)
  };
}

function defaultPosition(size) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - size.width - 28,
    y: area.y + area.height - size.height - 36
  };
}

function publicConfig() {
  return {
    enabled: config.enabled,
    scale: config.scale,
    listening: !!poller && !listenError,
    error: listenError
  };
}

function broadcastConfig() {
  const payload = publicConfig();
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('pet-config', payload);
  });
}

function sendInput(state) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (state.error) {
    listenError = state.error;
    broadcastConfig();
    return;
  }
  const display = screen.getDisplayNearestPoint({ x: state.x, y: state.y });
  const bounds = display.bounds;
  petWindow.webContents.send('pet-input', {
    keys: state.keys,
    recent: state.recent,
    anyKey: state.anyKey,
    mouseLeft: state.mouseLeft,
    mouseRight: state.mouseRight,
    relX: ((state.x - bounds.x) / bounds.width) * 2 - 1,
    relY: ((state.y - bounds.y) / bounds.height) * 2 - 1
  });
}

function startListening() {
  if (poller) return;
  listenError = '';
  poller = createInputPoller();
  try {
    poller.start(sendInput);
  } catch (error) {
    listenError = error.message;
    poller = null;
  }
}

function stopListening() {
  if (poller) poller.stop();
  poller = null;
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive();
    return;
  }

  const size = windowSize();
  const raw = (config.x == null || config.y == null) ? defaultPosition(size) : { x: config.x, y: config.y };
  const area = screen.getPrimaryDisplay().workArea;
  const pos = {
    x: Math.min(Math.max(area.x, raw.x), Math.max(area.x, area.x + area.width - size.width)),
    y: Math.min(Math.max(area.y, raw.y), Math.max(area.y, area.y + area.height - size.height))
  };
  config.x = pos.x;
  config.y = pos.y;

  petWindow = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  petWindow.setAlwaysOnTop(true, 'floating');
  petWindow.loadFile(path.join(__dirname, '../../pet.html'));
  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const bounds = petWindow.getBounds();
    config.x = bounds.x;
    config.y = bounds.y;
    saveConfig();
  });
  petWindow.once('ready-to-show', () => {
    if (config.enabled && petWindow && !petWindow.isDestroyed()) petWindow.showInactive();
  });
  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function showPet() {
  createPetWindow();
  startListening();
  if (petWindow && !petWindow.isDestroyed()) petWindow.showInactive();
}

function hidePet() {
  stopListening();
  if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
}

function resizePet() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const size = windowSize();
  const bounds = petWindow.getBounds();
  petWindow.setBounds({ x: bounds.x, y: bounds.y, ...size });
  config.x = bounds.x;
  config.y = bounds.y;
  saveConfig();
}

function setupPet() {
  ipcMain.on('pet-get-config', (event) => {
    event.sender.send('pet-config', publicConfig());
  });

  ipcMain.on('pet-set-config', (event, next) => {
    config.enabled = !!next.enabled;
    config.scale = clampScale(next.scale);
    saveConfig();
    if (config.enabled) {
      showPet();
      resizePet();
    } else {
      hidePet();
    }
    broadcastConfig();
  });

  ipcMain.on('pet-reset-position', () => {
    const size = windowSize();
    const pos = defaultPosition(size);
    config.x = pos.x;
    config.y = pos.y;
    saveConfig();
    if (petWindow && !petWindow.isDestroyed()) petWindow.setBounds({ ...pos, ...size });
  });

  ipcMain.on('pet-drag-start', (event, point) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const bounds = petWindow.getBounds();
    dragAnchor = { dx: point.x - bounds.x, dy: point.y - bounds.y };
  });

  ipcMain.on('pet-drag-move', (event, point) => {
    if (!dragAnchor || !petWindow || petWindow.isDestroyed()) return;
    const size = petWindow.getBounds();
    const x = Math.round(point.x - dragAnchor.dx);
    const y = Math.round(point.y - dragAnchor.dy);
    petWindow.setBounds({ x, y, width: size.width, height: size.height });
    config.x = x;
    config.y = y;
  });

  ipcMain.on('pet-drag-end', () => {
    dragAnchor = null;
    saveConfig();
  });

  if (config.enabled) showPet();
  broadcastConfig();
}

function shutdownPet() {
  stopListening();
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  petWindow = null;
}

module.exports = { setupPet, shutdownPet };
