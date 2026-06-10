const { ipcRenderer } = require('electron');

const overlay = document.getElementById('overlay');
const selection = document.getElementById('selection');
const hint = document.getElementById('hint');
const sizeEl = document.getElementById('size');
const btnConfirm = document.getElementById('btn-confirm');
const btnCancel = document.getElementById('btn-cancel');

let displayBounds = { x: 0, y: 0 };
let dragging = false;
let startX = 0;
let startY = 0;
let rect = null;

function updateSelection(x, y, w, h) {
  const left = Math.min(x, x + w);
  const top = Math.min(y, y + h);
  const width = Math.abs(w);
  const height = Math.abs(h);

  rect = { x: left, y: top, width, height };

  selection.hidden = width < 4 && height < 4;
  selection.style.left = `${left}px`;
  selection.style.top = `${top}px`;
  selection.style.width = `${width}px`;
  selection.style.height = `${height}px`;

  sizeEl.textContent = width > 0 && height > 0 ? `${Math.round(width)} × ${Math.round(height)}` : '';
  btnConfirm.disabled = width < 10 || height < 10;
}

function confirmCapture() {
  if (!rect || rect.width < 10 || rect.height < 10) return;
  ipcRenderer.send('capture-region-confirm', {
    x: displayBounds.x + rect.x,
    y: displayBounds.y + rect.y,
    width: rect.width,
    height: rect.height
  });
}

function cancelCapture() {
  ipcRenderer.send('capture-region-cancel');
}

overlay.addEventListener('mousedown', (e) => {
  if (e.target.closest('.toolbar')) return;
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
  updateSelection(startX, startY, 0, 0);
  hint.textContent = '松开鼠标完成选择';
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  updateSelection(startX, startY, e.clientX - startX, e.clientY - startY);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (rect && rect.width >= 10 && rect.height >= 10) {
    hint.textContent = '按 Enter 确认，Esc 取消';
  }
});

btnConfirm.addEventListener('click', confirmCapture);
btnCancel.addEventListener('click', cancelCapture);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelCapture();
  } else if (e.key === 'Enter' && !btnConfirm.disabled) {
    e.preventDefault();
    confirmCapture();
  }
});

ipcRenderer.on('capture-init', (event, bounds) => {
  displayBounds = bounds;
});
