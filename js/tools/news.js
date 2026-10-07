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

    const byCategory = {};
    for (const [id, src] of Object.entries(data.sources)) {
      if (!byCategory[src.category]) byCategory[src.category] = [];
      byCategory[src.category].push({ id, ...src });
    }

    let html = '';
    // 热搜榜
    const hotSources = byCategory['hot'] || [];
    if (hotSources.length) {
      html += `<div class="news-category">`;
      html += `<h3 class="news-category-title">${CATEGORY_LABELS['hot']}</h3>`;
      html += `<div class="news-source-grid">`;
      for (const src of hotSources) {
        html += renderSourceBlock(src);
      }
      html += `</div></div>`;
    }
    // 政策 + 科技（同一行）
    const ptSources = [
      ...(byCategory['policy'] || []),
      ...(byCategory['tech'] || []),
    ];
    if (ptSources.length) {
      html += `<div class="news-category">`;
      html += `<div class="news-source-grid news-grid-4">`;
      for (const src of ptSources) {
        html += renderSourceBlock(src);
      }
      html += `</div></div>`;
    }
    // 国内 + 国际（同一行）
    const cwSources = [
      ...(byCategory['china'] || []),
      ...(byCategory['world'] || []),
    ];
    if (cwSources.length) {
      html += `<div class="news-category">`;
      html += `<div class="news-source-grid news-grid-4">`;
      for (const src of cwSources) {
        html += renderSourceBlock(src);
      }
      html += `</div></div>`;
    }
    container.innerHTML = html;

    bindNewsItems(container);
    bindSourceRefresh(container);
  }

  function renderSourceBlock(src) {
    const statusIcon = src.ok ? '✅' : '❌';
    const statusText = src.ok ? `${src.items.length} 条` : '获取失败';
    const itemsHtml = buildItemsHtml(src);

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

  function buildItemsHtml(src) {
    if (!src.ok) return `<div class="news-error">${escapeHtml(src.error || '获取失败')}</div>`;
    if (!src.items || !src.items.length) return '<div class="news-error">暂无数据</div>';
    return src.items.map((item, i) => {
      const num = i < 3 ? `<span class="news-rank news-rank-top">${i + 1}</span>` : `<span class="news-rank">${i + 1}</span>`;
      const hot = item.hot ? `<span class="news-hot">${formatHot(item.hot)}</span>` : '';
      return `<div class="news-item" data-url="${escapeAttr(item.url)}" data-title="${escapeAttr(item.title)}">${num}<span class="news-title">${escapeHtml(item.title)}</span>${hot}</div>`;
    }).join('');
  }

  function bindNewsItems(root) {
    root.querySelectorAll('.news-item').forEach(el => {
      el.addEventListener('click', () => {
        const url = el.dataset.url;
        const title = el.dataset.title;
        if (url) {
          // 发送到主进程，在独立阅读窗口打开页签
          ipcRenderer.send('news-open-tab', url, title);
        }
      });
    });
  }

  function bindSourceRefresh(root) {
    root.querySelectorAll('.news-source-refresh').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.source;
        el.textContent = '...';
        const result = await ipcRenderer.invoke('news-refresh-source', id);
        if (result) updateSourceBlock(id, result);
      });
    });
  }

  function updateSourceBlock(id, result) {
    const block = container.querySelector(`[data-source-id="${id}"]`);
    if (!block) return;
    const status = block.querySelector('.news-source-status');
    const itemsDiv = block.querySelector('.news-source-items');
    const refreshBtnEl = block.querySelector('.news-source-refresh');

    if (result.ok) {
      status.textContent = `✅ ${result.items.length} 条`;
      itemsDiv.innerHTML = buildItemsHtml({ ok: true, items: result.items });
      bindNewsItems(itemsDiv);
    } else {
      status.textContent = '❌ 获取失败';
      itemsDiv.innerHTML = `<div class="news-error">${escapeHtml(result.error || '获取失败')}</div>`;
    }
    refreshBtnEl.textContent = '🔄';
  }

  function saveConfig() {
    const cfg = {
      enabled: $('news-reminder-enabled').checked,
      time: $('news-reminder-time').value || '10:00',
    };
    ipcRenderer.send('news-save-config', cfg);
    saveBtn.textContent = '✓ 已保存';
    setTimeout(() => { saveBtn.textContent = '保存设置'; }, 1500);
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
