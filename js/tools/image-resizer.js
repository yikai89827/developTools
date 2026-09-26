// 图片尺寸修改与压缩模块
// 功能：单张调整、批量调整、保持/不保持宽高比、质量压缩、格式转换

const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// ── 单张模式状态 ──
const singleState = {
  img: null,
  origWidth: 0,
  origHeight: 0,
  origSize: 0,
  origType: '',
  origName: '',
  resultBlob: null,
  resultUrl: '',
  keepAspect: true,
};

// ── 批量模式状态 ──
const batchState = {
  files: [],           // { id, file, name, type, size, img, origW, origH, status, error }
  keepAspect: true,
  outputDir: '',
  isProcessing: false,
};

let singleEls = {};
let batchEls = {};

function $(id) { return document.getElementById(id); }

// ═══════════════════════════════════════════════
//  通用工具函数
// ═══════════════════════════════════════════════

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getOutputFormat(autoType, selectorValue) {
  const fmt = selectorValue;
  if (fmt !== 'auto') return fmt;
  if (autoType === 'image/png') return 'png';
  if (autoType === 'image/webp') return 'webp';
  return 'jpeg';
}

function getOutputMime(format) { return `image/${format}`; }
function getOutputExt(format) { return format === 'jpeg' ? 'jpg' : format; }

function createImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl: ev.target.result, img });
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function processImageToBlob(img, targetW, targetH, format, useQuality, quality) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const mime = getOutputMime(format);
    canvas.toBlob((blob) => resolve(blob), mime, useQuality ? quality : undefined);
  });
}

function safeFileName(name) {
  return name.replace(/[<>\\/:*?"|]/g, '_');
}

// ═══════════════════════════════════════════════
//  模式切换
// ═══════════════════════════════════════════════

function switchMode(mode) {
  document.querySelectorAll('.resize-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  $('resize-single-panel').hidden = mode !== 'single';
  $('resize-batch-panel').hidden = mode !== 'batch';
}

// ═══════════════════════════════════════════════
//  单张模式
// ═══════════════════════════════════════════════

function initSingleMode() {
  singleEls.upload = $('resize-upload');
  singleEls.fileName = $('resize-file-name');
  singleEls.workspace = $('resize-workspace');
  singleEls.originalPreview = $('resize-original-preview');
  singleEls.resultPreview = $('resize-result-preview');
  singleEls.originalInfo = $('resize-original-info');
  singleEls.resultInfo = $('resize-result-info');
  singleEls.width = $('resize-width');
  singleEls.height = $('resize-height');
  singleEls.link = $('resize-link');
  singleEls.quality = $('resize-quality');
  singleEls.qualityVal = $('resize-quality-val');
  singleEls.compressEnable = $('resize-compress-enable');
  singleEls.format = $('resize-format');
  singleEls.summary = $('resize-summary');
  singleEls.apply = $('resize-apply');
  singleEls.download = $('resize-download');

  singleEls.upload.addEventListener('change', handleSingleUpload);
  singleEls.width.addEventListener('input', () => onSingleDimChange('width'));
  singleEls.height.addEventListener('input', () => onSingleDimChange('height'));
  singleEls.link.addEventListener('click', () => {
    singleState.keepAspect = !singleState.keepAspect;
    singleEls.link.classList.toggle('active', singleState.keepAspect);
    singleEls.link.title = singleState.keepAspect ? '保持宽高比（点击解除）' : '不保持宽高比（点击锁定）';
  });
  singleEls.quality.addEventListener('input', (e) => { singleEls.qualityVal.textContent = e.target.value; });
  singleEls.apply.addEventListener('click', applySingleChanges);
  singleEls.download.addEventListener('click', downloadSingleResult);

  document.querySelectorAll('#resize-single-panel .resize-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => onSinglePresetClick(btn));
  });
}

function handleSingleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  singleEls.fileName.textContent = file.name;
  singleState.origSize = file.size;
  singleState.origType = file.type;
  singleState.origName = file.name;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      singleState.img = img;
      singleState.origWidth = img.naturalWidth;
      singleState.origHeight = img.naturalHeight;
      singleEls.width.value = singleState.origWidth;
      singleEls.height.value = singleState.origHeight;
      singleEls.workspace.hidden = false;

      singleEls.originalPreview.innerHTML = '';
      const previewImg = document.createElement('img');
      previewImg.src = ev.target.result;
      singleEls.originalPreview.appendChild(previewImg);

      singleEls.originalInfo.textContent = `${singleState.origWidth} × ${singleState.origHeight} px · ${formatSize(singleState.origSize)} · ${singleState.origType.split('/')[1].toUpperCase()}`;

      singleEls.resultPreview.innerHTML = '<span class="resize-hint">点击「应用修改」生成结果</span>';
      singleEls.resultInfo.textContent = '';
      singleEls.summary.textContent = '';
      singleEls.download.disabled = true;

      if (singleState.resultUrl) { URL.revokeObjectURL(singleState.resultUrl); singleState.resultUrl = ''; }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function onSingleDimChange(changed) {
  if (!singleState.keepAspect || !singleState.img) return;
  if (changed === 'width') {
    const w = parseInt(singleEls.width.value, 10);
    if (w > 0) singleEls.height.value = Math.round(w * singleState.origHeight / singleState.origWidth);
  } else {
    const h = parseInt(singleEls.height.value, 10);
    if (h > 0) singleEls.width.value = Math.round(h * singleState.origWidth / singleState.origHeight);
  }
  updateSingleSummary();
}

function onSinglePresetClick(btn) {
  if (!singleState.img) return;
  if (btn.dataset.reset) {
    singleEls.width.value = singleState.origWidth;
    singleEls.height.value = singleState.origHeight;
  } else {
    const scale = parseInt(btn.dataset.scale, 10) / 100;
    singleEls.width.value = Math.round(singleState.origWidth * scale);
    singleEls.height.value = Math.round(singleState.origHeight * scale);
  }
  updateSingleSummary();
}

function applySingleChanges() {
  if (!singleState.img) return;
  const targetW = Math.max(1, parseInt(singleEls.width.value, 10) || 1);
  const targetH = Math.max(1, parseInt(singleEls.height.value, 10) || 1);
  const format = getOutputFormat(singleState.origType, singleEls.format.value);
  const compress = singleEls.compressEnable.checked;
  const useQuality = (format === 'jpeg' || format === 'webp') && compress;
  const quality = compress ? parseInt(singleEls.quality.value, 10) / 100 : undefined;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(singleState.img, 0, 0, targetW, targetH);

  const mime = getOutputMime(format);
  canvas.toBlob((blob) => {
    if (!blob) { singleEls.resultInfo.textContent = '生成失败'; return; }
    if (singleState.resultUrl) URL.revokeObjectURL(singleState.resultUrl);
    singleState.resultBlob = blob;
    singleState.resultUrl = URL.createObjectURL(blob);

    singleEls.resultPreview.innerHTML = '';
    const resultImg = document.createElement('img');
    resultImg.src = singleState.resultUrl;
    singleEls.resultPreview.appendChild(resultImg);

    singleEls.resultInfo.textContent = `${targetW} × ${targetH} px · ${formatSize(blob.size)} · ${getOutputExt(format).toUpperCase()}`;
    updateSingleSummary(blob.size, targetW, targetH);
    singleEls.download.disabled = false;
  }, mime, useQuality ? quality : undefined);
}

function updateSingleSummary(resultSize, targetW, targetH) {
  if (!singleState.img) return;
  const w = targetW || parseInt(singleEls.width.value, 10) || singleState.origWidth;
  const h = targetH || parseInt(singleEls.height.value, 10) || singleState.origHeight;
  const format = getOutputFormat(singleState.origType, singleEls.format.value);

  let text = `目标尺寸: ${w} × ${h} px`;
  if (w !== singleState.origWidth || h !== singleState.origHeight) {
    const ratio = ((w * h) / (singleState.origWidth * singleState.origHeight) * 100).toFixed(1);
    text += ` (面积 ${ratio}% of 原图)`;
  }
  if (resultSize !== undefined) {
    const saved = singleState.origSize - resultSize;
    const pct = (resultSize / singleState.origSize * 100).toFixed(1);
    if (saved > 0) text += ` | 压缩后 ${formatSize(resultSize)}（节省 ${formatSize(saved)}，为原图 ${pct}%）`;
    else text += ` | 压缩后 ${formatSize(resultSize)}（比原图大 ${formatSize(-saved)}）`;
  }
  singleEls.summary.textContent = text;
}

function downloadSingleResult() {
  if (!singleState.resultBlob) return;
  const format = getOutputFormat(singleState.origType, singleEls.format.value);
  const ext = getOutputExt(format);
  const baseName = singleState.origName.replace(/\.[^.]+$/, '') || 'image';
  const link = document.createElement('a');
  link.download = `${baseName}_${singleEls.width.value}x${singleEls.height.value}.${ext}`;
  link.href = singleState.resultUrl;
  link.click();
}

// ═══════════════════════════════════════════════
//  批量模式
// ═══════════════════════════════════════════════

async function initBatchMode() {
  batchEls.outputPath = $('resize-output-path');
  batchEls.selectDir = $('resize-select-dir');
  batchEls.openDir = $('resize-open-dir');
  batchEls.upload = $('resize-batch-upload');
  batchEls.fileName = $('resize-batch-file-name');
  batchEls.list = $('resize-batch-list');
  batchEls.width = $('resize-batch-width');
  batchEls.height = $('resize-batch-height');
  batchEls.link = $('resize-batch-link');
  batchEls.quality = $('resize-batch-quality');
  batchEls.qualityVal = $('resize-batch-quality-val');
  batchEls.compressEnable = $('resize-batch-compress-enable');
  batchEls.format = $('resize-batch-format');
  batchEls.processBtn = $('resize-batch-process');
  batchEls.clearBtn = $('resize-batch-clear');
  batchEls.progress = $('resize-batch-progress');
  batchEls.progressBar = $('resize-batch-progress-bar');
  batchEls.progressText = $('resize-batch-progress-text');

  // 加载默认输出目录
  try {
    batchState.outputDir = await ipcRenderer.invoke('resize-get-default-dir');
    batchEls.outputPath.textContent = batchState.outputDir;
  } catch (e) {
    batchEls.outputPath.textContent = '获取默认目录失败';
  }

  batchEls.selectDir.addEventListener('click', async () => {
    const res = await ipcRenderer.invoke('resize-select-output-dir');
    if (res.ok) {
      batchState.outputDir = res.dir;
      batchEls.outputPath.textContent = res.dir;
    }
  });

  batchEls.openDir.addEventListener('click', async () => {
    if (!batchState.outputDir) return;
    await ipcRenderer.invoke('resize-open-folder', batchState.outputDir);
  });

  batchEls.upload.addEventListener('change', handleBatchUpload);
  batchEls.width.addEventListener('input', () => onBatchDimChange('width'));
  batchEls.height.addEventListener('input', () => onBatchDimChange('height'));
  batchEls.link.addEventListener('click', () => {
    batchState.keepAspect = !batchState.keepAspect;
    batchEls.link.classList.toggle('active', batchState.keepAspect);
    batchEls.link.title = batchState.keepAspect ? '保持宽高比（点击解除）' : '不保持宽高比（点击锁定）';
  });
  batchEls.quality.addEventListener('input', (e) => { batchEls.qualityVal.textContent = e.target.value; });
  batchEls.processBtn.addEventListener('click', startBatchProcess);
  batchEls.clearBtn.addEventListener('click', clearBatchList);

  document.querySelectorAll('#resize-batch-panel .resize-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => onBatchPresetClick(btn));
  });
}

async function handleBatchUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  batchEls.fileName.textContent = `已选择 ${files.length} 张图片`;

  for (const file of files) {
    try {
      const { dataUrl, img } = await createImageFromFile(file);
      batchState.files.push({
        id: 'f_' + Math.random().toString(36).slice(2, 9),
        file,
        name: file.name,
        type: file.type,
        size: file.size,
        img,
        origW: img.naturalWidth,
        origH: img.naturalHeight,
        status: 'pending',
        error: null,
      });
    } catch (err) {
      console.error('[batch] 读取失败:', file.name, err.message);
    }
  }

  renderBatchList();
  batchEls.processBtn.disabled = batchState.files.length === 0 || batchState.isProcessing;
}

function renderBatchList() {
  if (!batchState.files.length) {
    batchEls.list.innerHTML = '<div class="resize-batch-empty">请选择要处理的图片</div>';
    batchEls.processBtn.disabled = true;
    return;
  }

  const html = batchState.files.map((item) => {
    let statusClass = '';
    let statusText = '待处理';
    if (item.status === 'processing') { statusClass = 'processing'; statusText = '处理中…'; }
    if (item.status === 'done') { statusClass = 'done'; statusText = '已完成'; }
    if (item.status === 'error') { statusClass = 'error'; statusText = item.error || '失败'; }

    return `
      <div class="resize-batch-item" data-id="${item.id}">
        <img class="resize-batch-thumb" src="${item.img.src}" />
        <div class="resize-batch-meta">
          <div class="resize-batch-name" title="${item.name}">${item.name}</div>
          <div class="resize-batch-size">${item.origW} × ${item.origH} px · ${formatSize(item.size)}</div>
        </div>
        <div class="resize-batch-status ${statusClass}">${statusText}</div>
      </div>
    `;
  }).join('');

  batchEls.list.innerHTML = html;
  batchEls.processBtn.disabled = batchState.isProcessing || !batchState.files.some((f) => f.status === 'pending');
}

function onBatchDimChange(changed) {
  if (!batchState.keepAspect) return;
  // 批量模式下没有单张原图参考，缩放比例以第一个 pending 文件为准
  const ref = batchState.files.find((f) => f.status === 'pending') || batchState.files[0];
  if (!ref) return;
  if (changed === 'width') {
    const w = parseInt(batchEls.width.value, 10);
    if (w > 0) batchEls.height.value = Math.round(w * ref.origH / ref.origW);
  } else {
    const h = parseInt(batchEls.height.value, 10);
    if (h > 0) batchEls.width.value = Math.round(h * ref.origW / ref.origH);
  }
}

function onBatchPresetClick(btn) {
  const ref = batchState.files.find((f) => f.status === 'pending') || batchState.files[0];
  if (!ref) return;
  if (btn.dataset.reset) {
    batchEls.width.value = ref.origW;
    batchEls.height.value = ref.origH;
  } else {
    const scale = parseInt(btn.dataset.scale, 10) / 100;
    batchEls.width.value = Math.round(ref.origW * scale);
    batchEls.height.value = Math.round(ref.origH * scale);
  }
}

async function startBatchProcess() {
  if (batchState.isProcessing) return;
  const pending = batchState.files.filter((f) => f.status === 'pending');
  if (!pending.length) return;
  if (!batchState.outputDir) {
    alert('输出目录未设置');
    return;
  }

  // 确保输出目录存在
  if (!fs.existsSync(batchState.outputDir)) {
    fs.mkdirSync(batchState.outputDir, { recursive: true });
  }

  batchState.isProcessing = true;
  batchEls.processBtn.disabled = true;
  batchEls.progress.hidden = false;

  const targetW = Math.max(1, parseInt(batchEls.width.value, 10) || 1);
  const targetH = Math.max(1, parseInt(batchEls.height.value, 10) || 1);
  const fmtValue = batchEls.format.value;
  const compress = batchEls.compressEnable.checked;

  let doneCount = 0;
  const total = pending.length;
  updateBatchProgress(0, total);

  for (const item of pending) {
    item.status = 'processing';
    renderBatchList();

    try {
      const format = getOutputFormat(item.type, fmtValue);
      const useQuality = (format === 'jpeg' || format === 'webp') && compress;
      const quality = compress ? parseInt(batchEls.quality.value, 10) / 100 : undefined;

      const blob = await processImageToBlob(item.img, targetW, targetH, format, useQuality, quality);
      if (!blob) throw new Error('Canvas 生成失败');

      const ext = getOutputExt(format);
      const baseName = safeFileName(item.name.replace(/\.[^.]+$/, '')) || 'image';
      const outName = `${baseName}_${targetW}x${targetH}.${ext}`;
      const outPath = path.join(batchState.outputDir, outName);

      // blob 转 buffer 写入磁盘
      const arrayBuffer = await blob.arrayBuffer();
      fs.writeFileSync(outPath, Buffer.from(arrayBuffer));

      item.status = 'done';
      item.error = null;
    } catch (err) {
      item.status = 'error';
      item.error = err.message || '处理失败';
      console.error('[batch]', item.name, err);
    }

    doneCount++;
    updateBatchProgress(doneCount, total);
  }

  batchState.isProcessing = false;
  batchEls.processBtn.disabled = false;
  batchEls.processBtn.textContent = '开始批量处理';
  renderBatchList();

  // 3秒后隐藏进度条
  setTimeout(() => { batchEls.progress.hidden = true; }, 3000);
}

function updateBatchProgress(done, total) {
  const pct = total ? (done / total * 100) : 0;
  batchEls.progressBar.style.width = `${pct}%`;
  batchEls.progressText.textContent = `${done} / ${total} (${Math.round(pct)}%)`;
}

function clearBatchList() {
  if (batchState.isProcessing) return;
  batchState.files = [];
  batchEls.fileName.textContent = '未选择文件';
  batchEls.progress.hidden = true;
  renderBatchList();
}

// ═══════════════════════════════════════════════
//  初始化入口
// ═══════════════════════════════════════════════

function initImageResizer() {
  initSingleMode();
  initBatchMode();

  document.querySelectorAll('.resize-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });
}

module.exports = { initImageResizer };
