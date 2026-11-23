const { ipcRenderer } = require('electron');

function readForm() {
  return {
    baseUrl: document.getElementById('baota-base-url').value.trim(),
    entryPath: document.getElementById('baota-entry-path').value.trim() || '/0ab2f6fe',
    username: document.getElementById('baota-username').value.trim(),
    password: document.getElementById('baota-password').value,
    autofill: !!document.getElementById('baota-autofill').checked,
  };
}

function fillForm(cfg) {
  if (!cfg) return;
  document.getElementById('baota-base-url').value = cfg.baseUrl || '';
  document.getElementById('baota-entry-path').value = cfg.entryPath || '/0ab2f6fe';
  document.getElementById('baota-username').value = cfg.username || '';
  document.getElementById('baota-password').value = cfg.password || '';
  document.getElementById('baota-autofill').checked = cfg.autofill !== false;
  // Sync shortcut data-path for panel home from entry path
  const homeBtn = document.querySelector('.baota-shortcut[data-role="home"]')
    || document.querySelector('#baota-shortcuts .baota-shortcut');
  if (homeBtn) homeBtn.dataset.path = cfg.entryPath || '/0ab2f6fe';
  setStatus(cfg.baseUrl ? `已加载配置：${cfg.baseUrl}` : '请填写面板地址后保存');
}

function setStatus(text) {
  const el = document.getElementById('baota-status');
  if (el) el.textContent = text;
}

async function saveConfig() {
  const cfg = readForm();
  if (!cfg.baseUrl) {
    setStatus('请先填写面板地址');
    return;
  }
  try {
    new URL(cfg.baseUrl);
  } catch {
    setStatus('面板地址格式无效，需包含协议与端口，例如 https://x.x.x.x:17069');
    return;
  }
  const ok = await ipcRenderer.invoke('baota-save-config', cfg);
  setStatus(ok ? '配置已保存到本机' : '保存失败');
}

async function openPath(pathValue) {
  const cfg = readForm();
  if (!cfg.baseUrl) {
    setStatus('请先填写并保存面板地址');
    return;
  }
  setStatus(`正在打开 ${pathValue || cfg.entryPath} …`);
  const result = await ipcRenderer.invoke('baota-open', {
    ...cfg,
    openPath: pathValue || cfg.entryPath || '/',
  });
  if (!result?.ok) {
    setStatus(result?.error || '打开失败');
    return;
  }
  setStatus(`已打开：${result.url}`);
}

function initBaotaTool() {
  ipcRenderer.invoke('baota-get-config').then(fillForm).catch(() => setStatus('读取配置失败'));

  document.getElementById('baota-save')?.addEventListener('click', () => void saveConfig());
  document.getElementById('baota-open-panel')?.addEventListener('click', () => {
    const cfg = readForm();
    void openPath(cfg.entryPath || '/0ab2f6fe');
  });

  document.querySelectorAll('#baota-shortcuts .baota-shortcut').forEach((btn) => {
    btn.addEventListener('click', () => void openPath(btn.dataset.path || '/'));
  });
}

module.exports = { initBaotaTool };
