const { ipcRenderer } = require('electron');

const FALLBACK_ICONS = ['⚙️', '🧠', '🧩', '🎬', '🧬', '🆓', '🔌', '🚀', '🛠️', '🛰️'];

let items = [];
let meta = { sinceLabel: '今日', langLabel: 'AI' };
let timer = null;
let paused = false;
let index = 0;

const listEl = document.getElementById('list');
const heroEl = document.getElementById('hero');
const titleMain = document.getElementById('title-main');
const titleSub = document.getElementById('title-sub');
const tagline = document.getElementById('tagline');

function formatStars(n) {
  if (!n && n !== 0) return '';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万★';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k★';
  return n + '★';
}

function shortDesc(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '值得关注的 AI 开源项目';
  return s.length > 28 ? s.slice(0, 28) + '…' : s;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function metricOf(repo) {
  // 有今日新增优先显示涨幅；否则显示总星
  if (repo.starsToday) return `+${repo.starsToday}`;
  if (repo.stars) return formatStars(repo.stars);
  return '';
}

function displayName(repo) {
  if (repo.author && repo.name) return `${repo.author}/${repo.name}`;
  return repo.name || 'project';
}

function validStars(repo) {
  const s = Number(repo.stars) || 0;
  const today = Number(repo.starsToday) || 0;
  // 排除解析成 SVG 的 16 等脏数据：总星不能小于今日涨幅
  if (!s) return 0;
  if (today && s < today) return 0;
  if (s === 16 && today > 16) return 0;
  return s;
}

function buildList() {
  listEl.innerHTML = '';
  items.slice(0, 8).forEach((repo, i) => {
    const icon = repo.icon || FALLBACK_ICONS[i % FALLBACK_ICONS.length];
    const zh = repo.descriptionZh || repo.description || '热门 AI 开源项目';
    const stars = validStars(repo);
    const starBit = stars ? formatStars(stars) : '';
    const desc = starBit ? `${starBit} · ${zh}` : zh;
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="icon">${icon}</div>
      <div class="rank">${pad(i + 1)}</div>
      <div class="body">
        <div class="name">${escapeHtml(displayName(repo))}</div>
        <div class="desc">${escapeHtml(shortDesc(desc))}</div>
      </div>
      <div class="metric">${escapeHtml(metricOf(repo))}</div>
    `;
    listEl.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function clearTimers() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** 总时长约 7–10 秒：条数决定，约一条一秒 */
function timingFor(count) {
  const n = Math.max(count, 1);
  const totalMs = Math.min(10000, Math.max(7000, n * 1000));
  const heroMs = 600;
  const endHoldMs = 1000;
  const itemMs = Math.round((totalMs - heroMs) / n);
  return { heroMs, itemMs, endHoldMs, totalMs };
}

function play() {
  clearTimers();
  paused = false;
  index = 0;

  titleMain.textContent = `${meta.sinceLabel}涨得最猛`;
  titleSub.textContent = `TOP ${Math.min(items.length, 8)} ${meta.langLabel}项目`;
  tagline.textContent = '全部免费 · 复制就能跑';

  heroEl.classList.remove('show');
  [...listEl.children].forEach((el) => {
    el.classList.remove('in', 'pulse');
  });

  const { heroMs } = timingFor(listEl.children.length);
  requestAnimationFrame(() => {
    heroEl.classList.add('show');
    timer = setTimeout(showNext, heroMs);
  });
}

function showNext() {
  if (paused) return;
  const rows = [...listEl.children];
  const total = rows.length;
  const { itemMs, endHoldMs } = timingFor(total);
  if (index >= total) {
    rows.forEach((el) => el.classList.add('pulse'));
    timer = setTimeout(play, endHoldMs);
    return;
  }

  rows[index].classList.add('in');
  index += 1;
  timer = setTimeout(showNext, itemMs);
}

function togglePause() {
  paused = !paused;
  if (paused) clearTimers();
  else showNext();
  return { paused };
}

ipcRenderer.on('trending-reel-data', (event, payload) => {
  items = Array.isArray(payload?.items) ? payload.items : [];
  meta = {
    sinceLabel: payload?.sinceLabel || '今日',
    langLabel: payload?.langLabel || 'AI'
  };
  buildList();
  play();
});

ipcRenderer.on('trending-reel-cmd', (event, cmd) => {
  if (cmd === 'replay') play();
  else if (cmd === 'pause') togglePause();
});

ipcRenderer.send('trending-reel-ready');
