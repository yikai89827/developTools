const { copyToClipboard } = require('../utils');

const PRESETS = {
  email: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
  phone: '1[3-9]\\d{9}',
  url: 'https?:\\/\\/[\\w\\-]+(\\.[\\w\\-]+)+[\\w\\-.,@?^=%&:/~+#]*',
  ip: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}',
  date: '\\d{4}-\\d{2}-\\d{2}'
};

function initRegexTool() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('regex-pattern').value = PRESETS[btn.dataset.preset];
    });
  });

  document.getElementById('test-regex').addEventListener('click', () => {
    const pattern = document.getElementById('regex-pattern').value;
    const test = document.getElementById('regex-test').value;

    try {
      const regex = new RegExp(pattern, 'g');
      const matches = test.match(regex);
      document.getElementById('regex-result').value = matches ? matches.join('\n') : '无匹配';
    } catch (e) {
      document.getElementById('regex-result').value = '正则表达式错误: ' + e.message;
    }
  });

  document.getElementById('copy-regex').addEventListener('click', () => {
    copyToClipboard(document.getElementById('regex-result').value);
  });
}

module.exports = { initRegexTool };
