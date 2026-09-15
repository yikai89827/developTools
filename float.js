const { ipcRenderer } = require('electron');
const { TOOLS } = require('./js/tools-config');
const fs = require('fs');
const path = require('path');

const dock = document.getElementById('float-dock');
const dockToggle = document.getElementById('dock-toggle');
const dockList = document.getElementById('dock-list');
const notesBtn = document.getElementById('dock-notes-btn');
const notesContainer = document.getElementById('notes-input-container');
const notesInput = document.getElementById('notes-input');
const notesSaveBtn = document.getElementById('notes-save-btn');
let expanded = false;

// 拖动状态
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false; // 区分点击和拖动
let lastEdge = 'right'; // 默认贴右

const NOTES_FILE = path.join(process.env.APPDATA || process.env.HOME, 'dev-tools-notes.txt');

function loadNotes() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      notesInput.value = fs.readFileSync(NOTES_FILE, 'utf-8');
    }
  } catch (e) {
    console.error('加载便签失败:', e);
  }
}

function saveNotes() {
  try {
    fs.writeFileSync(NOTES_FILE, notesInput.value);
    notesContainer.classList.remove('show');
    notesBtn.innerHTML = '📝 便签';
  } catch (e) {
    console.error('保存便签失败:', e);
  }
}

notesBtn.addEventListener('click', () => {
  notesContainer.classList.toggle('show');
  if (notesContainer.classList.contains('show')) {
    notesBtn.innerHTML = '✕ 关闭';
    loadNotes();
    notesInput.focus();
  } else {
    notesBtn.innerHTML = '📝 便签';
  }
});

notesSaveBtn.addEventListener('click', saveNotes);

notesInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    notesContainer.classList.remove('show');
    notesBtn.innerHTML = '📝 便签';
  } else if (e.key === 'Enter' && e.ctrlKey) {
    saveNotes();
  }
});

// ── 拖动逻辑 ──
// 鼠标按下：通知主进程开始拖动
dockToggle.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (expanded) return;
  isDragging = true;
  dragMoved = false;
  ipcRenderer.send('float-drag-start', {});
});

// 鼠标释放：通知主进程结束拖动
document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  ipcRenderer.send('float-drag-end', {});
});

// 接收主进程拖动中信号：移除贴边样式，标记已拖动
ipcRenderer.on('float-dragging', () => {
  dragMoved = true;
  dock.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
});

// 接收贴边状态
ipcRenderer.on('float-set-edge', (event, edge) => {
  lastEdge = edge || 'none';
  dock.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
  if (edge && edge !== 'none') {
    dock.classList.add(`edge-${edge}`);
  }
});

function setExpanded(value) {
  expanded = value;
  dock.classList.toggle('collapsed', !expanded);
  dock.classList.toggle('expanded', expanded);
  ipcRenderer.send('float-set-expanded', expanded);
}

TOOLS.forEach(tool => {
  const btn = document.createElement('button');
  btn.className = 'dock-item';
  btn.innerHTML = `
    <span class="icon">${tool.icon}</span>
    <span class="label">${tool.label}</span>
    ${tool.shortcut ? `<span class="shortcut">${tool.shortcut}</span>` : ''}
  `;
  btn.addEventListener('click', () => {
    ipcRenderer.send('float-open-tool', tool.id);
  });
  dockList.appendChild(btn);
});

// 点击展开：只有未拖动时才触发
dockToggle.addEventListener('click', (e) => {
  if (dragMoved) {
    dragMoved = false; // 重置
    return; // 拖动后不触发点击
  }
  setExpanded(true);
});

document.getElementById('dock-collapse').addEventListener('click', () => setExpanded(false));
document.getElementById('dock-restore').addEventListener('click', () => {
  ipcRenderer.send('float-restore-main');
});

ipcRenderer.on('float-collapse', () => setExpanded(false));

// 初始化
setExpanded(false);
// 应用初始贴边样式（由主进程 did-finish-load 后发送）
// 默认先设为贴右，避免首次显示样式不对
dock.classList.add('edge-right');
