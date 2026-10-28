const { allKeys } = require('./keymap');

const WATCH_KEYS = [...new Set(allKeys().map((key) => key.vk))];

function createInputPoller() {
  let timer = null;
  let api = null;
  let last = null;
  let held = new Set();
  let recent = [];
  const point = { x: 0, y: 0 };

  function loadApi() {
    if (process.platform !== 'win32') {
      throw new Error('桌面宠物输入同步目前仅支持 Windows');
    }
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    koffi.struct('POINT', { x: 'long', y: 'long' });
    return {
      getKey: user32.func('int16 __stdcall GetAsyncKeyState(int)'),
      getCursor: user32.func('int __stdcall GetCursorPos(_Out_ POINT *pos)')
    };
  }

  function read() {
    if (!api) api = loadApi();
    const down = [];
    for (const vk of WATCH_KEYS) {
      if ((api.getKey(vk) & 0x8000) !== 0) down.push(vk);
    }

    const downSet = new Set(down);
    down.forEach((vk) => {
      if (!held.has(vk)) recent.unshift(vk);
    });
    recent = recent.filter((vk) => downSet.has(vk));
    held = downSet;

    const mouseLeft = (api.getKey(0x01) & 0x8000) !== 0;
    const mouseRight = (api.getKey(0x02) & 0x8000) !== 0;
    api.getCursor(point);

    return {
      keys: down,
      recent,
      anyKey: down.length > 0,
      mouseLeft,
      mouseRight,
      x: point.x,
      y: point.y
    };
  }

  function changed(next) {
    if (!last) return true;
    if (last.keys.join(',') !== next.keys.join(',')) return true;
    if (last.mouseLeft !== next.mouseLeft || last.mouseRight !== next.mouseRight) return true;
    return Math.abs(last.x - next.x) > 8 || Math.abs(last.y - next.y) > 8;
  }

  return {
    start(onState) {
      if (timer) return;
      timer = setInterval(() => {
        try {
          const next = read();
          if (!changed(next)) return;
          last = next;
          onState(next);
        } catch (error) {
          onState({ error: error.message });
        }
      }, 16);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      last = null;
      held = new Set();
      recent = [];
    }
  };
}

module.exports = { createInputPoller };
