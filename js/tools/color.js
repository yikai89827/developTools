const { copyToClipboard } = require('../utils');

const COLOR_NAMES = {
  '#ff0000': '红色', '#00ff00': '绿色', '#0000ff': '蓝色',
  '#ffff00': '黄色', '#ff00ff': '品红', '#00ffff': '青色',
  '#ffffff': '白色', '#000000': '黑色', '#808080': '灰色',
  '#ff8000': '橙色', '#8000ff': '紫色', '#0080ff': '天蓝色',
  '#ff0080': '玫红', '#80ff00': '春绿', '#ffff80': '浅黄'
};

function initColorTool() {
  const hexInput = document.getElementById('hex-input');
  const rgbInput = document.getElementById('rgb-input');
  const hslInput = document.getElementById('hsl-input');
  const colorPicker = document.getElementById('color-picker');
  const colorPreview = document.getElementById('color-preview');
  const colorName = document.getElementById('color-name');

  function updateColor(color) {
    colorPreview.style.backgroundColor = color;
    colorName.value = COLOR_NAMES[color.toLowerCase()] || '';
  }

  hexInput.addEventListener('input', (e) => {
    const hex = e.target.value;
    if (/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
      const normalizedHex = hex.startsWith('#') ? hex : '#' + hex;
      updateColor(normalizedHex);
      colorPicker.value = normalizedHex;

      const r = parseInt(normalizedHex.slice(1, 3), 16);
      const g = parseInt(normalizedHex.slice(3, 5), 16);
      const b = parseInt(normalizedHex.slice(5, 7), 16);
      rgbInput.value = `rgb(${r}, ${g}, ${b})`;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }

      hslInput.value = `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    }
  });

  rgbInput.addEventListener('input', (e) => {
    const match = e.target.value.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
        const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        updateColor(hex);
        hexInput.value = hex;
        colorPicker.value = hex;
      }
    }
  });

  colorPicker.addEventListener('input', (e) => {
    updateColor(e.target.value);
    hexInput.value = e.target.value;
  });

  document.getElementById('copy-hex').addEventListener('click', () => copyToClipboard(hexInput.value));
  document.getElementById('copy-rgb').addEventListener('click', () => copyToClipboard(rgbInput.value));
}

module.exports = { initColorTool };
