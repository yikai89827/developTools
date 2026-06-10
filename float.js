const { ipcRenderer } = require('electron');
const { TOOLS } = require('./js/tools-config');

const dock = document.getElementById('float-dock');
const dockList = document.getElementById('dock-list');
let expanded = false;

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
