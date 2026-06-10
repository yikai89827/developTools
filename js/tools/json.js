const { copyToClipboard, initTabs, compareObjects } = require('../utils');

function initJsonTool() {
  initTabs('#json-tool');

  document.getElementById('format-json').addEventListener('click', () => {
    const input = document.getElementById('json-input').value;
    try {
      const parsed = JSON.parse(input);
      document.getElementById('json-output').value = JSON.stringify(parsed, null, 2);
    } catch (e) {
      document.getElementById('json-output').value = 'JSON格式错误: ' + e.message;
    }
  });

  document.getElementById('copy-json').addEventListener('click', () => {
    copyToClipboard(document.getElementById('json-output').value);
  });

  document.getElementById('compare-json').addEventListener('click', () => {
    const a = document.getElementById('json-a').value;
    const b = document.getElementById('json-b').value;
    try {
      const diff = compareObjects(JSON.parse(a), JSON.parse(b));
      document.getElementById('json-diff').textContent = JSON.stringify(diff, null, 2);
    } catch (e) {
      document.getElementById('json-diff').textContent = 'JSON格式错误: ' + e.message;
    }
  });

  document.getElementById('minify-json').addEventListener('click', () => {
    const input = document.getElementById('minify-input').value;
    try {
      const parsed = JSON.parse(input);
      document.getElementById('minify-output').value = JSON.stringify(parsed);
    } catch (e) {
      document.getElementById('minify-output').value = 'JSON格式错误: ' + e.message;
    }
  });

  document.getElementById('copy-minify').addEventListener('click', () => {
    copyToClipboard(document.getElementById('minify-output').value);
  });
}

module.exports = { initJsonTool };
