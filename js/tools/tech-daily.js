// 技术日报模块
// 聚合 V2EX 热门 + 掘金热榜 + Hacker News，摸鱼学技术

const { ipcRenderer } = require('electron');

function $(id) { return document.getElementById(id); }

const SOURCES = [
  { id: 'v2ex', name: 'V2EX 热门', cat: 'tech' },
  { id: 'juejin', name: '掘金热榜', cat: 'tech' },
  { id: 'hn', name: 'Hacker News', cat: 'tech' },
];

function initTechDaily() {
  const container = $('tech-daily-content');
  const refreshBtn = $('tech-daily-refresh');
  if (!container || !refreshBtn) return;

  async function load() {
    container.innerHTML = '<div class="news-loading">加载中...</div>';
    try {
      const data = await ipcRenderer.invoke('tech-daily-fetch');
      if (!data) { container.innerHTML = '<div class="news-error">获取失败</div>'; return; }
      if (data.error) { container.innerHTML = `<div class="news-error">❌ ${data.error}</div>`; return; }
      render(data);
    } catch (e) {
      container.innerHTML = `<div class="news-error">❌ ${e.message}</div>`;
    }
  }

  function render(data) {
    const fallback = !!data.fallback;
    let html = '<div class="tech-daily-wrap">';
    html += `<div class="tech-daily-status">${fallback ? '⚠️ 离线数据（网络不可用，显示缓存热门）' : '🟢 实时数据'}</div>`;
    html += '<div class="tech-daily-grid">';
    for (const src of SOURCES) {
      const items = data[src.id] || [];
      const ok = items.length > 0;
      html += `<div class="tech-source-block">`;
      html += `<div class="tech-source-head">`;
      html += `<span class="tech-source-name">${src.name}</span>`;
      html += `<span class="tech-source-count">${ok ? items.length + ' 条' : '获取失败'}</span>`;
      html += `</div>`;
      if (!ok) {
        html += `<div class="news-error">❌ 获取失败</div>`;
      } else {
        html += `<ul class="tech-item-list">`;
        items.slice(0, 15).forEach((it, i) => {
          const num = `<span class="tech-item-rank">${i + 1}</span>`;
          const title = escapeHtml(it.title || '');
          const hot = it.score || it.replies ? `<span class="tech-item-hot">💬 ${it.replies || it.score}</span>` : '';
          html += `<li class="tech-item" data-url="${escapeAttr(it.url || '')}">${num}<span class="tech-item-title">${title}</span>${hot}</li>`;
        });
        html += `</ul>`;
      }
      html += `</div>`;
    }
    html += '</div></div>';
    container.innerHTML = html;

    container.querySelectorAll('.tech-item').forEach(el => {
      el.addEventListener('click', () => {
        const url = el.dataset.url;
        if (url) ipcRenderer.send('news-open-tab', url, '技术日报');
      });
    });
  }

  refreshBtn.addEventListener('click', load);
  load();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

module.exports = { initTechDaily };
