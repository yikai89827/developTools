const { ipcRenderer } = require('electron');
const { KEY_ROWS } = require('./js/pet/keymap');

const stage = document.querySelector('.stage');
const dog = document.getElementById('dog');
const armLeft = document.getElementById('arm-left');
const armRight = document.getElementById('arm-right');
const armMouse = document.getElementById('arm-mouse');
const keyboard = document.getElementById('keyboard');
const desk = document.getElementById('desk');
const pawLeft = document.getElementById('paw-left');
const pawRight = document.getElementById('paw-right');
const pawMouse = document.getElementById('paw-mouse');
const mouseLeft = document.getElementById('mouse-left');
const mouseRight = document.getElementById('mouse-right');
const mouseDevice = document.getElementById('mouse-device');
const head = document.querySelector('.head');
const pupils = document.querySelectorAll('.pupil');

const byVk = new Map();
let homeLeft = null;
let homeRight = null;

KEY_ROWS.forEach((row) => {
  const line = document.createElement('div');
  line.className = 'row';
  row.forEach((key) => {
    const el = document.createElement('div');
    el.className = 'key';
    el.textContent = key.label;
    el.style.flexGrow = String(key.grow || 1);
    el.dataset.hand = key.hand;
    line.appendChild(el);
    if (!byVk.has(key.vk)) byVk.set(key.vk, []);
    byVk.get(key.vk).push({ el, hand: key.hand });
    if (key.home === 'left') homeLeft = el;
    if (key.home === 'right') homeRight = el;
  });
  keyboard.appendChild(line);
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function drawLeg(path, fromX, fromY, toX, toY) {
  const bendX = fromX + (toX - fromX) * 0.42;
  const bendY = fromY + Math.max(12, (toY - fromY) * 0.28);
  path.setAttribute('d', `M ${fromX} ${fromY} Q ${bendX} ${bendY} ${toX} ${toY}`);
}

function placePaw(paw, el, pressed, side) {
  if (!el) return;
  const stageBox = stage.getBoundingClientRect();
  const deskBox = desk.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const bias = el.dataset.hand === 'both' ? (side === 'left' ? -box.width * 0.22 : box.width * 0.22) : 0;
  const x = box.left - deskBox.left + box.width / 2 + bias;
  const y = box.top - deskBox.top + box.height / 2 + (pressed ? 3 : 0);
  paw.style.left = `${x}px`;
  paw.style.top = `${y}px`;
  paw.classList.toggle('down', pressed);

  const dogBox = dog.getBoundingClientRect();
  const shoulderX = dogBox.left - stageBox.left + dogBox.width * (side === 'left' ? 0.32 : 0.68);
  const shoulderY = dogBox.top - stageBox.top + dogBox.height * 0.8;
  drawLeg(
    side === 'left' ? armLeft : armRight,
    shoulderX,
    shoulderY,
    deskBox.left - stageBox.left + x,
    deskBox.top - stageBox.top + y
  );
}

function restMouseLeg() {
  const stageBox = stage.getBoundingClientRect();
  const deskBox = desk.getBoundingClientRect();
  const dogBox = dog.getBoundingClientRect();
  const x = dogBox.left - deskBox.left + dogBox.width * 0.72;
  const y = dogBox.top - deskBox.top + dogBox.height * 0.9;
  pawMouse.style.left = `${x}px`;
  pawMouse.style.top = `${y}px`;
  pawMouse.classList.remove('down');
  drawLeg(
    armMouse,
    dogBox.left - stageBox.left + dogBox.width * 0.7,
    dogBox.top - stageBox.top + dogBox.height * 0.74,
    deskBox.left - stageBox.left + x,
    deskBox.top - stageBox.top + y
  );
}

function reachMouse(button) {
  const stageBox = stage.getBoundingClientRect();
  const deskBox = desk.getBoundingClientRect();
  const dogBox = dog.getBoundingClientRect();
  const box = button.getBoundingClientRect();
  const x = box.left - deskBox.left + box.width / 2;
  const y = box.top - deskBox.top + box.height / 2 + 3;
  pawMouse.style.left = `${x}px`;
  pawMouse.style.top = `${y}px`;
  pawMouse.classList.add('down');
  drawLeg(
    armMouse,
    dogBox.left - stageBox.left + dogBox.width * 0.7,
    dogBox.top - stageBox.top + dogBox.height * 0.74,
    deskBox.left - stageBox.left + x,
    deskBox.top - stageBox.top + y
  );
}

function targetFor(hand, recent) {
  for (const vk of recent) {
    const matches = byVk.get(vk) || [];
    const found = matches.find((item) => item.hand === hand || item.hand === 'both');
    if (found) return found.el;
  }
  return hand === 'left' ? homeLeft : homeRight;
}

function markKeys(down) {
  const active = new Set(down);
  byVk.forEach((items, vk) => {
    const on = active.has(vk);
    items.forEach((item) => item.el.classList.toggle('down', on));
  });
}

ipcRenderer.on('pet-input', (event, state) => {
  if (state.error) return;
  const down = state.keys || [];
  const recent = state.recent || down;

  markKeys(down);
  dog.classList.toggle('typing', !!state.anyKey);
  placePaw(pawLeft, targetFor('left', recent), recent.some((vk) => (byVk.get(vk) || []).some((item) => item.hand === 'left' || item.hand === 'both')), 'left');
  placePaw(pawRight, targetFor('right', recent), recent.some((vk) => (byVk.get(vk) || []).some((item) => item.hand === 'right' || item.hand === 'both')), 'right');

  const clickLeft = !!state.mouseLeft;
  const clickRight = !!state.mouseRight;
  mouseLeft.classList.toggle('down', clickLeft);
  mouseRight.classList.toggle('down', clickRight);
  if (clickLeft || clickRight) reachMouse(clickRight ? mouseRight : mouseLeft);
  else restMouseLeg();

  const nx = clamp(state.relX || 0, -1, 1);
  const ny = clamp(state.relY || 0, -1, 1);
  head.style.transform = `translate(${nx * 3}px, ${ny * 2}px) rotate(${nx * 3}deg)`;
  pupils.forEach((pupil) => {
    pupil.style.transform = `translate(${nx * 2.5}px, ${ny * 1.6}px)`;
  });
  mouseDevice.style.transform = `translate(${nx * 3}px, ${ny * 2}px)`;
});

window.addEventListener('resize', () => {
  placePaw(pawLeft, homeLeft, false, 'left');
  placePaw(pawRight, homeRight, false, 'right');
  restMouseLeg();
});

requestAnimationFrame(() => restMouseLeg());
