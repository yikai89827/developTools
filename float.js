const { ipcRenderer } = require('electron');
const { TOOLS } = require('./js/tools-config');
const fs = require('fs');
const path = require('path');

const dock = document.getElementById('float-dock');
const dockList = document.getElementById('dock-list');
const notesBtn = document.getElementById('dock-notes-btn');
const notesContainer = document.getElementById('notes-input-container');
const notesInput = document.getElementById('notes-input');
const notesSaveBtn = document.getElementById('notes-save-btn');
let expanded = false;

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

document.getElementById('dock-toggle').addEventListener('click', () => setExpanded(true));
document.getElementById('dock-collapse').addEventListener('click', () => setExpanded(false));
document.getElementById('dock-restore').addEventListener('click', () => {
  ipcRenderer.send('float-restore-main');
});

ipcRenderer.on('float-collapse', () => setExpanded(false));

setExpanded(false);
