const { ipcRenderer } = require('electron');
const { SHORTCUT_MAP } = require('./tools-config');

function switchTool(tool) {
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));

  const btn = document.querySelector(`[data-tool="${tool}"]`);
  const panel = document.getElementById(`${tool}-tool`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
}

function initSidebar() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTool(btn.dataset.tool));
  });

  ipcRenderer.on('open-tool', (event, tool) => switchTool(tool));
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const tool = SHORTCUT_MAP[e.key];
      if (tool) {
        e.preventDefault();
        switchTool(tool);
      }
    }
  });
}

module.exports = { initSidebar, initKeyboardShortcuts, switchTool };
