const QRCode = require('qrcode');
const { initTabs } = require('../utils');

function initQrcodeTool() {
  initTabs('#qrcode-tool');

  document.getElementById('generate-qrcode').addEventListener('click', async () => {
    const text = document.getElementById('qrcode-input').value.trim();
    const preview = document.getElementById('qrcode-preview');

    if (!text) {
      preview.innerHTML = '<span class="preview-hint error">请输入内容</span>';
      return;
    }

    try {
      preview.innerHTML = '';
      const canvas = document.createElement('canvas');
      preview.appendChild(canvas);
      await QRCode.toCanvas(canvas, text, { width: 220, margin: 2 });
    } catch (error) {
      preview.innerHTML = `<span class="preview-hint error">生成失败: ${error.message}</span>`;
      console.error(error);
    }
  });

  document.getElementById('download-qrcode').addEventListener('click', () => {
    const canvas = document.querySelector('#qrcode-preview canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'qrcode.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  document.getElementById('qrcode-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const nameEl = document.getElementById('qrcode-file-name');
    if (file) {
      if (nameEl) nameEl.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = document.createElement('img');
        img.src = event.target.result;
        const preview = document.getElementById('qrcode-image-preview');
        preview.innerHTML = '';
        preview.appendChild(img);
      };
      reader.readAsDataURL(file);
    }
  });
}

module.exports = { initQrcodeTool };
