const beautify = require('js-beautify');
const { copyToClipboard, initTabs } = require('../utils');

function initCodeTool() {
  initTabs('#code-tool');

  document.getElementById('beautify-code').addEventListener('click', () => {
    const input = document.getElementById('beautify-input').value;
    const lang = document.getElementById('beautify-lang').value;

    try {
      let result = input;
      if (lang === 'js') {
        result = beautify.js(input, { indent_size: 2 });
      } else if (lang === 'css') {
        result = beautify.css(input, { indent_size: 2 });
      } else if (lang === 'html') {
        result = beautify.html(input, { indent_size: 2 });
      }
      document.getElementById('beautify-output').value = result;
    } catch (e) {
      document.getElementById('beautify-output').value = '错误: ' + e.message;
    }
  });

  document.getElementById('copy-beautify').addEventListener('click', () => {
    copyToClipboard(document.getElementById('beautify-output').value);
  });

  document.getElementById('minify-code').addEventListener('click', () => {
    const input = document.getElementById('minify-code-input').value;
    try {
      document.getElementById('minify-code-output').value = input.replace(/\s+/g, ' ').trim();
    } catch (e) {
      document.getElementById('minify-code-output').value = '错误: ' + e.message;
    }
  });

  document.getElementById('copy-minify-code').addEventListener('click', () => {
    copyToClipboard(document.getElementById('minify-code-output').value);
  });
}

module.exports = { initCodeTool };
