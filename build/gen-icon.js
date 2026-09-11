// 生成多尺寸 ICO 文件：16, 32, 48, 256
// PNG-as-ICO 格式：将 PNG 数据嵌入 ICO 容器，Windows Vista+ 原生支持
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const srcPath = path.join(__dirname, 'icon.png');
const outPath = path.join(__dirname, 'icon.ico');

const SIZES = [16, 32, 48, 256];

function resizePng(srcPng, dstSize) {
  // 最近邻插值缩放（图标用最近邻避免模糊）
  const src = PNG.sync.read(srcPng);
  const dst = new PNG({ width: dstSize, height: dstSize });
  const xRatio = src.width / dstSize;
  const yRatio = src.height / dstSize;
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * xRatio));
      const sy = Math.min(src.height - 1, Math.floor(y * yRatio));
      const si = (sy * src.width + sx) << 2;
      const di = (y * dstSize + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return PNG.sync.write(dst);
}

function makeIco(pngBuffers) {
  const count = pngBuffers.length;
  // ICONDIR: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type = 1 (icon)
  header.writeUInt16LE(count, 4);  // image count

  // ICONDIRENTRY: 16 bytes each
  const entries = Buffer.alloc(16 * count);
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  for (let i = 0; i < count; i++) {
    const png = pngBuffers[i];
    const size = png.length;
    const entryOffset = 16 * i;
    const dim = SIZES[i];
    // 256 用 0 表示
    entries.writeUInt8(dim === 256 ? 0 : dim, entryOffset);
    entries.writeUInt8(dim === 256 ? 0 : dim, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2);  // color count (0 = 256+)
    entries.writeUInt8(0, entryOffset + 3);  // reserved
    entries.writeUInt16LE(1, entryOffset + 4);  // planes
    entries.writeUInt16LE(32, entryOffset + 6);  // bit count
    entries.writeUInt32LE(size, entryOffset + 8);  // bytes in res
    entries.writeUInt32LE(offset, entryOffset + 12);  // image offset
    offset += size;
  }

  return Buffer.concat([header, entries, ...pngBuffers]);
}

if (!fs.existsSync(srcPath)) {
  console.error('源文件不存在:', srcPath);
  process.exit(1);
}

const srcPng = fs.readFileSync(srcPath);

try {
  const pngBuffers = SIZES.map(size => resizePng(srcPng, size));
  const ico = makeIco(pngBuffers);
  fs.writeFileSync(outPath, ico);
  console.log(`生成成功: ${outPath}`);
  console.log(`尺寸: ${SIZES.join(', ')} 总大小: ${ico.length} 字节`);
} catch (err) {
  console.error('生成失败:', err.message);
  process.exit(1);
}
