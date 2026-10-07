// 每日10题模块（力扣题库按日期翻页取10题）
// 主进程通过 GraphQL 获取力扣题目列表，渲染到面板

const { ipcRenderer } = require('electron');

function $(id) { return document.getElementById(id); }

function initLeetcodeDaily() {
  const container = $('leetcode-content');
  const refreshBtn = $('leetcode-refresh');
  if (!container || !refreshBtn) return;

  async function loadDaily() {
    container.innerHTML = '<div class="news-loading">加载中...</div>';
    try {
      const data = await ipcRenderer.invoke('leetcode-fetch-daily');
      if (!data || data.error) {
        container.innerHTML = `<div class="news-error">❌ ${data ? data.error : '获取失败'}</div>`;
        return;
      }
      renderQuestions(data);
    } catch (e) {
      container.innerHTML = `<div class="news-error">❌ ${e.message}</div>`;
    }
  }

  function renderQuestions(data) {
    const items = data.items || [];
    if (!items.length) {
      container.innerHTML = '<div class="news-error">❌ 暂无题目</div>';
      return;
    }
    const dateStr = data.date || new Date().toISOString().slice(0, 10);
    const tag = '<span class="leetcode-online-tag">经典题库·每日轮换</span>';

    let html = `<div class="leetcode-daily">`;
    html += `<div class="leetcode-daily-head">`;
    html += `<span class="leetcode-date">📅 ${dateStr} · 今日 10 题</span>`;
    html += tag;
    html += `</div>`;
    html += `<ul class="leetcode-list">`;
    items.forEach((q, i) => {
      const diff = q.difficulty || '?';
      const diffColor = diff === '困难' ? '#ff4d4f' : (diff === '中等' ? '#faad14' : '#52c41a');
      const url = `https://leetcode.cn/problems/${q.titleSlug}/`;
      const title = q.questionTitle || q.title || '';
      html += `<li class="leetcode-item" data-url="${escapeAttr(url)}">`;
      html += `<span class="leetcode-rank">${i + 1}</span>`;
      html += `<span class="leetcode-qid">#${q.questionFrontendId}</span>`;
      html += `<span class="leetcode-title">${escapeHtml(title)}</span>`;
      html += `<span class="leetcode-diff" style="background:${diffColor}">${diff}</span>`;
      html += `</li>`;
    });
    html += `</ul>`;
    html += `<div class="leetcode-actions">`;
    html += `<span class="leetcode-tip">点击任意题目前往力扣做题 →</span>`;
    html += `</div>`;
    html += `</div>`;
    container.innerHTML = html;

    container.querySelectorAll('.leetcode-item').forEach(el => {
      el.addEventListener('click', () => {
        const url = el.dataset.url;
        if (url) ipcRenderer.send('news-open-tab', url, '力扣每日10题');
      });
    });
  }

  refreshBtn.addEventListener('click', loadDaily);
  loadDaily();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

module.exports = { initLeetcodeDaily };
