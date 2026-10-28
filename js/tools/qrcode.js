const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { initTabs } = require('../utils');

let sourceImage = null;
let sourceStyle = null;
let decodedText = '';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imageToCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

function decodeFromCanvas(canvas, ctx) {
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  return jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function sampleColor(data, width, x, y) {
  const i = (Math.round(y) * width + Math.round(x)) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function colorKey(c) {
  return `${c.r},${c.g},${c.b}`;
}

function luminance(c) {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

function toCss(c) {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function averageColor(colors) {
  if (!colors.length) return { r: 0, g: 0, b: 0 };
  const sum = colors.reduce((acc, c) => ({
    r: acc.r + c.r,
    g: acc.g + c.g,
    b: acc.b + c.b
  }), { r: 0, g: 0, b: 0 });
  return {
    r: Math.round(sum.r / colors.length),
    g: Math.round(sum.g / colors.length),
    b: Math.round(sum.b / colors.length)
  };
}

function extractStyle(canvas, ctx, location) {
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const xs = [
    location.topLeftCorner.x,
    location.topRightCorner.x,
    location.bottomLeftCorner.x,
    location.bottomRightCorner.x
  ];
  const ys = [
    location.topLeftCorner.y,
    location.topRightCorner.y,
    location.bottomLeftCorner.y,
    location.bottomRightCorner.y
  ];

  const left = clamp(Math.min(...xs), 0, width - 1);
  const right = clamp(Math.max(...xs), 0, width - 1);
  const top = clamp(Math.min(...ys), 0, height - 1);
  const bottom = clamp(Math.max(...ys), 0, height - 1);
  const qrW = Math.max(1, right - left);
  const qrH = Math.max(1, bottom - top);
  const qrSize = Math.max(qrW, qrH);

  const darkSamples = [];
  const lightSamples = [];
  const logoMargin = qrSize * 0.28;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  for (let y = top; y < bottom; y += Math.max(1, Math.floor(qrH / 40))) {
    for (let x = left; x < right; x += Math.max(1, Math.floor(qrW / 40))) {
      if (Math.abs(x - cx) < logoMargin && Math.abs(y - cy) < logoMargin) continue;
      const c = sampleColor(data, width, x, y);
      if (luminance(c) < 140) darkSamples.push(c);
      else lightSamples.push(c);
    }
  }

  const dark = averageColor(darkSamples.length ? darkSamples : [{ r: 0, g: 0, b: 0 }]);
  const light = averageColor(lightSamples.length ? lightSamples : [{ r: 255, g: 255, b: 255 }]);

  const logoSize = Math.round(qrSize * 0.24);
  const logoX = Math.round(cx - logoSize / 2);
  const logoY = Math.round(cy - logoSize / 2);
  const logoCanvas = document.createElement('canvas');
  logoCanvas.width = logoSize;
  logoCanvas.height = logoSize;
  logoCanvas.getContext('2d').drawImage(
    canvas,
    logoX, logoY, logoSize, logoSize,
    0, 0, logoSize, logoSize
  );

  let captionCanvas = null;
  const captionTop = Math.round(bottom + qrSize * 0.04);
  if (captionTop < height - 8) {
    const captionH = height - captionTop;
    if (captionH > 12) {
      captionCanvas = document.createElement('canvas');
      captionCanvas.width = width;
      captionCanvas.height = captionH;
      captionCanvas.getContext('2d').drawImage(
        canvas,
        0, captionTop, width, captionH,
        0, 0, width, captionH
      );
    }
  }

  return {
    dark: toCss(dark),
    light: toCss(light),
    qrSize: Math.round(qrSize),
    logoDataUrl: logoCanvas.toDataURL('image/png'),
    captionDataUrl: captionCanvas ? captionCanvas.toDataURL('image/png') : null,
    captionHeight: captionCanvas ? captionCanvas.height : 0,
    sourceWidth: width,
    sourceHeight: height
  };
}

async function renderStyledQr(text, style, target) {
  const qrSize = style?.qrSize || 280;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, text, {
    width: qrSize,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: style?.dark || '#000000',
      light: style?.light || '#ffffff'
    }
  });

  const captionH = style?.captionHeight || 0;
  const out = document.createElement('canvas');
  out.width = Math.max(qrCanvas.width, style?.sourceWidth || qrCanvas.width);
  out.height = qrCanvas.height + captionH;
  const ctx = out.getContext('2d');
  ctx.fillStyle = style?.light || '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);

  const qrX = Math.round((out.width - qrCanvas.width) / 2);
  ctx.drawImage(qrCanvas, qrX, 0);

  if (style?.logoDataUrl) {
    const logo = await loadImage(style.logoDataUrl);
    const logoSize = Math.round(qrSize * 0.22);
    const lx = qrX + Math.round((qrCanvas.width - logoSize) / 2);
    const ly = Math.round((qrCanvas.height - logoSize) / 2);
    const pad = Math.round(logoSize * 0.08);
    ctx.fillStyle = style.light || '#ffffff';
    ctx.beginPath();
    ctx.arc(lx + logoSize / 2, ly + logoSize / 2, logoSize / 2 + pad, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx + logoSize / 2, ly + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, lx, ly, logoSize, logoSize);
    ctx.restore();
  }

  if (style?.captionDataUrl && captionH > 0) {
    const caption = await loadImage(style.captionDataUrl);
    ctx.drawImage(caption, 0, qrCanvas.height, out.width, captionH);
  }

  target.innerHTML = '';
  target.appendChild(out);
  return out;
}

function showPreview(container, src) {
  container.innerHTML = '';
  const img = document.createElement('img');
  img.src = src;
  container.appendChild(img);
}

function setStatus(text, isError) {
  const el = document.getElementById('qrcode-decode-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = isError ? 'preview-hint error' : 'preview-hint';
}

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

  document.getElementById('qrcode-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const nameEl = document.getElementById('qrcode-file-name');
    if (!file) return;
    if (nameEl) nameEl.textContent = file.name;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        sourceImage = await loadImage(event.target.result);
        sourceStyle = null;
        decodedText = '';
        showPreview(document.getElementById('qrcode-image-preview'), event.target.result);
        document.getElementById('qrcode-result').value = '';
        document.getElementById('qrcode-restyle-preview').innerHTML = '';
        setStatus('图片已加载，点击「解析」');
      } catch (error) {
        setStatus('图片加载失败: ' + error.message, true);
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('decode-qrcode').addEventListener('click', async () => {
    if (!sourceImage) {
      setStatus('请先选择图片', true);
      return;
    }

    setStatus('解析中...');
    try {
      const { canvas, ctx } = imageToCanvas(sourceImage);
      let result = decodeFromCanvas(canvas, ctx);

      if (!result) {
        const scale = 2;
        const scaled = document.createElement('canvas');
        scaled.width = canvas.width * scale;
        scaled.height = canvas.height * scale;
        const sctx = scaled.getContext('2d');
        sctx.imageSmoothingEnabled = false;
        sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
        result = decodeFromCanvas(scaled, sctx);
        if (result) {
          ['topLeftCorner', 'topRightCorner', 'bottomLeftCorner', 'bottomRightCorner'].forEach((key) => {
            result.location[key].x /= scale;
            result.location[key].y /= scale;
          });
        }
      }

      if (!result || !result.data) {
        setStatus('未识别到二维码，请换一张更清晰的图片', true);
        return;
      }

      decodedText = result.data;
      sourceStyle = extractStyle(canvas, ctx, result.location);
      document.getElementById('qrcode-result').value = decodedText;
      setStatus('解析成功，可修改内容后点击「按原样式重新生成」');
    } catch (error) {
      setStatus('解析失败: ' + error.message, true);
      console.error(error);
    }
  });

  document.getElementById('rebuild-qrcode').addEventListener('click', async () => {
    const text = document.getElementById('qrcode-result').value.trim();
    const preview = document.getElementById('qrcode-restyle-preview');
    if (!text) {
      setStatus('解析结果为空，请先解析或填写内容', true);
      return;
    }
    if (!sourceStyle) {
      setStatus('请先成功解析一张带样式的二维码图片', true);
      return;
    }

    try {
      setStatus('正在按原样式生成...');
      await renderStyledQr(text, sourceStyle, preview);
      setStatus('已按原样式重新生成（保留配色、Logo 与底部文案）');
    } catch (error) {
      setStatus('重新生成失败: ' + error.message, true);
      console.error(error);
    }
  });

  document.getElementById('download-restyle-qrcode').addEventListener('click', () => {
    const canvas = document.querySelector('#qrcode-restyle-preview canvas');
    if (!canvas) {
      setStatus('请先重新生成二维码', true);
      return;
    }
    const link = document.createElement('a');
    link.download = 'qrcode-restyle.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

module.exports = { initQrcodeTool };
