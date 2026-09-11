// 批量去水印模块：支持框选区域 + 颜色吸取两种模式，基于边界向内的快速填充算法
// 算法思路：Fast Marching 风格的边界向内填充 + 多轮迭代扩散优化

const MAX_IMAGES = 10;
const MAX_CANVAS_DIM = 1600; // 处理时缩放上限，避免超大图卡顿

const state = {
  images: [],          // { file, name, img, width, height, rects: [{x,y,w,h}], result: dataURL|null, colorMode, color, tolerance }
  currentIndex: 0,
  mode: 'rect',        // 'rect' | 'erase' | 'pick'
  colorMode: false,
  drawState: null      // { startX, startY, rect }
};

const els = {};

function $(id) { return document.getElementById(id); }

function initWatermarkRemover() {
  els.upload = $('watermark-upload');
  els.fileName = $('watermark-file-name');
  els.list = $('watermark-list');
  els.editor = $('watermark-editor');
  els.currentName = $('watermark-current-name');
  els.counter = $('watermark-counter');
  els.canvasWrap = $('watermark-canvas-wrap');
  els.canvas = $('watermark-canvas');
  els.ctx = els.canvas.getContext('2d');
  els.colorMode = $('wm-color-mode');
  els.colorRow = $('wm-color-row');
  els.colorPicker = $('wm-color-picker');
  els.tolerance = $('wm-tolerance');
  els.toleranceVal = $('wm-tolerance-val');
  els.process = $('wm-process');
  els.downloadAll = $('wm-download-all');
  els.downloadCurrent = $('wm-download-current');
  els.progress = $('watermark-progress');
  els.progressBar = $('watermark-progress-bar');
  els.progressText = $('watermark-progress-text');
  els.results = $('watermark-results');

  els.upload.addEventListener('change', handleUpload);
  els.colorMode.addEventListener('change', (e) => {
    state.colorMode = e.target.checked;
    els.colorRow.style.display = state.colorMode ? 'flex' : 'none';
    state.mode = state.colorMode ? 'pick' : 'rect';
    updateModeButtons();
  });
  els.colorPicker.addEventListener('input', () => {
    const cur = currentImage();
    if (cur) {
      cur.color = els.colorPicker.value;
      cur.colorMode = true;
    }
  });
  els.tolerance.addEventListener('input', (e) => {
    els.toleranceVal.textContent = e.target.value;
    const cur = currentImage();
    if (cur) cur.tolerance = parseInt(e.target.value, 10);
  });

  document.querySelectorAll('.annotate-btn[data-wm-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.wmMode;
      updateModeButtons();
    });
  });

  $('wm-clear-rects').addEventListener('click', () => {
    const cur = currentImage();
    if (!cur) return;
    cur.rects = [];
    redraw();
  });
  $('wm-apply-all').addEventListener('click', applyToAll);
  $('wm-prev').addEventListener('click', () => navigate(-1));
  $('wm-next').addEventListener('click', () => navigate(1));
  els.process.addEventListener('click', processAll);
  els.downloadAll.addEventListener('click', downloadAll);
  els.downloadCurrent.addEventListener('click', downloadCurrent);

  // 画布交互
  els.canvas.addEventListener('mousedown', onMouseDown);
  els.canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function updateModeButtons() {
  document.querySelectorAll('.annotate-btn[data-wm-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.wmMode === state.mode);
  });
  if (state.mode === 'pick') {
    els.canvas.style.cursor = 'crosshair';
  } else {
    els.canvas.style.cursor = 'default';
  }
}

function currentImage() {
  return state.images[state.currentIndex] || null;
}

async function handleUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  // 限制数量
  const room = MAX_IMAGES - state.images.length;
  const accepted = files.slice(0, room);
  if (files.length > room) {
    setFileName(`已选满 ${MAX_IMAGES} 张，超出 ${files.length - room} 张未加载`);
  } else {
    setFileName(`已选 ${state.images.length + accepted.length} / ${MAX_IMAGES} 张`);
  }

  for (const file of accepted) {
    try {
      const img = await loadImage(file);
      state.images.push({
        file,
        name: file.name,
        img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        rects: [],
        result: null,
        colorMode: false,
        color: '#ffffff',
        tolerance: 40
      });
    } catch (err) {
      console.error('图片加载失败', file.name, err);
    }
  }

  renderList();
  if (state.images.length) {
    els.editor.hidden = false;
    els.process.disabled = false;
    state.currentIndex = Math.min(state.currentIndex, state.images.length - 1);
    showCurrent();
  }
}

function setFileName(text) { els.fileName.textContent = text; }

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function renderList() {
  els.list.innerHTML = '';
  state.images.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'wm-thumb' + (idx === state.currentIndex ? ' active' : '') + (item.result ? ' done' : '');
    card.innerHTML = `
      <img src="${item.img.src}" alt="${item.name}">
      <span class="wm-thumb-name" title="${item.name}">${item.name}</span>
      <span class="wm-thumb-mark">${item.result ? '✓' : (idx + 1)}</span>
      <button class="wm-thumb-remove" title="移除">×</button>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('wm-thumb-remove')) return;
      state.currentIndex = idx;
      showCurrent();
      renderList();
    });
    card.querySelector('.wm-thumb-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeImage(idx);
    });
    els.list.appendChild(card);
  });
}

function removeImage(idx) {
  state.images.splice(idx, 1);
  if (state.currentIndex >= state.images.length) {
    state.currentIndex = Math.max(0, state.images.length - 1);
  }
  if (!state.images.length) {
    els.editor.hidden = true;
    els.process.disabled = true;
    setFileName('未选择文件');
  } else {
    setFileName(`已选 ${state.images.length} / ${MAX_IMAGES} 张`);
  }
  renderList();
  if (state.images.length) showCurrent();
}

function showCurrent() {
  const cur = currentImage();
  if (!cur) return;

  els.currentName.textContent = cur.name;
  els.counter.textContent = `${state.currentIndex + 1} / ${state.images.length}`;

  // 同步控件
  els.colorMode.checked = cur.colorMode;
  els.colorRow.style.display = cur.colorMode ? 'flex' : 'none';
  els.colorPicker.value = cur.color || '#ffffff';
  els.tolerance.value = cur.tolerance || 40;
  els.toleranceVal.textContent = String(cur.tolerance || 40);
  state.colorMode = !!cur.colorMode;
  state.mode = state.colorMode ? 'pick' : 'rect';
  updateModeButtons();

  // 重置结果下载按钮状态
  els.downloadCurrent.disabled = !cur.result;

  drawToCanvas(cur);
}

function drawToCanvas(item) {
  // 计算显示尺寸（保持宽高比，最大限制）
  const wrap = els.canvasWrap;
  // wrap 是 inline-block，初始可能为 0；用父级 watermark-editor 的宽度作为可靠上限
  const parentW = wrap.parentElement.clientWidth || 800;
  const maxW = Math.max(200, parentW - 4);
  const maxH = Math.min(window.innerHeight * 0.55, 520);
  const scale = Math.min(maxW / item.width, maxH / item.height, 1);
  const dw = Math.max(1, Math.floor(item.width * scale));
  const dh = Math.max(1, Math.floor(item.height * scale));

  els.canvas.width = dw;
  els.canvas.height = dh;
  els.canvas.dataset.scale = String(scale);

  redraw();
}

function redraw() {
  const cur = currentImage();
  if (!cur) return;
  const scale = parseFloat(els.canvas.dataset.scale) || 1;
  const ctx = els.ctx;
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.drawImage(cur.img, 0, 0, els.canvas.width, els.canvas.height);

  // 绘制已有选区
  cur.rects.forEach((r, i) => {
    const x = r.x * scale, y = r.y * scale, w = r.w * scale, h = r.h * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(88, 212, 200, 0.18)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#58d4c8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // 序号
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(x + 2, y + 2, 18, 16);
    ctx.fillStyle = '#58d4c8';
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1), x + 6, y + 4);
    ctx.restore();
  });

  // 绘制临时选区
  if (state.drawState && state.drawState.rect) {
    const r = state.drawState.rect;
    const x = Math.min(r.x, r.x + r.w) * scale;
    const y = Math.min(r.y, r.y + r.h) * scale;
    const w = Math.abs(r.w) * scale;
    const h = Math.abs(r.h) * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(248, 81, 73, 0.18)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}

function canvasToImageCoord(e) {
  const rect = els.canvas.getBoundingClientRect();
  const scale = parseFloat(els.canvas.dataset.scale) || 1;
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;
  return { x, y };
}

function onMouseDown(e) {
  const cur = currentImage();
  if (!cur) return;
  const p = canvasToImageCoord(e);

  if (state.mode === 'pick') {
    // 颜色吸取
    pickColorAt(p.x, p.y);
    return;
  }

  if (state.mode === 'erase') {
    // 删除点击到的选区
    for (let i = cur.rects.length - 1; i >= 0; i--) {
      const r = cur.rects[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        cur.rects.splice(i, 1);
        redraw();
        return;
      }
    }
    return;
  }

  // rect 模式：开始绘制
  state.drawState = { startX: p.x, startY: p.y, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
}

function onMouseMove(e) {
  if (!state.drawState) return;
  const p = canvasToImageCoord(e);
  const r = state.drawState.rect;
  r.x = Math.min(state.drawState.startX, p.x);
  r.y = Math.min(state.drawState.startY, p.y);
  r.w = Math.abs(p.x - state.drawState.startX);
  r.h = Math.abs(p.y - state.drawState.startY);
  redraw();
}

function onMouseUp() {
  if (!state.drawState) return;
  const cur = currentImage();
  const r = state.drawState.rect;
  state.drawState = null;

  if (!cur || r.w < 3 || r.h < 3) {
    redraw();
    return;
  }

  // 限制到图片范围
  r.x = Math.max(0, Math.min(r.x, cur.width - 1));
  r.y = Math.max(0, Math.min(r.y, cur.height - 1));
  r.w = Math.min(r.w, cur.width - r.x);
  r.h = Math.min(r.h, cur.height - r.y);

  cur.rects.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  redraw();
}

function pickColorAt(x, y) {
  const cur = currentImage();
  if (!cur) return;
  // 在临时 canvas 上取像素颜色
  const tmp = document.createElement('canvas');
  tmp.width = 1; tmp.height = 1;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(cur.img, x, y, 1, 1, 0, 0, 1, 1);
  const d = tctx.getImageData(0, 0, 1, 1).data;
  const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  els.colorPicker.value = hex;
  cur.color = hex;
  cur.colorMode = true;
  els.colorMode.checked = true;
  els.colorRow.style.display = 'flex';
}

function applyToAll() {
  const cur = currentImage();
  if (!cur) return;
  const snapshot = {
    rects: JSON.parse(JSON.stringify(cur.rects)),
    colorMode: cur.colorMode,
    color: cur.color,
    tolerance: cur.tolerance
  };
  state.images.forEach(img => {
    img.rects = JSON.parse(JSON.stringify(snapshot.rects));
    img.colorMode = snapshot.colorMode;
    img.color = snapshot.color;
    img.tolerance = snapshot.tolerance;
    img.result = null;
  });
  renderList();
  redraw();
  els.downloadAll.disabled = true;
}

function navigate(delta) {
  const next = state.currentIndex + delta;
  if (next < 0 || next >= state.images.length) return;
  state.currentIndex = next;
  showCurrent();
  renderList();
}

// ===== 去水印算法 =====

function buildMask(width, height, rects, colorMode, color, tolerance, srcData) {
  // 返回 Uint8Array：1 = 需要修复，0 = 已知
  const mask = new Uint8Array(width * height);

  // 1. 矩形选区
  for (const r of rects) {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(width, r.x + r.w);
    const y1 = Math.min(height, r.y + r.h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        mask[y * width + x] = 1;
      }
    }
  }

  // 2. 颜色吸取：标记匹配颜色的像素
  if (colorMode && color) {
    const target = hexToRgb(color);
    const tol = tolerance * 2.55; // 0-255 范围
    const data = srcData.data;
    for (let i = 0; i < width * height; i++) {
      if (mask[i]) continue;
      const idx = i * 4;
      const dr = data[idx] - target.r;
      const dg = data[idx + 1] - target.g;
      const db = data[idx + 2] - target.b;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist <= tol) mask[i] = 1;
    }
  }

  return mask;
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return {
    r: parseInt(m.substring(0, 2), 16),
    g: parseInt(m.substring(2, 4), 16),
    b: parseInt(m.substring(4, 6), 16)
  };
}

/**
 * 去水印核心：Fast Marching 风格的边界向内填充
 * - 按"到已知像素的最小距离"由近到远处理
 * - 每个待修复像素取半径 R 内已知像素的加权平均
 * - 多轮迭代优化边界平滑度
 */
function inpaint(imageData, mask, width, height, options = {}) {
  const radius = Math.max(3, options.radius || 5);
  const refinePasses = options.refinePasses || 2;
  const data = imageData.data;
  const total = width * height;

  // 距离场：每个未知像素到最近已知像素的距离
  // 用 BFS 多源最短路近似
  const dist = new Float32Array(total).fill(Infinity);
  const queue = [];
  // 先标记已知像素为距离 0，并把相邻未知像素入队
  const inQueue = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (mask[i] === 0) {
      dist[i] = 0;
    }
  }
  // 计算距离场（BFS 由已知向未知扩展）
  for (let i = 0; i < total; i++) {
    if (dist[i] === 0) {
      const x = i % width, y = (i / width) | 0;
      // 把它周围的未知像素入队
      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 1 && dist[ni] > 1) {
          dist[ni] = 1;
          if (!inQueue[ni]) { queue.push(ni); inQueue[ni] = 1; }
        }
      }
    }
  }
  // 多轮 BFS 扩展
  while (queue.length) {
    const i = queue.shift();
    inQueue[i] = 0;
    const x = i % width, y = (i / width) | 0;
    const d = dist[i];
    const neighbors = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (mask[ni] === 1 && dist[ni] > d + 1) {
        dist[ni] = d + 1;
        if (!inQueue[ni]) { queue.push(ni); inQueue[ni] = 1; }
      }
    }
  }

  // 收集所有待修复像素，按距离升序排序（近的先处理）
  const pending = [];
  for (let i = 0; i < total; i++) {
    if (mask[i] === 1) pending.push(i);
  }
  pending.sort((a, b) => dist[a] - dist[b]);

  // 主修复：按距离顺序填充
  for (const i of pending) {
    const x = i % width;
    const y = (i / width) | 0;
    let tR = 0, tG = 0, tB = 0, tA = 0, tW = 0;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] !== 0) continue; // 只用已修复/已知像素
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const w = 1 / (d2 + 0.5);
        const idx = ni * 4;
        tR += data[idx] * w;
        tG += data[idx + 1] * w;
        tB += data[idx + 2] * w;
        tA += data[idx + 3] * w;
        tW += w;
      }
    }

    const idx = i * 4;
    if (tW > 0) {
      data[idx] = tR / tW;
      data[idx + 1] = tG / tW;
      data[idx + 2] = tB / tW;
      data[idx + 3] = tA / tW;
    }
    // 标记为已修复，参与下一像素的填充
    mask[i] = 0;
  }

  // 优化轮次：对原 mask 区域做平滑扩散
  // 重新构建 mask 标记
  const refineMask = new Uint8Array(total);
  for (const i of pending) refineMask[i] = 1;

  for (let pass = 0; pass < refinePasses; pass++) {
    const newData = new Uint8ClampedArray(data);
    for (let i = 0; i < total; i++) {
      if (refineMask[i] === 0) continue;
      const x = i % width;
      const y = (i / width) | 0;
      let tR = 0, tG = 0, tB = 0, tA = 0, tW = 0;
      const r = 2;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          const d2 = dx * dx + dy * dy;
          const w = 1 / (d2 + 0.5);
          const idx = ni * 4;
          tR += data[idx] * w;
          tG += data[idx + 1] * w;
          tB += data[idx + 2] * w;
          tA += data[idx + 3] * w;
          tW += w;
        }
      }
      if (tW > 0) {
        const idx = i * 4;
        newData[idx] = tR / tW;
        newData[idx + 1] = tG / tW;
        newData[idx + 2] = tB / tW;
        newData[idx + 3] = tA / tW;
      }
    }
    for (let i = 0; i < data.length; i++) data[i] = newData[i];
  }

  return imageData;
}

async function processAll() {
  if (!state.images.length) return;
  els.process.disabled = true;
  els.progress.hidden = false;
  els.results.innerHTML = '';

  for (let i = 0; i < state.images.length; i++) {
    const item = state.images[i];
    const pct = Math.round(((i) / state.images.length) * 100);
    updateProgress(pct, `处理中 ${i + 1}/${state.images.length}：${item.name}`);

    try {
      await processOne(item);
      // 在结果区显示前后对比
      appendResult(item, i);
    } catch (err) {
      console.error('处理失败', item.name, err);
      appendError(item, err);
    }
    // 让 UI 有机会渲染
    await new Promise(r => requestAnimationFrame(r));
  }

  updateProgress(100, `完成，共 ${state.images.length} 张`);
  els.process.disabled = false;
  els.downloadAll.disabled = !state.images.some(i => i.result);
  els.downloadCurrent.disabled = !currentImage()?.result;
  renderList();
  setTimeout(() => { els.progress.hidden = true; }, 1500);
}

function updateProgress(pct, text) {
  els.progressBar.style.width = pct + '%';
  els.progressText.textContent = text;
}

async function processOne(item) {
  // 准备 canvas（按原图尺寸，超大图缩放）
  let w = item.width, h = item.height;
  let scale = 1;
  if (Math.max(w, h) > MAX_CANVAS_DIM) {
    scale = MAX_CANVAS_DIM / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(item.img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  // 把 rects 按缩放同步
  const rects = item.rects.map(r => ({
    x: Math.round(r.x * scale),
    y: Math.round(r.y * scale),
    w: Math.round(r.w * scale),
    h: Math.round(r.h * scale)
  }));

  // 没有 rect 且没启用颜色模式，则跳过
  if (!rects.length && !item.colorMode) {
    item.result = canvas.toDataURL('image/png');
    return;
  }

  const mask = buildMask(w, h, rects, item.colorMode, item.color, item.tolerance, imageData);

  // 自适应半径：根据最大选区尺寸调整
  let maxRectDim = 0;
  for (const r of rects) maxRectDim = Math.max(maxRectDim, r.w, r.h);
  if (item.colorMode) maxRectDim = Math.max(maxRectDim, 12);
  const radius = Math.min(15, Math.max(4, Math.round(maxRectDim / 6)));

  inpaint(imageData, mask, w, h, { radius, refinePasses: 2 });
  ctx.putImageData(imageData, 0, 0);

  item.result = canvas.toDataURL('image/png');
}

function appendResult(item, idx) {
  const card = document.createElement('div');
  card.className = 'wm-result-card';
  card.innerHTML = `
    <div class="wm-result-pair">
      <div class="wm-result-item">
        <span class="wm-result-label">原图</span>
        <img src="${item.img.src}" alt="原图">
      </div>
      <div class="wm-result-item">
        <span class="wm-result-label">结果</span>
        <img src="${item.result}" alt="结果">
      </div>
    </div>
    <div class="wm-result-footer">
      <span class="wm-result-name" title="${item.name}">${idx + 1}. ${item.name}</span>
      <button class="btn btn-secondary wm-result-download">下载</button>
    </div>
  `;
  card.querySelector('.wm-result-download').addEventListener('click', () => downloadImage(item.result, item.name));
  els.results.appendChild(card);
}

function appendError(item, err) {
  const card = document.createElement('div');
  card.className = 'wm-result-card';
  card.innerHTML = `<div class="wm-result-error">处理失败：${item.name} — ${err.message || err}</div>`;
  els.results.appendChild(card);
}

function downloadCurrent() {
  const cur = currentImage();
  if (cur?.result) downloadImage(cur.result, cur.name);
}

function downloadAll() {
  state.images.forEach(item => {
    if (item.result) downloadImage(item.result, item.name);
  });
}

function downloadImage(dataURL, name) {
  const base = name.replace(/\.[^.]+$/, '');
  const link = document.createElement('a');
  link.download = `${base}-去水印.png`;
  link.href = dataURL;
  link.click();
}

module.exports = { initWatermarkRemover };
