const { copyToClipboard } = require('../utils');

function initTimeTool() {
  document.getElementById('convert-time').addEventListener('click', () => {
    const timestamp = document.getElementById('timestamp-input').value;
    const datetime = document.getElementById('datetime-input').value;

    try {
      let date;
      if (timestamp) {
        date = new Date(parseInt(timestamp));
      } else if (datetime) {
        date = new Date(datetime);
      } else {
        date = new Date();
      }

      document.getElementById('time-formatted').value = date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      document.getElementById('time-formatted').value = '错误: ' + e.message;
    }
  });

  document.getElementById('now-time').addEventListener('click', () => {
    const now = new Date();
    document.getElementById('timestamp-input').value = Math.floor(now.getTime() / 1000);
    document.getElementById('datetime-input').value = now.toISOString().slice(0, 16);
    document.getElementById('time-formatted').value = now.toLocaleString('zh-CN');
  });

  document.getElementById('copy-time').addEventListener('click', () => {
    copyToClipboard(document.getElementById('time-formatted').value);
  });
}

module.exports = { initTimeTool };
