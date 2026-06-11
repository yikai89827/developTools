const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, pixels) {
  const chunks = [];
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  chunks.push(createChunk('IHDR', ihdrData));
  
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixel = pixels[idx];
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rawData[offset] = pixel[0];
      rawData[offset + 1] = pixel[1];
      rawData[offset + 2] = pixel[2];
      rawData[offset + 3] = pixel[3];
    }
  }
  
  const compressed = zlib.deflateSync(rawData);
  chunks.push(createChunk('IDAT', compressed));
  chunks.push(createChunk('IEND', Buffer.alloc(0)));
  
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([signature, ...chunks]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = [];
  
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  
  return crc ^ 0xFFFFFFFF;
}

const width = 24;
const height = 24;
const pixels = [];

const bgColor = [30, 40, 60, 255];
const lightningColor = [255, 200, 50, 255];

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    let isLightning = false;
    
    const cx = width / 2;
    const cy = height / 2;
    
    const leftSide = (x < cx && y > 4 && y < height - 4 && 
                      (x >= cx - 6 && x <= cx - 2) &&
                      (y >= 6 && y <= height - 6));
    
    const rightSide = (x >= cx && y > 4 && y < height - 4 &&
                       (x >= cx && x <= cx + 4) &&
                       ((y >= 8 && y <= 12) || (y >= 14 && y <= height - 6)));
    
    const bottomTip = (x >= cx - 1 && x <= cx + 2 && 
                       y >= height - 6 && y <= height - 3);
    
    isLightning = leftSide || rightSide || bottomTip;
    
    pixels.push(isLightning ? lightningColor : bgColor);
  }
}

const png = createPNG(width, height, pixels);
const outputPath = path.join(__dirname, '../build/icon.png');
fs.writeFileSync(outputPath, png);
console.log('Lightning icon generated at:', outputPath);
