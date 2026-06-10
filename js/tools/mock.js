const { copyToClipboard, initTabs } = require('../utils');

function inferTypeFromKey(key) {
  const k = key.toLowerCase();
  if (/name|username|nickname|author|title/.test(k)) return 'name';
  if (/^age$|yearsold/.test(k)) return 'age';
  if (/email|mail/.test(k)) return 'email';
  if (/phone|mobile|tel/.test(k)) return 'phone';
  if (/address|addr|location/.test(k)) return 'address';
  if (/city/.test(k)) return 'city';
  if (/id$|userid|orderid|uuid/.test(k)) return 'id';
  if (/date|time|birthday|createdat|updatedat/.test(k)) return 'date';
  if (/^is[A-Z]|bool|enabled|active/.test(k)) return 'bool';
  if (/count|num|number|amount|price|total|score/.test(k)) return 'number';
  if (/desc|description|remark|content|text/.test(k)) return 'string';
  return 'string';
}

function generateMockValue(type) {
  const firstNames = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十'];
  const lastNames = ['伟', '强', '丽', '敏', '杰', '芳', '娜', '磊'];
  const cities = ['北京市', '上海市', '广州市', '深圳市', '杭州市', '成都市', '武汉市', '南京市'];
  const districts = ['朝阳区', '浦东新区', '天河区', '南山区', '西湖区', '高新区', '江汉区', '鼓楼区'];
  const streets = ['科技路', '创新大道', '文华街', '人民路', '中山路', '建设路', '和平路'];

  switch (type) {
    case 'name':
      return firstNames[Math.floor(Math.random() * firstNames.length)] +
             lastNames[Math.floor(Math.random() * lastNames.length)];
    case 'age':
      return Math.floor(Math.random() * 50) + 18;
    case 'email':
      return 'user' + Math.floor(Math.random() * 10000) + '@example.com';
    case 'phone':
      return '1' + ['3', '5', '7', '8', '9'][Math.floor(Math.random() * 5)] +
             Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
    case 'address':
      return cities[Math.floor(Math.random() * cities.length)] +
             districts[Math.floor(Math.random() * districts.length)] +
             streets[Math.floor(Math.random() * streets.length)] +
             (Math.floor(Math.random() * 200) + 1) + '号';
    case 'city':
      return cities[Math.floor(Math.random() * cities.length)];
    case 'id':
      return Math.floor(Math.random() * 100000);
    case 'date':
      return new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    case 'bool':
      return Math.random() > 0.5;
    case 'number':
      return Math.floor(Math.random() * 1000);
    case 'string':
      return '随机文本' + Math.floor(Math.random() * 1000);
    default:
      return generateMockValue(inferTypeFromKey(type)) || ('随机文本' + Math.floor(Math.random() * 1000));
  }
}

function resolveMockValue(key, value) {
  if (typeof value === 'string' && value.startsWith('@')) {
    return generateMockValue(value.slice(1));
  }
  if (value === '' || value === null) {
    return generateMockValue(inferTypeFromKey(key));
  }
  return value;
}

function generateMock(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => (typeof item === 'object' && item !== null ? generateMock(item) : item));
  }

  const result = {};
  for (const key in obj) {
    const value = obj[key];
    if (typeof value === 'object' && value !== null) {
      result[key] = generateMock(value);
    } else {
      result[key] = resolveMockValue(key, value);
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
