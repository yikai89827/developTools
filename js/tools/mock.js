const { copyToClipboard, initTabs } = require('../utils');

function generateMockValue(type) {
  const firstNames = ['张三', '李四', '王五', '赵六', '钱七'];
  const lastNames = ['伟', '强', '丽', '敏', '杰'];

  switch (type) {
    case 'name':
      return firstNames[Math.floor(Math.random() * firstNames.length)] +
             lastNames[Math.floor(Math.random() * lastNames.length)];
    case 'age':
      return Math.floor(Math.random() * 50) + 18;
    case 'email':
      return 'test' + Math.floor(Math.random() * 1000) + '@example.com';
    case 'phone':
      return '1' + ['3', '4', '5', '7', '8'][Math.floor(Math.random() * 5)] +
             Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
    case 'id':
      return Math.floor(Math.random() * 100000);
    case 'date':
      return new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    case 'bool':
      return Math.random() > 0.5;
    case 'number':
      return Math.floor(Math.random() * 1000);
    case 'string':
      return '随机字符串' + Math.floor(Math.random() * 100);
    default:
      return type;
  }
}

function generateMock(obj) {
  const result = {};
  for (const key in obj) {
    const value = obj[key];
    if (typeof value === 'string' && value.startsWith('@')) {
      result[key] = generateMockValue(value.slice(1));
    } else if (typeof value === 'object') {
      result[key] = generateMock(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function initMockTool() {
  initTabs('#mock-tool');

  document.getElementById('generate-mock').addEventListener('click', () => {
    const schema = document.getElementById('mock-schema').value;
    try {
      const mock = generateMock(JSON.parse(schema));
      document.getElementById('mock-output').value = JSON.stringify(mock, null, 2);
    } catch (e) {
      document.getElementById('mock-output').value = '错误: ' + e.message;
    }
  });

  document.getElementById('copy-mock').addEventListener('click', () => {
    copyToClipboard(document.getElementById('mock-output').value);
  });
}

module.exports = { initMockTool };
