const crypto = require('crypto');
const { Base64 } = require('js-base64');
const { copyToClipboard, initTabs } = require('../utils');

function deriveKey(password, length) {
  return crypto.createHash('sha256').update(password).digest().subarray(0, length);
}

function getKeyLength(algo) {
  return algo.includes('256') ? 32 : 16;
}

function needsIv(algo) {
  return !algo.includes('ecb');
}

function aesEncrypt(text, password, algo, customIv) {
  const keyLen = getKeyLength(algo);
  const key = deriveKey(password, keyLen);

  if (needsIv(algo)) {
    const iv = customIv ? Buffer.from(customIv, 'hex') : crypto.randomBytes(16);
    if (iv.length !== 16) throw new Error('IV 必须为 16 字节（32 位十六进制字符）');
    const cipher = crypto.createCipheriv(algo, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  const cipher = crypto.createCipheriv(algo, key, null);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex');
}

function aesDecrypt(text, password, algo, customIv) {
  const keyLen = getKeyLength(algo);
  const key = deriveKey(password, keyLen);
  const cleaned = text.replace(/\s/g, '');

  if (needsIv(algo)) {
    let iv, encryptedHex;
    if (customIv) {
      iv = Buffer.from(customIv, 'hex');
      encryptedHex = cleaned;
    } else if (cleaned.includes(':')) {
      const colonIndex = cleaned.indexOf(':');
      iv = Buffer.from(cleaned.slice(0, colonIndex), 'hex');
      encryptedHex = cleaned.slice(colonIndex + 1);
    } else {
      throw new Error('密文格式错误，应为 iv:密文 或填写 IV 字段');
    }
    if (iv.length !== 16) throw new Error('IV 必须为 16 字节');
    if (!encryptedHex) throw new Error('密文不能为空');
    const decipher = crypto.createDecipheriv(algo, key, iv);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  }

  if (!cleaned) throw new Error('密文不能为空');
  const decipher = crypto.createDecipheriv(algo, key, null);
  return Buffer.concat([decipher.update(Buffer.from(cleaned, 'hex')), decipher.final()]).toString('utf8');
}

function setOutput(elementId, value) {
  const el = document.getElementById(elementId);
  el.value = value === '' ? '（结果为空）' : value;
  el.classList.toggle('has-result', value !== '');
}

function updateSymLabels() {
  const isDecrypt = document.getElementById('sym-mode').value === 'decrypt';
  const algo = document.getElementById('sym-algo').value;
  document.getElementById('sym-input-label').textContent = isDecrypt ? '密文' : '明文';
  document.getElementById('sym-input').placeholder = isDecrypt
    ? '输入密文（格式 iv:密文）'
    : '输入要加密的明文';
  document.getElementById('sym-iv-group').style.display = needsIv(algo) ? '' : 'none';
}

function initCryptoTool() {
  initTabs('#crypto-tool');

  document.getElementById('sym-mode').addEventListener('change', updateSymLabels);
  document.getElementById('sym-algo').addEventListener('change', updateSymLabels);
  updateSymLabels();

  document.getElementById('hash-exec').addEventListener('click', () => {
    const input = document.getElementById('hash-input').value;
    const algo = document.getElementById('hash-algo').value;
    try {
      setOutput('hash-output', crypto.createHash(algo).update(input).digest('hex'));
    } catch (e) {
      setOutput('hash-output', '错误: ' + e.message);
    }
  });

  document.getElementById('copy-hash').addEventListener('click', () => {
    const val = document.getElementById('hash-output').value;
    if (val && val !== '（结果为空）') copyToClipboard(val);
  });

  document.getElementById('sym-exec').addEventListener('click', () => {
    const input = document.getElementById('sym-input').value.trim();
    const password = document.getElementById('sym-key').value;
    const algo = document.getElementById('sym-algo').value;
    const mode = document.getElementById('sym-mode').value;
    const customIv = document.getElementById('sym-iv').value.trim();

    if (!password) {
      setOutput('sym-output', '错误: 请输入密钥');
      return;
    }
    if (!input) {
      setOutput('sym-output', '错误: 请输入' + (mode === 'decrypt' ? '密文' : '明文'));
      return;
    }

    try {
      const result = mode === 'encrypt'
        ? aesEncrypt(input, password, algo, customIv || null)
        : aesDecrypt(input, password, algo, customIv || null);
      setOutput('sym-output', result);
    } catch (e) {
      setOutput('sym-output', '错误: ' + e.message);
    }
  });

  document.getElementById('sym-fill-decrypt').addEventListener('click', () => {
    const output = document.getElementById('sym-output').value;
    if (!output || output.startsWith('错误:') || output === '（结果为空）') return;
    document.getElementById('sym-mode').value = 'decrypt';
    updateSymLabels();
    document.getElementById('sym-input').value = output;
    setOutput('sym-output', '');
    document.getElementById('sym-input').focus();
  });

  document.getElementById('copy-sym').addEventListener('click', () => {
    const val = document.getElementById('sym-output').value;
    if (val && !val.startsWith('错误:') && val !== '（结果为空）') copyToClipboard(val);
  });

  document.getElementById('encode-exec').addEventListener('click', () => {
    const input = document.getElementById('encode-input').value;
    const algo = document.getElementById('encode-algo').value;

    try {
      let result = '';
      switch (algo) {
        case 'base64-encode':
          result = Base64.encode(input);
          break;
        case 'base64-decode':
          result = Base64.decode(input);
          break;
        case 'hex-encode':
          result = Buffer.from(input, 'utf8').toString('hex');
          break;
        case 'hex-decode':
          result = Buffer.from(input.replace(/\s/g, ''), 'hex').toString('utf8');
          break;
        case 'url-encode':
          result = encodeURIComponent(input);
          break;
        case 'url-decode':
          result = decodeURIComponent(input);
          break;
      }
      setOutput('encode-output', result);
    } catch (e) {
      setOutput('encode-output', '错误: ' + e.message);
    }
  });

  document.getElementById('copy-encode').addEventListener('click', () => {
    const val = document.getElementById('encode-output').value;
    if (val && val !== '（结果为空）') copyToClipboard(val);
  });
}

module.exports = { initCryptoTool };
