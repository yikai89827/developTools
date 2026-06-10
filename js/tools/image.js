const { ipcRenderer } = require('electron');
const { copyToClipboard, initTabs } = require('../utils');
const { ScreenshotEditor } = require('./screenshot-editor');

let lastScreenshotDataUrl = '';
let editor = null;
let captureRunning = false;

function switchImageTab(tabId) {
  const panel = document.querySelector('#image-tool');
  if (!panel) return;
  panel.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  panel.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
}

function showScreenshotEditor(dataUrl) {
  lastScreenshotDataUrl = dataUrl;
  const preview = document.getElementById('screenshot-preview');
  const editorEl = document.getElementById('screenshot-editor');
  const canvas = document.getElementById('screenshot-canvas');
  const wrap = document.getElementById('screenshot-canvas-wrap');

  preview.innerHTML = '';
  preview.hidden = true;
  editorEl.hidden = false;

  if (!editor) {
    editor = new ScreenshotEditor(canvas, wrap);
    document.querySelectorAll('.annotate-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.annotate-btn[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        editor.setMode(btn.dataset.mode);
      });
    });
    document.getElementById('annotate-undo').addEventListener('click', () => editor.undo());
    document.getElementById('annotate-clear').addEventListener('click', () => editor.clear());
    document.getElementById('copy-screenshot').addEventListener('click', () => {
      if (!editor) return;
      const { clipboard, nativeImage } = require('electron');
      clipboard.writeImage(nativeImage.createFromDataURL(editor.toDataURL()));
    });
  }

  document.querySelectorAll('.annotate-btn[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === 'rect');
  });
  editor.setMode('rect');
  editor.load(dataUrl);
}

async function startRegionCapture() {
  if (captureRunning) return;

  const preview = document.getElementById('screenshot-preview');
  const editorEl = document.getElementById('screenshot-editor');
  const btn = document.getElementById('take-screenshot');

  captureRunning = true;
  if (btn) btn.disabled = true;
  editorEl.hidden = true;
  preview.hidden = false;
  preview.innerHTML = '<span class="preview-hint">准备截图，应用窗口将隐藏...</span>';

  try {
    const dataUrl = await ipcRenderer.invoke('start-region-capture');
    switchImageTab('image-screenshot');
    showScreenshotEditor(dataUrl);
  } catch (error) {
    if (error.message !== '已取消截图') {
      preview.innerHTML = `<span class="preview-hint error">截图失败: ${error.message}</span>`;
      console.error(error);
    } else {
      preview.innerHTML = '<span class="preview-hint">已取消截图</span>';
    }
    lastScreenshotDataUrl = '';
    editorEl.hidden = true;
    preview.hidden = false;
  } finally {
    captureRunning = false;
    if (btn) btn.disabled = false;
  }
}

function initImageTool() {
  initTabs('#image-tool');

  document.getElementById('image-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const nameEl = document.getElementById('image-file-name');
    if (file) {
      if (nameEl) nameEl.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = document.createElement('img');
        img.src = event.target.result;
        const preview = document.getElementById('image-preview');
        preview.innerHTML = '';
        preview.appendChild(img);
        document.getElementById('base64-output').value = event.target.result.split(',')[1];
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('copy-base64').addEventListener('click', () => {
    copyToClipboard(document.getElementById('base64-output').value);
  });

  document.getElementById('svg-input').addEventListener('input', (e) => {
    document.getElementById('svg-preview').innerHTML = e.target.value;
  });

  document.getElementById('take-screenshot').addEventListener('click', startRegionCapture);

  document.getElementById('save-screenshot').addEventListener('click', () => {
    const dataUrl = editor ? editor.toDataURL() : lastScreenshotDataUrl;
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = `screenshot-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    lastScreenshotDataUrl = dataUrl;
  });

  ipcRenderer.on('trigger-screenshot', () => {
    switchImageTab('image-screenshot');
    startRegionCapture();
  });
}

module.exports = { initImageTool, startRegionCapture };
