const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { copyToClipboard, initTabs } = require('../utils');

function initGeneratorTool() {
  initTabs('#generator-tool');

  document.getElementById('generate-password').addEventListener('click', () => {
    const length = parseInt(document.getElementById('password-length').value);
    const uppercase = document.getElementById('password-uppercase').checked;
    const lowercase = document.getElementById('password-lowercase').checked;
    const numbers = document.getElementById('password-numbers').checked;
    const symbols = document.getElementById('password-symbols').checked;

    let charset = '';
    if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (numbers) charset += '0123456789';
    if (symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz';

    let password = '';
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      password += charset[array[i] % charset.length];
    }

    document.getElementById('password-output').value = password;
  });

  document.getElementById('copy-password').addEventListener('click', () => {
    copyToClipboard(document.getElementById('password-output').value);
  });

  document.getElementById('generate-uuid').addEventListener('click', () => {
    document.getElementById('uuid-output').value = uuidv4();
  });

  document.getElementById('copy-uuid').addEventListener('click', () => {
    copyToClipboard(document.getElementById('uuid-output').value);
  });
}

module.exports = { initGeneratorTool };
