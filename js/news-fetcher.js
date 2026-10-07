// 新闻聚合数据获取模块（主进程）
// 每个源独立 fetch、独立容错；结果缓存到本地 JSON 文件，30 分钟内不重复请求

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CACHE_FILE = path.join(app.getPath('userData'), 'dev-tools-news.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

// 数据源配置
const SOURCES = [
  // ── 聚合 API（vvhan）──
  { id: 'baidu', name: '百度热榜', category: 'hot', type: 'vvhan', endpoint: 'baidu' },
  { id: 'weibo', name: '微博热搜', category: 'hot', type: 'vvhan', endpoint: 'weibo' },
  { id: 'douyin', name: '抖音热榜', category: 'hot', type: 'vvhan', endpoint: 'douyin' },
  { id: 'zhihu', name: '知乎热榜', category: 'hot', type: 'vvhan', endpoint: 'zhihu' },
  { id: 'xiaohongshu', name: '小红书热门', category: 'hot', type: 'vvhan', endpoint: 'xiaohongshu' },
  { id: 'maoyan', name: '猫眼票房', category: 'hot', type: 'vvhan', endpoint: 'maoyan' },
  // ── 科技新闻（Hacker News 官方 API）──
  { id: 'hackernews', name: 'Hacker News', category: 'tech', type: 'hn' },
  // ── RSS 源 ──
  { id: 'bbc', name: 'BBC 头条', category: 'world', type: 'rss', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'reuters', name: 'Reuters', category: 'world', type: 'rss', url: 'https://www.reutersagency.com/feed/?best-topics=top-news' },
  { id: 'xinhua', name: '新华社', category: 'china', type: 'rss', url: 'https://www.xinhuanet.com/politics/news_politics.xml' },
  { id: 'people', name: '人民网', category: 'china', type: 'rss', url: 'http://www.people.com.cn/rss/politics.xml' },
  { id: 'gov_policy', name: '中央政策', category: 'policy', type: 'rss', url: 'https://rsshub.app/gov/china/policy' },
  { id: 'hunan_policy', name: '湖南省政策', category: 'policy', type: 'rss', url: 'https://rsshub.app/gov/hunan/policy' },
];

// 获取所有源配置
function getSources() {
  return SOURCES;
}

// 简易 RSS XML 解析（主进程无 DOMParser，用正则提取 item/title/link）
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const titleRegex = /<!\[CDATA\[([\s\S]*?)\]\]>|<title[^>]*>([\s\S]*?)<\/title>/i;
  const linkRegex = /<link[^>]*>([\s\S]*?)<\/link>|<link[^>]*href="([^"]*)"/i;

  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
    const block = match[0];
    let title = '';
    let link = '';

    const tm = block.match(titleRegex);
    if (tm) title = (tm[1] || tm[2] || '').trim();

    const lm = block.match(linkRegex);
    if (lm) link = (lm[1] || lm[2] || '').trim();

    if (title) {
      items.push({ title: decodeXmlEntities(title), url: link, hot: null });
    }
  }
  return items;
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// fetch 单个源
async function fetchSource(source) {
  const timeout = 10000;
  if (source.type === 'vvhan') {
    const resp = await axios.get(`https://api.vvhan.com/api/hotlist/${source.endpoint}`, { timeout });
    const data = resp.data;
    // vvhan 返回 { success, name, data: [{title, url, hot, ...}] } 或直接数组
    const arr = Array.isArray(data) ? data : (data.data || []);
    return arr.slice(0, 15).map(it => ({
      title: it.title || '',
      url: it.url || it.link || '',
      hot: it.hot || null,
    }));
  }

  if (source.type === 'hn') {
    const resp = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout });
    const ids = resp.data.slice(0, 15);
    const items = await Promise.all(ids.map(id =>
      axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 8000 })
        .then(r => ({ title: r.data.title, url: r.data.url || `https://news.ycombinator.com/item?id=${id}`, hot: r.data.score }))
        .catch(() => null)
    ));
    return items.filter(Boolean);
  }

  if (source.type === 'rss') {
    const resp = await axios.get(source.url, { timeout, responseType: 'text' });
    return parseRSS(resp.data);
  }

  return [];
}

// 并发获取所有新闻
async function fetchAllNews(force = false) {
  // 检查缓存
  if (!force) {
    const cached = getCachedNews();
    if (cached) return cached;
  }

  const results = {};
  await Promise.all(SOURCES.map(async (src) => {
    try {
      const items = await fetchSource(src);
      results[src.id] = { name: src.name, category: src.category, items, ok: true, error: null };
    } catch (err) {
      results[src.id] = { name: src.name, category: src.category, items: [], ok: false, error: err.message || '获取失败' };
    }
  }));

  const data = { timestamp: Date.now(), sources: results };
  saveCache(data);
  return data;
}

// 单源刷新
async function fetchSingleSource(sourceId) {
  const src = SOURCES.find(s => s.id === sourceId);
  if (!src) return null;
  try {
    const items = await fetchSource(src);
    return { id: sourceId, name: src.name, category: src.category, items, ok: true, error: null };
  } catch (err) {
    return { id: sourceId, name: src.name, category: src.category, items: [], ok: false, error: err.message || '获取失败' };
  }
}

// 读取缓存（未过期返回数据，否则 null）
function getCachedNews() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp < CACHE_TTL) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

// 保存缓存
function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[news] 保存缓存失败:', e.message);
  }
}

module.exports = { getSources, fetchAllNews, fetchSingleSource, getCachedNews, SOURCES };
