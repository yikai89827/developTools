// GitHub Trending 模块
// 主进程抓取 GitHub Trending；动画榜专拉 AI 热门并中文功能描述

const { ipcRenderer } = require('electron');

function $(id) { return document.getElementById(id); }

function initGithubTrending() {
  const container = $('trending-list');
  const refreshBtn = $('trending-refresh');
  const playBtn = $('trending-play-reel');
  const replayBtn = $('trending-reel-replay');
  const pauseBtn = $('trending-reel-pause');
  const langSelect = $('trending-lang');
  const sinceSelect = document.getElementById('trending-since');
  if (!container || !refreshBtn) return;

  let lastItems = [];

  function sinceLabelOf(v) {
    return ({ daily: '今日', weekly: '本周', monthly: '本月' })[v] || '今日';
  }

  async function openReel() {
    const since = sinceSelect ? sinceSelect.value : 'daily';
    if (playBtn) {
      playBtn.disabled = true;
      playBtn.textContent = '⏳ 拉取AI…';
    }
    try {
      const resp = await ipcRenderer.invoke('github-fetch-ai-trending', since);
      const items = (resp && resp.items) || [];
      await ipcRenderer.invoke('github-open-trending-reel', {
        items: items.slice(0, 8),
        sinceLabel: sinceLabelOf(since),
        langLabel: 'AI',
      });
    } catch (e) {
      console.error(e);
    } finally {
      if (playBtn) {
        playBtn.disabled = false;
        playBtn.textContent = '▶️ AI动画';
      }
    }
  }

  async function load() {
    container.innerHTML = '<div class="news-loading">加载中...</div>';
    const lang = langSelect.value;
    const since = sinceSelect ? sinceSelect.value : 'daily';
    try {
      const resp = await ipcRenderer.invoke('github-fetch-trending', lang, since);
      if (!resp) {
        container.innerHTML = '<div class="news-error">❌ 获取失败</div>';
        return;
      }
      // fallback 时也可能带 error 字段，仍展示 items
      lastItems = resp.items || [];
      if (!lastItems.length) {
        container.innerHTML = `<div class="news-error">❌ ${resp.error || '暂无数据'}</div>`;
        return;
      }
      render(lastItems, resp.fallback);
    } catch (e) {
      container.innerHTML = `<div class="news-error">❌ ${e.message}</div>`;
    }
  }

  function render(repos, fallback) {
    if (!repos.length) {
      container.innerHTML = '<div class="git-empty">暂无数据</div>';
      return;
    }
    let html = '<div class="trending-wrap">';
    html += `<div class="trending-status">${fallback ? '⚠️ 离线数据（网络不可用）' : '🟢 实时数据'} · 点「AI动画」生成竖屏 AI 趋势榜</div>`;
    html += '<div class="trending-grid">';
    for (const r of repos) {
      html += `<div class="trending-card" data-url="${escapeAttr(r.url)}">`;
      html += `<div class="trending-card-head">`;
      html += `<span class="trending-name">${escapeHtml(r.author)}/${escapeHtml(r.name)}</span>`;
      if (r.starsToday) {
        html += `<span class="trending-stars-today">⭐ ${r.starsToday} 今日</span>`;
      }
      html += `</div>`;
      if (r.description) {
        html += `<p class="trending-desc">${escapeHtml(r.description)}</p>`;
      }
      html += `<div class="trending-meta">`;
      if (r.language) html += `<span class="trending-lang"><span class="lang-dot" style="background:${escapeAttr(r.languageColor || '#888')}"></span>${escapeHtml(r.language)}</span>`;
      html += `<span class="trending-stars">总 ⭐ ${formatNum(r.stars)}</span>`;
      if (r.forks) html += `<span class="trending-forks">🍴 ${formatNum(r.forks)}</span>`;
      html += `</div>`;
      html += `</div>`;
    }
    html += '</div></div>';
    container.innerHTML = html;

    container.querySelectorAll('.trending-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.dataset.url;
        if (url) ipcRenderer.send('news-open-tab', url, 'GitHub Trending');
      });
    });
  }

  refreshBtn.addEventListener('click', load);
  if (playBtn) playBtn.addEventListener('click', openReel);
  if (replayBtn) {
    replayBtn.addEventListener('click', async () => {
      const ok = await ipcRenderer.invoke('github-trending-reel-cmd', 'replay');
      if (!ok || !ok.ok) openReel();
    });
  }
  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('github-trending-reel-cmd', 'pause');
    });
  }
  if (langSelect) langSelect.addEventListener('change', load);
  if (sinceSelect) sinceSelect.addEventListener('change', load);
  load();
}

function formatNum(n) {
  if (!n && n !== 0) return '';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

module.exports = { initGithubTrending };
