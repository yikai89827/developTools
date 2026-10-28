const { ipcRenderer } = require('electron');

function initPetTool() {
  const enabled = document.getElementById('pet-enabled');
  const scale = document.getElementById('pet-scale');
  const scaleLabel = document.getElementById('pet-scale-label');
  const status = document.getElementById('pet-status');

  function apply() {
    ipcRenderer.send('pet-set-config', {
      enabled: enabled.checked,
      scale: Number(scale.value)
    });
    scaleLabel.textContent = `${scale.value}%`;
  }

  ipcRenderer.on('pet-config', (event, config) => {
    enabled.checked = !!config.enabled;
    scale.value = String(config.scale || 100);
    scaleLabel.textContent = `${scale.value}%`;
    status.textContent = config.listening
      ? '正在同步键盘和鼠标'
      : (config.error || '宠物已关闭');
  });

  enabled.addEventListener('change', apply);
  scale.addEventListener('input', apply);
  document.getElementById('pet-reset').addEventListener('click', () => {
    ipcRenderer.send('pet-reset-position');
  });

  ipcRenderer.send('pet-get-config');
}

module.exports = { initPetTool };
