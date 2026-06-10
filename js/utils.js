function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
}

function initTabs(panelSelector) {
  const panel = document.querySelector(panelSelector);
  if (!panel) return;

  panel.querySelectorAll('.tool-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      const content = panel.querySelector(`#${CSS.escape(tabId)}`);
      if (!content) return;

      panel.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      content.classList.add('active');
    });
  });
}

function compareObjects(obj1, obj2, path = '') {
  const diff = {};
  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;

    if (!(key in obj1)) {
      diff[currentPath] = { type: 'added', value: obj2[key] };
    } else if (!(key in obj2)) {
      diff[currentPath] = { type: 'removed', value: obj1[key] };
    } else if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
      const nestedDiff = compareObjects(obj1[key], obj2[key], currentPath);
      if (Object.keys(nestedDiff).length > 0) {
        Object.assign(diff, nestedDiff);
      }
    } else if (obj1[key] !== obj2[key]) {
      diff[currentPath] = { type: 'changed', from: obj1[key], to: obj2[key] };
    }
  }

  return diff;
}

module.exports = { copyToClipboard, initTabs, compareObjects };
