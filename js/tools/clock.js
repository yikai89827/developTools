const { ipcRenderer } = require('electron');

let statusTimer = null;

function getEl(id) {
  return document.getElementById(id);
}

function readForm() {
  return {
    enabled: getEl('clock-enabled').checked,
    workdaysOnly: getEl('clock-workdays-only').checked,
    onTime: getEl('clock-on-time').value || '09:00',
    offTime: getEl('clock-off-time').value || '18:00',
    onBeforeMinutes: Math.max(0, Math.min(120, parseInt(getEl('clock-on-before').value) || 0)),
    offAfterMinutes: Math.max(0, Math.min(120, parseInt(getEl('clock-off-after').value) || 0))
  };
}

function fillForm(cfg) {
  getEl('clock-enabled').checked = !!cfg.enabled;
  getEl('clock-workdays-only').checked = !!cfg.workdaysOnly;
  getEl('clock-on-time').value = cfg.onTime || '09:00';
  getEl('clock-off-time').value = cfg.offTime || '18:00';
  getEl('clock-on-before').value = cfg.onBeforeMinutes ?? 10;
  getEl('clock-off-after').value = cfg.offAfterMinutes ?? 10;
}

function formatNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function updateStatus() {
  getEl('clock-status-now').textContent = formatNow();
  const enabled = getEl('clock-enabled').checked;
  getEl('clock-status-enabled').textContent = enabled ? '已启用' : '已禁用';
  getEl('clock-status-enabled').style.color = enabled ? 'var(--accent)' : 'var(--text-muted)';

  if (!enabled) {
    getEl('clock-status-next').textContent = '提醒已禁用';
    return;
  }
  // 下次提醒从主进程查询，基于当前配置
  ipcRenderer.invoke('clock-get-next-reminder').then((info) => {
    getEl('clock-status-next').textContent = info?.next || '--';
  });
}

function bindEvents() {
  getEl('clock-save').addEventListener('click', () => {
    const cfg = readForm();
    ipcRenderer.send('clock-save-config', cfg);
  });

  ipcRenderer.on('clock-config-saved', () => {
    const btn = getEl('clock-save');
    const original = btn.textContent;
    btn.textContent = '✓ 已保存';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1500);
    updateStatus();
  });

  getEl('clock-test-on').addEventListener('click', () => {
    ipcRenderer.send('clock-test-reminder', 'on');
  });

  getEl('clock-test-off').addEventListener('click', () => {
    ipcRenderer.send('clock-test-reminder', 'off');
  });

  // 配置变更时实时更新状态显示
  ['clock-enabled', 'clock-workdays-only', 'clock-on-time', 'clock-off-time', 'clock-on-before', 'clock-off-after'].forEach((id) => {
    getEl(id).addEventListener('change', updateStatus);
  });

  // 开机自启动开关：立即生效，不需要点保存
  getEl('auto-launch-enabled').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const res = await ipcRenderer.invoke('auto-launch-set', enabled);
    if (!res.ok) {
      e.target.checked = !enabled; // 回滚
      alert('设置开机启动失败：' + (res.error || '未知错误'));
    }
  });
}

function initClockTool() {
  // 加载已保存的配置
  ipcRenderer.invoke('clock-get-config').then(async (cfg) => {
    if (cfg) fillForm(cfg);
    // 加载开机自启动状态
    try {
      const al = await ipcRenderer.invoke('auto-launch-get');
      getEl('auto-launch-enabled').checked = !!al.enabled;
    } catch (e) {
      console.error('[clock] 读取自启动状态失败:', e);
    }
    bindEvents();
    updateStatus();
    // 每 5 秒刷新一次当前时间与下次提醒
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(updateStatus, 5000);
  }).catch((e) => {
    console.error('[clock] 初始化失败:', e);
    bindEvents();
    updateStatus();
  });
}

module.exports = { initClockTool };
