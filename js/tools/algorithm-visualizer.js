// 算法可视化模块
// 排序算法动画演示：冒泡、选择、插入、快速、归并
// Canvas 绘制柱状图，支持播放/暂停/单步/重置/速度调节

function $(id) { return document.getElementById(id); }

// 生成每步操作的快照
// step: { array: [...], compare: [i,j], swap: [i,j], sorted: [i,...], range: [lo,hi] }

function bubbleSort(arr) {
  const steps = [];
  const a = arr.slice();
  const n = a.length;
  const sorted = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1 - i; j++) {
      steps.push({ array: a.slice(), compare: [j, j + 1], sorted: sorted.slice() });
      if (a[j] > a[j + 1]) {
        [a[j], a[j + 1]] = [a[j + 1], a[j]];
        steps.push({ array: a.slice(), swap: [j, j + 1], sorted: sorted.slice() });
      }
    }
    sorted.unshift(n - 1 - i);
  }
  sorted.unshift(0);
  steps.push({ array: a.slice(), sorted: sorted.slice(), done: true });
  return steps;
}

function selectionSort(arr) {
  const steps = [];
  const a = arr.slice();
  const n = a.length;
  const sorted = [];
  for (let i = 0; i < n - 1; i++) {
    let minIdx = i;
    for (let j = i + 1; j < n; j++) {
      steps.push({ array: a.slice(), compare: [minIdx, j], sorted: sorted.slice() });
      if (a[j] < a[minIdx]) minIdx = j;
    }
    if (minIdx !== i) {
      [a[i], a[minIdx]] = [a[minIdx], a[i]];
      steps.push({ array: a.slice(), swap: [i, minIdx], sorted: sorted.slice() });
    }
    sorted.push(i);
  }
  sorted.push(n - 1);
  steps.push({ array: a.slice(), sorted: sorted.slice(), done: true });
  return steps;
}

function insertionSort(arr) {
  const steps = [];
  const a = arr.slice();
  const n = a.length;
  const sorted = [0];
  for (let i = 1; i < n; i++) {
    let j = i;
    while (j > 0) {
      steps.push({ array: a.slice(), compare: [j - 1, j], sorted: sorted.slice() });
      if (a[j - 1] > a[j]) {
        [a[j - 1], a[j]] = [a[j], a[j - 1]];
        steps.push({ array: a.slice(), swap: [j - 1, j], sorted: sorted.slice() });
        j--;
      } else break;
    }
    sorted.push(i);
  }
  steps.push({ array: a.slice(), sorted: Array.from({ length: n }, (_, k) => k), done: true });
  return steps;
}

function quickSort(arr) {
  const steps = [];
  const a = arr.slice();
  function partition(lo, hi) {
    const pivot = a[hi];
    let i = lo - 1;
    for (let j = lo; j < hi; j++) {
      steps.push({ array: a.slice(), compare: [j, hi], sorted: [], range: [lo, hi] });
      if (a[j] < pivot) {
        i++;
        if (i !== j) {
          [a[i], a[j]] = [a[j], a[i]];
          steps.push({ array: a.slice(), swap: [i, j], sorted: [], range: [lo, hi] });
        }
      }
    }
    [a[i + 1], a[hi]] = [a[hi], a[i + 1]];
    steps.push({ array: a.slice(), swap: [i + 1, hi], sorted: [], range: [lo, hi] });
    return i + 1;
  }
  function qs(lo, hi) {
    if (lo < hi) {
      const p = partition(lo, hi);
      qs(lo, p - 1);
      qs(p + 1, hi);
    }
  }
  qs(0, a.length - 1);
  steps.push({ array: a.slice(), sorted: Array.from({ length: a.length }, (_, k) => k), done: true });
  return steps;
}

function mergeSort(arr) {
  const steps = [];
  const a = arr.slice();
  function merge(lo, mid, hi) {
    const left = a.slice(lo, mid + 1);
    const right = a.slice(mid + 1, hi + 1);
    let i = 0, j = 0, k = lo;
    while (i < left.length && j < right.length) {
      steps.push({ array: a.slice(), compare: [lo + i, mid + 1 + j], sorted: [], range: [lo, hi] });
      if (left[i] <= right[j]) {
        a[k++] = left[i++];
      } else {
        a[k++] = right[j++];
      }
      steps.push({ array: a.slice(), swap: [k - 1, k - 1], sorted: [], range: [lo, hi] });
    }
    while (i < left.length) { a[k++] = left[i++]; steps.push({ array: a.slice(), sorted: [], range: [lo, hi] }); }
    while (j < right.length) { a[k++] = right[j++]; steps.push({ array: a.slice(), sorted: [], range: [lo, hi] }); }
  }
  function ms(lo, hi) {
    if (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      ms(lo, mid);
      ms(mid + 1, hi);
      merge(lo, mid, hi);
    }
  }
  ms(0, a.length - 1);
  steps.push({ array: a.slice(), sorted: Array.from({ length: a.length }, (_, k) => k), done: true });
  return steps;
}

const ALGORITHMS = {
  bubble: { name: '冒泡排序', fn: bubbleSort, complexity: 'O(n²)', desc: '相邻比较交换，每轮把最大值冒到末尾' },
  selection: { name: '选择排序', fn: selectionSort, complexity: 'O(n²)', desc: '每轮选出最小值放到前面' },
  insertion: { name: '插入排序', fn: insertionSort, complexity: 'O(n²)', desc: '逐个插入到已排序部分的正确位置' },
  quick: { name: '快速排序', fn: quickSort, complexity: 'O(n log n)', desc: '选基准分区，递归排序两侧' },
  merge: { name: '归并排序', fn: mergeSort, complexity: 'O(n log n)', desc: '分治：拆到最小再合并有序' },
};

function initAlgorithmVisualizer() {
  const canvas = $('algo-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const algoSelect = $('algo-select');
  const sizeInput = $('algo-size');
  const speedInput = $('algo-speed');
  const playBtn = $('algo-play');
  const stepBtn = $('algo-step');
  const resetBtn = $('algo-reset');
  const newBtn = $('algo-new');
  const infoLabel = $('algo-info');
  const complexityLabel = $('algo-complexity');
  const stepCounter = $('algo-step-counter');

  let steps = [];
  let stepIdx = 0;
  let playing = false;
  let timer = null;
  let currentArray = [];

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(400, rect.width - 20);
    canvas.height = 320;
  }

  function genArray(n) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(Math.floor(Math.random() * 95) + 5);
    return arr;
  }

  function draw(step) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const arr = step.array;
    const n = arr.length;
    const barW = w / n;
    const maxVal = 100;
    const compareSet = new Set(step.compare || []);
    const swapSet = new Set(step.swap || []);
    const sortedSet = new Set(step.sorted || []);
    const [rLo, rHi] = step.range || [-1, -1];

    for (let i = 0; i < n; i++) {
      const barH = (arr[i] / maxVal) * (h - 30);
      const x = i * barW + 1;
      const y = h - barH;
      let color = '#4a9eff';
      if (sortedSet.has(i)) color = '#52c41a';
      else if (swapSet.has(i)) color = '#ff4d4f';
      else if (compareSet.has(i)) color = '#faad14';
      else if (i >= rLo && i <= rHi && rLo >= 0) color = '#722ed1';
      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.max(1, barW - 2), barH);
      // 数值标签
      if (n <= 30) {
        ctx.fillStyle = '#888';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(arr[i], x + barW / 2, h - 2);
      }
    }
  }

  function goToStep(idx) {
    if (idx < 0 || idx >= steps.length) return;
    stepIdx = idx;
    const step = steps[idx];
    draw(step);
    stepCounter.textContent = `${idx + 1} / ${steps.length}`;
    if (step.done) infoLabel.textContent = '✅ 排序完成';
    else if (step.compare) infoLabel.textContent = `🔍 比较 arr[${step.compare[0]}] 与 arr[${step.compare[1]}]`;
    else if (step.swap) infoLabel.textContent = `🔄 交换 arr[${step.swap[0]}] 与 arr[${step.swap[1]}]`;
  }

  function play() {
    if (playing) return;
    playing = true;
    playBtn.textContent = '⏸ 暂停';
    const tick = () => {
      if (!playing) return;
      if (stepIdx >= steps.length - 1) {
        pause();
        return;
      }
      goToStep(stepIdx + 1);
      const delay = 600 - (parseInt(speedInput.value) * 55);
      timer = setTimeout(tick, delay);
    };
    tick();
  }

  function pause() {
    playing = false;
    playBtn.textContent = '▶ 播放';
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function buildSteps() {
    const algoKey = algoSelect.value;
    const n = parseInt(sizeInput.value);
    currentArray = genArray(n);
    const algo = ALGORITHMS[algoKey];
    steps = algo.fn(currentArray);
    complexityLabel.textContent = `${algo.name} · 时间复杂度 ${algo.complexity}`;
    goToStep(0);
  }

  algoSelect.addEventListener('change', () => { pause(); buildSteps(); });
  sizeInput.addEventListener('change', () => { pause(); buildSteps(); });
  speedInput.addEventListener('change', () => { if (playing) { pause(); play(); } });
  playBtn.addEventListener('click', () => { if (playing) pause(); else play(); });
  stepBtn.addEventListener('click', () => { pause(); goToStep(stepIdx + 1); });
  resetBtn.addEventListener('click', () => { pause(); goToStep(0); });
  newBtn.addEventListener('click', () => { pause(); buildSteps(); });
  window.addEventListener('resize', () => { resizeCanvas(); if (steps.length) draw(steps[stepIdx]); });

  resizeCanvas();
  buildSteps();
}

module.exports = { initAlgorithmVisualizer };
