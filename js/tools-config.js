const TOOLS = [
  { id: 'generator', icon: '🔑', label: '生成器', shortcut: 'Ctrl+1' },
  { id: 'color', icon: '🎨', label: '颜色工具', shortcut: 'Ctrl+2' },
  { id: 'json', icon: '📄', label: 'JSON工具', shortcut: 'Ctrl+3' },
  { id: 'crypto', icon: '🔐', label: '加密工具', shortcut: 'Ctrl+4' },
  { id: 'code', icon: '💻', label: '代码工具', shortcut: 'Ctrl+5' },
  { id: 'http', icon: '🌐', label: 'HTTP工具', shortcut: 'Ctrl+6' },
  { id: 'regex', icon: '🔍', label: '正则工具', shortcut: 'Ctrl+7' },
  { id: 'time', icon: '⏰', label: '时间转换', shortcut: 'Ctrl+8' },
  { id: 'base', icon: '🔢', label: '进制转换', shortcut: 'Ctrl+9' },
  { id: 'image', icon: '🖼️', label: '图片工具', shortcut: 'Ctrl+0' },
  { id: 'qrcode', icon: '📱', label: '二维码' },
  { id: 'mock', icon: '📊', label: 'Mock工具' }
];

const SHORTCUT_MAP = {
  '1': 'generator',
  '2': 'color',
  '3': 'json',
  '4': 'crypto',
  '5': 'code',
  '6': 'http',
  '7': 'regex',
  '8': 'time',
  '9': 'base',
  '0': 'image'
};

const SCREENSHOT_SHORTCUT = 'Ctrl+Shift+Down';

module.exports = { TOOLS, SHORTCUT_MAP, SCREENSHOT_SHORTCUT };
