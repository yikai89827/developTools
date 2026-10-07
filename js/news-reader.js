// 新闻阅读窗口 - 页签管理逻辑
const { ipcRenderer } = require('electron');

const tabs = []; // { id, url, title, tabEl, wvEl }
let activeId = null;
let counter = 0;

const tabBar = document.getElementById('tabBar');
const wvContainer = document.getElementById('wvContainer');

ipcRenderer.on('news-add-tab', (event, { url, title }) => {
  addTab(url, title);
});

function addTab(url, title) {
  if (!url) return;

  // 同 URL 已存在则切换
  const existing = tabs.find(t => t.url === url);
  if (existing) {
    switchTab(existing.id);
    return;
  }

  // 超过 10 个关最早
  if (tabs.length >= 10) {
    closeTab(tabs[0].id);
  }

  const id = ++counter;
  const shortTitle = title.length > 15 ? title.slice(0, 15) + '…' : title;

  // 创建页签
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `<span class="tab-title" title="${escapeHtml(title)}">${escapeHtml(shortTitle)}</span><span class="tab-close">✕</span>`;
  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      e.stopPropagation();
      closeTab(id);
    } else {
      switchTab(id);
    }
  });
  tabBar.appendChild(tabEl);

  // 创建 webview
  const wv = document.createElement('webview');
  wv.src = url;
  wv.setAttribute('allowpopups', '');
  wvContainer.appendChild(wv);

  tabs.push({ id, url, title, tabEl, wvEl: wv });

  // 移除空提示
  const hint = wvContainer.querySelector('.empty-hint');
  if (hint) hint.remove();

  switchTab(id);
}

function switchTab(id) {
  activeId = id;
  tabs.forEach(t => {
    const active = t.id === id;
    t.tabEl.classList.toggle('active', active);
    t.wvEl.classList.toggle('active', active);
  });
  // 滚动到可视
  const active = tabs.find(t => t.id === id);
  if (active) active.tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  tab.tabEl.remove();
  tab.wvEl.remove();
  tabs.splice(idx, 1);

  if (activeId === id) {
    if (tabs.length) {
      switchTab(tabs[Math.max(0, idx - 1)].id);
    } else {
      activeId = null;
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = '点击新闻标题打开文章';
      wvContainer.appendChild(hint);
    }
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 通知主进程窗口已就绪
ipcRenderer.send('news-reader-ready');
