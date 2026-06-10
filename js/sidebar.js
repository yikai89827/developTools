const { ipcRenderer } = require('electron');

let activeTool = 'generator';

function switchTool(tool, syncMain = true) {
  activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));

  const btn = document.querySelector(`[data-tool="${tool}"]`);
  const panel = document.getElementById(`${tool}-tool`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');

  if (syncMain) {
    ipcRenderer.send('set-current-tool', tool);
  }
}

function initSidebar() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTool(btn.dataset.tool));
  });

  ipcRenderer.on('open-tool', (event, tool) => switchTool(tool, false));

  switchTool('generator');
}

module.exports = { initSidebar, switchTool };
