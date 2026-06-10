const { ipcRenderer } = require('electron');
const { copyToClipboard, initTabs } = require('../utils');

let lastScreenshotDataUrl = '';

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

  document.getElementById('take-screenshot').addEventListener('click', async () => {
    const preview = document.getElementById('screenshot-preview');
    const btn = document.getElementById('take-screenshot');
    btn.disabled = true;
    preview.innerHTML = '<span class="preview-hint">截取中...</span>';

    try {
      const dataUrl = await ipcRenderer.invoke('capture-screen');
      lastScreenshotDataUrl = dataUrl;
      const img = document.createElement('img');
      img.src = dataUrl;
      preview.innerHTML = '';
      preview.appendChild(img);
    } catch (error) {
      lastScreenshotDataUrl = '';
      preview.innerHTML = `<span class="preview-hint error">截图失败: ${error.message}</span>`;
      console.error(error);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('save-screenshot').addEventListener('click', () => {
    if (!lastScreenshotDataUrl) return;
    const link = document.createElement('a');
    link.download = `screenshot-${Date.now()}.png`;
    link.href = lastScreenshotDataUrl;
    link.click();
  });
}

module.exports = { initImageTool };
