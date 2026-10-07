// 新闻聚合面板渲染模块

const { ipcRenderer } = require('electron');

const CATEGORY_LABELS = {
  hot: '🔥 热搜榜',
  tech: '💻 科技新闻',
  world: '🌍 国际媒体',
  china: '🇨🇳 国内媒体',
  policy: '📋 政策动态',
};

function $(id) { return document.getElementById(id); }

function initNewsTool() {
  const refreshBtn = $('news-refresh-all');
  const saveBtn = $('news-save-config');
  const testBtn = $('news-test-reminder');
  const container = $('news-categories');
  const updatedTime = $('news-updated-time');

  // 首次加载
  loadNews(false);

  refreshBtn.addEventListener('click', () => loadNews(true));
  saveBtn.addEventListener('click', saveConfig);
  testBtn.addEventListener('click', () => ipcRenderer.send('news-test-reminder'));

  // 加载提醒配置
  ipcRenderer.invoke('news-get-config').then(cfg => {
    if (cfg) {
      $('news-reminder-enabled').checked = !!cfg.enabled;
      $('news-reminder-time').value = cfg.time || '10:00';
    }
  });

  async function loadNews(force) {
    container.innerHTML = '<div class="news-loading">加载中...</div>';
    try {
      const data = await ipcRenderer.invoke('news-get-all', force);
      renderNews(data);
      if (data.timestamp) {
        const d = new Date(data.timestamp);
        updatedTime.textContent = `更新于 ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
      }
    } catch (err) {
      container.innerHTML = `<div class="news-loading">加载失败: ${err.message}</div>`;
    }
  }

  function renderNews(data) {
    if (!data || !data.sources) {
      container.innerHTML = '<div class="news-loading">暂无数据</div>';
      return;
    }

    // 按分类分组
    const byCategory = {};
    for (const [id, src] of Object.entries(data.sources)) {
      if (!byCategory[src.category]) byCategory[src.category] = [];
      byCategory[src.category].push({ id, ...src });
    }

    let html = '';
    for (const cat of ['hot', 'tech', 'world', 'china', 'policy']) {
      const sources = byCategory[cat];
      if (!sources || !sources.length) continue;
      html += `<div class="news-category">`;
      html += `<h3 class="news-category-title">${CATEGORY_LABELS[cat] || cat}</h3>`;
      html += `<div class="news-source-grid">`;
      for (const src of sources) {
        html += renderSourceBlock(src);
      }
      html += `</div></div>`;
    }
    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.news-item').forEach(el => {
      el.addEventListener('click', () => {
        const url = el.dataset.url;
        const title = el.dataset.title;
        if (url) ipcRenderer.send('news-open-webview', url, title);
      });
    });

    // 绑定单源刷新
    container.querySelectorAll('.news-source-refresh').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.source;
        el.textContent = '刷新中...';
        const result = await ipcRenderer.invoke('news-refresh-source', id);
        if (result) updateSourceBlock(id, result);
      });
    });
  }

  function renderSourceBlock(src) {
    const statusIcon = src.ok ? '✅' : '❌';
    const statusText = src.ok ? `${src.items.length} 条` : '获取失败';

    let itemsHtml = '';
    if (src.ok && src.items.length) {
      itemsHtml = src.items.map((item, i) => {
        const num = i < 3 ? `<span class="news-rank news-rank-top">${i + 1}</span>` : `<span class="news-rank">${i + 1}</span>`;
        const hot = item.hot ? `<span class="news-hot">${formatHot(item.hot)}</span>` : '';
        return `<div class="news-item" data-url="${escapeAttr(item.url)}" data-title="${escapeAttr(item.title)}">${num}<span class="news-title">${escapeHtml(item.title)}</span>${hot}</div>`;
      }).join('');
    } else if (!src.ok) {
      itemsHtml = `<div class="news-error">${escapeHtml(src.error || '获取失败')}</div>`;
    } else {
      itemsHtml = '<div class="news-error">暂无数据</div>';
    }

    return `
      <div class="news-source-block" data-source-id="${src.id || src.name}">
        <div class="news-source-header">
          <span class="news-source-name">${escapeHtml(src.name)}</span>
          <span class="news-source-status">${statusIcon} ${statusText}</span>
          <button class="news-source-refresh" data-source="${src.id || ''}">🔄</button>
        </div>
        <div class="news-source-items">${itemsHtml}</div>
      </div>`;
  }

  function updateSourceBlock(id, result) {
    const block = container.querySelector(`[data-source-id="${id}"]`);
    if (!block) return;
    const status = block.querySelector('.news-source-status');
    const itemsDiv = block.querySelector('.news-source-items');
    const refreshBtn = block.querySelector('.news-source-refresh');

    if (result.ok) {
      status.textContent = `✅ ${result.items.length} 条`;
      if (result.items.length) {
        itemsDiv.innerHTML = result.items.map((item, i) => {
          const num = i < 3 ? `<span class="news-rank news-rank-top">${i + 1}</span>` : `<span class="news-rank">${i + 1}</span>`;
          const hot = item.hot ? `<span class="news-hot">${formatHot(item.hot)}</span>` : '';
          return `<div class="news-item" data-url="${escapeAttr(item.url)}" data-title="${escapeAttr(item.title)}">${num}<span class="news-title">${escapeHtml(item.title)}</span>${hot}</div>`;
        }).join('');
        // 重新绑定点击
        itemsDiv.querySelectorAll('.news-item').forEach(el => {
          el.addEventListener('click', () => {
            ipcRenderer.send('news-open-webview', el.dataset.url, el.dataset.title);
          });
        });
      } else {
        itemsDiv.innerHTML = '<div class="news-error">暂无数据</div>';
      }
    } else {
      status.textContent = '❌ 获取失败';
      itemsDiv.innerHTML = `<div class="news-error">${escapeHtml(result.error || '获取失败')}</div>`;
    }
    refreshBtn.textContent = '🔄';
  }

  function saveConfig() {
    const cfg = {
      enabled: $('news-reminder-enabled').checked,
      time: $('news-reminder-time').value || '10:00',
    };
    ipcRenderer.send('news-save-config', cfg);
    const btn = saveBtn;
    btn.textContent = '✓ 已保存';
    setTimeout(() => { btn.textContent = '保存设置'; }, 1500);
  }
}

function formatHot(n) {
  if (!n) return '';
  if (n > 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g,'&quot;');
}

module.exports = { initNewsTool };
