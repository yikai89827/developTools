// 新闻聚合数据获取模块（主进程）
// 每个源独立 fetch、独立容错；结果缓存到本地 JSON 文件，30 分钟内不重复请求

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CACHE_FILE = path.join(app.getPath('userData'), 'dev-tools-news.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

// API 凭证
const APIHZ_ID = '10017190';
const APIHZ_KEY = 'b79cd6a6906c0024a9cf48665ac78ae4';
const XXAPI_KEY = 'cd13f676ed795b9a';

// 所有请求带 User-Agent
const AXIOS_OPTS = {
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/xml, application/xml, */*',
  },
};

// ── xxapi.cn 统一请求 ──
async function fetchXxapi(endpoint) {
  const url = `https://v2.xxapi.cn/api/${endpoint}?key=${XXAPI_KEY}`;
  const resp = await axios.get(url, AXIOS_OPTS);
  const data = resp.data;
  if (data.code !== 200) throw new Error(data.msg || 'xxapi 返回错误');
  return data.data || [];
}

// 数据源配置
const SOURCES = [
  // ── 热搜榜 ──
  { id: 'baidu', name: '百度热榜', category: 'hot', type: 'xxapi', endpoint: 'baiduhot',
    mapFn: (it) => ({ title: it.title || '', url: it.url || '', hot: it.hot ? parseInt(String(it.hot).replace(/\D/g,''),10) : null }) },
  { id: 'weibo', name: '微博热搜', category: 'hot', type: 'apihz', api: 'xinwen/weibo.php' },
  { id: 'douyin', name: '抖音热榜', category: 'hot', type: 'xxapi', endpoint: 'douyinhot',
    mapFn: (it) => ({ title: it.word || '', url: `https://www.douyin.com/search/${encodeURIComponent(it.word||'')}`, hot: it.hot_value || null }) },
  { id: 'toutiao', name: '今日头条', category: 'hot', type: 'apihz', api: 'xinwen/toutiao.php' },
  { id: 'zhihu', name: '知乎热榜', category: 'hot', type: 'xxapi', endpoint: 'zhihuhot',
    mapFn: (it) => ({ title: it.title || '', url: it.url || '', hot: it.hot ? parseInt(String(it.hot).replace(/\D/g,''),10) : null }) },
  { id: 'bilibili', name: '哔哩哔哩', category: 'hot', type: 'xxapi', endpoint: 'bilibilihot',
    mapFn: (it, i) => {
      // bilibilihot 返回字符串数组
      const title = typeof it === 'string' ? it : (it.title || it.word || '');
      return { title, url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}`, hot: null };
    } },
  { id: 'csdn', name: 'CSDN', category: 'hot', type: 'xxapi', endpoint: 'csdnhot',
    mapFn: (it) => ({ title: it.title || '', url: it.url || '', hot: it.hot ? parseInt(String(it.hot).replace(/\D/g,''),10) : null }) },
  { id: 'maoyan', name: '猫眼票房', category: 'hot', type: 'apihz', api: 'bang/maoyan1.php',
    mapFn: (it) => ({ title: `${it.movieName || ''} (${it.sumBoxDesc || ''})`, url: `https://maoyan.com/films?movieName=${encodeURIComponent(it.movieName||'')}`, hot: null }) },
  // ── 科技新闻 ──
  { id: '36kr', name: '36氪热榜', category: 'tech', type: 'xxapi', endpoint: 'hot36kr',
    mapFn: (it) => ({ title: it.templateMaterial?.widgetTitle || '', url: it.itemId ? `https://36kr.com/p/${it.itemId}` : '', hot: it.templateMaterial?.statPraise || null }) },
  { id: 'hackernews', name: 'Hacker News', category: 'tech', type: 'hn' },
  { id: 'techcrunch', name: 'TechCrunch', category: 'tech', type: 'rss', url: 'https://techcrunch.com/feed/' },
  // ── 国际媒体 ──
  { id: 'guardian', name: 'The Guardian', category: 'world', type: 'rss', url: 'https://www.theguardian.com/world/rss' },
  { id: 'npr', name: 'NPR News', category: 'world', type: 'rss', url: 'https://feeds.npr.org/1001/rss.xml' },
  // ── 国内媒体 ──
  { id: 'xinhua', name: '新华社', category: 'china', type: 'rss', url: 'http://www.xinhuanet.com/politics/news_politics.xml' },
  { id: 'people', name: '人民网', category: 'china', type: 'rss', url: 'http://www.people.com.cn/rss/politics.xml' },
  // ── 政策动态 ──
  { id: 'gov_policy', name: '中央政策', category: 'policy', type: 'rss', url: 'http://www.people.com.cn/rss/politics.xml' },
];

function getSources() {
  return SOURCES;
}

// 去除 CDATA 包裹
function stripCDATA(s) {
  if (!s) return '';
  return s.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

// 简易 RSS XML 解析
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;

  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
    const block = match[0];
    let title = '';
    let link = '';

    const tm = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) title = stripCDATA(tm[1]).trim();

    const lm1 = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const lm2 = block.match(/<link[^>]*href="([^"]*)"/i);
    if (lm1 && lm1[1].trim()) {
      link = stripCDATA(lm1[1]).trim();
    } else if (lm2) {
      link = lm2[1].trim();
    }

    if (title) {
      items.push({ title: decodeXmlEntities(title), url: link, hot: null });
    }
  }
  return items;
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c));
}

// ── apihz.cn API（微博/头条/猫眼）──
async function fetchApihz(apiPath, mapFn) {
  const url = `https://cn.apihz.cn/api/${apiPath}?id=${APIHZ_ID}&key=${APIHZ_KEY}`;
  const resp = await axios.get(url, AXIOS_OPTS);
  const data = resp.data;
  if (data.code !== 200) throw new Error(data.msg || 'apihz 返回错误');
  const arr = data.data || [];
  return arr.slice(0, 15).map((it, i) => {
    if (mapFn) return mapFn(it, i);
    return {
      title: it.title || '',
      url: it.scheme || it.url || '',
      hot: typeof it.desc_extr === 'number' ? it.desc_extr : (it.desc_extr ? parseInt(String(it.desc_extr).replace(/\D/g, ''), 10) || null : null),
    };
  });
}

// ── Hacker News 官方 API ──
async function fetchHackerNews() {
  const resp = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', { ...AXIOS_OPTS, timeout: 8000 });
  const ids = resp.data.slice(0, 15);
  const items = await Promise.all(ids.map(id =>
    axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { ...AXIOS_OPTS, timeout: 8000 })
      .then(r => ({ title: r.data.title, url: r.data.url || `https://news.ycombinator.com/item?id=${id}`, hot: r.data.score }))
      .catch(() => null)
  ));
  return items.filter(Boolean);
}

// fetch 单个源
async function fetchSource(source) {
  // apihz.cn 源
  if (source.type === 'apihz') {
    return await fetchApihz(source.api, source.mapFn);
  }

  // xxapi.cn 源
  if (source.type === 'xxapi') {
    const arr = await fetchXxapi(source.endpoint);
    return arr.slice(0, 15).map((it, i) => {
      if (source.mapFn) return source.mapFn(it, i);
      return { title: it.title || '', url: it.url || '', hot: null };
    });
  }

  // Hacker News
  if (source.type === 'hn') {
    return await fetchHackerNews();
  }

  // RSS
  if (source.type === 'rss') {
    const resp = await axios.get(source.url, { ...AXIOS_OPTS, responseType: 'text' });
    return parseRSS(resp.data);
  }

  return [];
}

// 并发获取所有新闻
async function fetchAllNews(force = false) {
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

function getCachedNews() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp < CACHE_TTL) return data;
    return null;
  } catch {
    return null;
  }
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[news] 保存缓存失败:', e.message);
  }
}

module.exports = { getSources, fetchAllNews, fetchSingleSource, getCachedNews, SOURCES };
