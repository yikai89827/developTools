const TOOLS = [
  { id: 'generator', icon: '🔑', label: '生成器', shortcut: 'Ctrl+1' },
  { id: 'recorder', icon: '📹', label: '屏幕录制', shortcut: 'Ctrl+2' },
  { id: 'baota', icon: '🖥️', label: '宝塔面板', shortcut: 'Ctrl+3' },
  { id: 'trending', icon: '🔥', label: 'GitHub趋势', shortcut: 'Ctrl+4' },
  { id: 'color', icon: '🎨', label: '颜色工具', shortcut: 'Ctrl+5' },
  { id: 'json', icon: '📄', label: 'JSON工具', shortcut: 'Ctrl+6' },
  { id: 'crypto', icon: '🔐', label: '加密工具', shortcut: 'Ctrl+7' },
  { id: 'code', icon: '💻', label: '代码工具', shortcut: 'Ctrl+8' },
  { id: 'http', icon: '🌐', label: 'HTTP工具', shortcut: 'Ctrl+9' },
  { id: 'regex', icon: '🔍', label: '正则工具', shortcut: 'Ctrl+0' },
  { id: 'time', icon: '⏰', label: '时间转换' },
  { id: 'base', icon: '🔢', label: '进制转换' },
  { id: 'image', icon: '🖼️', label: '图片工具' },
  { id: 'qrcode', icon: '📱', label: '二维码' },
  { id: 'mock', icon: '📊', label: 'Mock工具' },
  { id: 'pet', icon: '🐶', label: '桌面宠物' },
  { id: 'news', icon: '📰', label: '新闻聚合' },
  { id: 'clock', icon: '⏱️', label: '打卡提醒' },
  { id: 'git-cheatsheet', icon: '🐙', label: 'Git速查' },
  { id: 'algorithm', icon: '📊', label: '算法可视化' },
  { id: 'patterns', icon: '🧩', label: '设计模式' },
  { id: 'leetcode', icon: '📝', label: '每日10题' },
  { id: 'tech-daily', icon: '💡', label: '技术日报' }
];

const SHORTCUT_MAP = {
  '1': 'generator',
  '2': 'recorder',
  '3': 'baota',
  '4': 'trending',
  '5': 'color',
  '6': 'json',
  '7': 'crypto',
  '8': 'code',
  '9': 'http',
  '0': 'regex'
};

const SCREENSHOT_SHORTCUT = 'Ctrl+Down';

module.exports = { TOOLS, SHORTCUT_MAP, SCREENSHOT_SHORTCUT };
