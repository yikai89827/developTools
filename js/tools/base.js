const { copyToClipboard } = require('../utils');

function initBaseTool() {
  document.getElementById('convert-base').addEventListener('click', () => {
    const input = document.getElementById('base-input').value;
    const from = parseInt(document.getElementById('base-from').value);
    const to = parseInt(document.getElementById('base-to').value);

    try {
      const decimal = parseInt(input, from);
      document.getElementById('base-output').value = decimal.toString(to).toUpperCase();
    } catch (e) {
      document.getElementById('base-output').value = '错误: ' + e.message;
    }
  });

  document.getElementById('copy-base').addEventListener('click', () => {
    copyToClipboard(document.getElementById('base-output').value);
  });
}

module.exports = { initBaseTool };
