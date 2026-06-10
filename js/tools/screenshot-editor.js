class ScreenshotEditor {
  constructor(canvas, wrap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrap = wrap;
    this.image = new Image();
    this.mode = 'rect';
    this.shapes = [];
    this.drawing = false;
    this.startX = 0;
    this.startY = 0;
    this.scale = 1;
    this.activeInput = null;

    this._onMouseDown = this.onMouseDown.bind(this);
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onMouseUp = this.onMouseUp.bind(this);

    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('mouseleave', this._onMouseUp);
  }

  setMode(mode) {
    this.mode = mode;
    this.removeActiveInput();
    this.canvas.style.cursor = mode === 'text' ? 'text' : 'crosshair';
  }

  removeActiveInput() {
    if (this.activeInput) {
      this.activeInput.remove();
      this.activeInput = null;
    }
  }

  load(dataUrl) {
    return new Promise((resolve, reject) => {
      this.shapes = [];
      this.removeActiveInput();
      this.image.onload = () => {
        const maxW = this.wrap.clientWidth || 800;
        const maxH = Math.max(300, window.innerHeight * 0.5);
        this.scale = Math.min(1, maxW / this.image.width, maxH / this.image.height);
        this.canvas.width = Math.round(this.image.width * this.scale);
        this.canvas.height = Math.round(this.image.height * this.scale);
        this.redraw();
        resolve();
      };
      this.image.onerror = reject;
      this.image.src = dataUrl;
    });
  }

  redraw(previewRect) {
    const { ctx, canvas, image, shapes } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    shapes.forEach(shape => this.drawShape(shape));
    if (previewRect) this.drawRect(previewRect, true);
  }

  drawShape(shape) {
    if (shape.type === 'rect') this.drawRect(shape, false);
    else if (shape.type === 'text') this.drawText(shape);
  }

  drawRect(rect, preview) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = '#ff4d4f';
    ctx.lineWidth = 2;
    ctx.setLineDash(preview ? [6, 4] : []);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  drawText(shape) {
    const { ctx } = this;
    ctx.save();
    ctx.font = `${shape.fontSize || 16}px sans-serif`;
    ctx.fillStyle = shape.color || '#ff4d4f';
    ctx.textBaseline = 'top';
    ctx.fillText(shape.text, shape.x, shape.y);
    ctx.restore();
  }

  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  onMouseDown(e) {
    if (!this.image.src) return;

    if (this.mode === 'text') {
      e.preventDefault();
      const pos = this.getPos(e);
      setTimeout(() => this.addTextAt(e.clientX, e.clientY, pos.x, pos.y), 0);
      return;
    }

    const pos = this.getPos(e);
    this.drawing = true;
    this.startX = pos.x;
    this.startY = pos.y;
  }

  onMouseMove(e) {
    if (!this.drawing || this.mode !== 'rect') return;
    const pos = this.getPos(e);
    const x = Math.min(this.startX, pos.x);
    const y = Math.min(this.startY, pos.y);
    const w = Math.abs(pos.x - this.startX);
    const h = Math.abs(pos.y - this.startY);
    this.redraw({ x, y, w, h });
  }

  onMouseUp(e) {
    if (!this.drawing || this.mode !== 'rect') return;
    this.drawing = false;
    const pos = this.getPos(e);
    const x = Math.min(this.startX, pos.x);
    const y = Math.min(this.startY, pos.y);
    const w = Math.abs(pos.x - this.startX);
    const h = Math.abs(pos.y - this.startY);
    if (w >= 4 && h >= 4) {
      this.shapes.push({ type: 'rect', x, y, w, h });
    }
    this.redraw();
  }

  addTextAt(clientX, clientY, canvasX, canvasY) {
    this.removeActiveInput();

    const wrapRect = this.wrap.getBoundingClientRect();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'screenshot-text-input';
    input.placeholder = '输入文字，Enter 确认';
    input.style.left = `${clientX - wrapRect.left}px`;
    input.style.top = `${clientY - wrapRect.top}px`;

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const text = input.value.trim();
      if (text) {
        this.shapes.push({ type: 'text', x: canvasX, y: canvasY, text, fontSize: 16, color: '#ff4d4f' });
        this.redraw();
      }
      this.removeActiveInput();
    };

    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      } else if (ev.key === 'Escape') {
        committed = true;
        this.removeActiveInput();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(commit, 120);
    });

    this.wrap.appendChild(input);
    this.activeInput = input;
    input.focus();
  }

  undo() {
    this.removeActiveInput();
    this.shapes.pop();
    this.redraw();
  }

  clear() {
    this.removeActiveInput();
    this.shapes = [];
    this.redraw();
  }

  toDataURL() {
    if (!this.image.src) return '';
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.image.width;
    exportCanvas.height = this.image.height;
    const ctx = exportCanvas.getContext('2d');
    ctx.drawImage(this.image, 0, 0);

    const ratio = 1 / this.scale;
    this.shapes.forEach(shape => {
      if (shape.type === 'rect') {
        ctx.strokeStyle = '#ff4d4f';
        ctx.lineWidth = 2 * ratio;
        ctx.strokeRect(shape.x * ratio, shape.y * ratio, shape.w * ratio, shape.h * ratio);
      } else if (shape.type === 'text') {
        ctx.font = `${(shape.fontSize || 16) * ratio}px sans-serif`;
        ctx.fillStyle = shape.color || '#ff4d4f';
        ctx.textBaseline = 'top';
        ctx.fillText(shape.text, shape.x * ratio, shape.y * ratio);
      }
    });

    return exportCanvas.toDataURL('image/png');
  }
}

module.exports = { ScreenshotEditor };
