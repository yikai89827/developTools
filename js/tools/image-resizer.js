// 图片尺寸修改与压缩模块
// 功能：像素级调整宽高（保持/不保持宽高比）、质量压缩、格式转换

const state = {
  img: null,        // 原始 Image 对象
  origWidth: 0,
  origHeight: 0,
  origSize: 0,      // 原始文件大小（字节）
  origType: '',     // 原始 MIME 类型
  origName: '',     // 原始文件名
  resultBlob: null, // 处理结果 Blob
  resultUrl: '',    // 处理结果 ObjectURL
  keepAspect: true, // 是否保持宽高比
};

const els = {};

function $(id) { return document.getElementById(id); }

function initImageResizer() {
  els.upload = $('resize-upload');
  els.fileName = $('resize-file-name');
  els.workspace = $('resize-workspace');
  els.originalPreview = $('resize-original-preview');
  els.resultPreview = $('resize-result-preview');
  els.originalInfo = $('resize-original-info');
  els.resultInfo = $('resize-result-info');
  els.width = $('resize-width');
  els.height = $('resize-height');
  els.link = $('resize-link');
  els.quality = $('resize-quality');
  els.qualityVal = $('resize-quality-val');
  els.compressEnable = $('resize-compress-enable');
  els.format = $('resize-format');
  els.summary = $('resize-summary');
  els.apply = $('resize-apply');
  els.download = $('resize-download');

  els.upload.addEventListener('change', handleUpload);
  els.width.addEventListener('input', onWidthChange);
  els.height.addEventListener('input', onHeightChange);
  els.link.addEventListener('click', toggleAspectLock);
  els.quality.addEventListener('input', (e) => {
    els.qualityVal.textContent = e.target.value;
  });
  els.apply.addEventListener('click', applyChanges);
  els.download.addEventListener('click', downloadResult);

  document.querySelectorAll('.resize-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.img) return;
      if (btn.dataset.reset) {
        els.width.value = state.origWidth;
        els.height.value = state.origHeight;
      } else {
        const scale = parseInt(btn.dataset.scale, 10) / 100;
        els.width.value = Math.round(state.origWidth * scale);
        els.height.value = Math.round(state.origHeight * scale);
      }
      updateSummary();
    });
  });
}

function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  els.fileName.textContent = file.name;
  state.origSize = file.size;
  state.origType = file.type;
  state.origName = file.name;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      state.img = img;
      state.origWidth = img.naturalWidth;
      state.origHeight = img.naturalHeight;
      els.width.value = state.origWidth;
      els.height.value = state.origHeight;
      els.workspace.hidden = false;

      // 原图预览
      els.originalPreview.innerHTML = '';
      const previewImg = document.createElement('img');
      previewImg.src = ev.target.result;
      els.originalPreview.appendChild(previewImg);

      els.originalInfo.textContent = `${state.origWidth} × ${state.origHeight} px · ${formatSize(state.origSize)} · ${state.origType.split('/')[1].toUpperCase()}`;

      // 清空之前的结果
      els.resultPreview.innerHTML = '<span class="resize-hint">点击「应用修改」生成结果</span>';
      els.resultInfo.textContent = '';
      els.summary.textContent = '';
      els.download.disabled = true;

      if (state.resultUrl) {
        URL.revokeObjectURL(state.resultUrl);
        state.resultUrl = '';
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function onWidthChange() {
  if (state.keepAspect && state.img) {
    const w = parseInt(els.width.value, 10);
    if (w > 0) {
      els.height.value = Math.round(w * state.origHeight / state.origWidth);
    }
  }
  updateSummary();
}

function onHeightChange() {
  if (state.keepAspect && state.img) {
    const h = parseInt(els.height.value, 10);
    if (h > 0) {
      els.width.value = Math.round(h * state.origWidth / state.origHeight);
    }
  }
  updateSummary();
}

function toggleAspectLock() {
  state.keepAspect = !state.keepAspect;
  els.link.classList.toggle('active', state.keepAspect);
  els.link.title = state.keepAspect ? '保持宽高比（点击解除）' : '不保持宽高比（点击锁定）';
}

function getOutputFormat() {
  const fmt = els.format.value;
  if (fmt !== 'auto') return fmt;
  // 跟随原图类型
  if (state.origType === 'image/png') return 'png';
  if (state.origType === 'image/webp') return 'webp';
  return 'jpeg'; // 默认 jpeg
}

function getOutputMime(format) {
  return `image/${format}`;
}

function getOutputExt(format) {
  if (format === 'jpeg') return 'jpg';
  return format;
}

function applyChanges() {
  if (!state.img) return;

  const targetW = Math.max(1, parseInt(els.width.value, 10) || 1);
  const targetH = Math.max(1, parseInt(els.height.value, 10) || 1);
  const format = getOutputFormat();
  const compress = els.compressEnable.checked;
  const quality = compress ? parseInt(els.quality.value, 10) / 100 : undefined;

  // PNG 不支持质量压缩，只有 jpeg/webp 有
  const useQuality = (format === 'jpeg' || format === 'webp') && compress;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  // 高质量缩放
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.img, 0, 0, targetW, targetH);

  const mime = getOutputMime(format);

  canvas.toBlob((blob) => {
    if (!blob) {
      els.resultInfo.textContent = '生成失败';
      return;
    }

    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultBlob = blob;
    state.resultUrl = URL.createObjectURL(blob);

    // 结果预览
    els.resultPreview.innerHTML = '';
    const resultImg = document.createElement('img');
    resultImg.src = state.resultUrl;
    els.resultPreview.appendChild(resultImg);

    const ext = getOutputExt(format).toUpperCase();
    els.resultInfo.textContent = `${targetW} × ${targetH} px · ${formatSize(blob.size)} · ${ext}`;

    updateSummary(blob.size, targetW, targetH);
    els.download.disabled = false;
  }, mime, useQuality ? quality : undefined);
}

function updateSummary(resultSize, targetW, targetH) {
  if (!state.img) return;

  const w = targetW || parseInt(els.width.value, 10) || state.origWidth;
  const h = targetH || parseInt(els.height.value, 10) || state.origHeight;
  const format = getOutputFormat();

  let text = `目标尺寸: ${w} × ${h} px`;
  if (w !== state.origWidth || h !== state.origHeight) {
    const ratio = ((w * h) / (state.origWidth * state.origHeight) * 100).toFixed(1);
    text += ` (面积 ${ratio}% of 原图)`;
  }

  if (resultSize !== undefined) {
    const saved = state.origSize - resultSize;
    const pct = (resultSize / state.origSize * 100).toFixed(1);
    if (saved > 0) {
      text += ` | 压缩后 ${formatSize(resultSize)}（节省 ${formatSize(saved)}，为原图 ${pct}%）`;
    } else {
      text += ` | 压缩后 ${formatSize(resultSize)}（比原图大 ${formatSize(-saved)}）`;
    }
  }

  els.summary.textContent = text;
}

function downloadResult() {
  if (!state.resultBlob) return;
  const format = getOutputFormat();
  const ext = getOutputExt(format);
  const baseName = state.origName.replace(/\.[^.]+$/, '') || 'image';
  const link = document.createElement('a');
  link.download = `${baseName}_${els.width.value}x${els.height.value}.${ext}`;
  link.href = state.resultUrl;
  link.click();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

module.exports = { initImageResizer };
