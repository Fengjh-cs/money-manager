'use strict';

/**
 * 生成应用图标 build/icon.ico(蓝色账簿图案,多尺寸)。
 * 纯 Node 实现:手写 PNG 编码 + ICO 打包,无外部依赖。
 * 运行:node scripts/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- CRC32 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ---- PNG 编码(RGBA)----
function pngEncode(width, height, rgba) {
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // 滤波器类型 0(None)
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 图案(归一化坐标)----
const BLUE = [47, 111, 237, 255];
const DARKBLUE = [31, 86, 196, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function inRoundedRect(nx, ny, x0, y0, x1, y1, r) {
  if (nx < x0 || nx > x1 || ny < y0 || ny > y1) return false;
  const dx = Math.max(x0 + r - nx, nx - (x1 - r), 0);
  const dy = Math.max(y0 + r - ny, ny - (y1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}
function inRect(nx, ny, x0, y0, x1, y1) { return nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1; }

function renderIcon(S) {
  const px = Buffer.alloc(S * S * 4);
  const lines = [[0.33, 0.38], [0.48, 0.30], [0.63, 0.34]]; // [y, xLen] 账页横线
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x + 0.5) / S, ny = (y + 0.5) / S;
      let c = CLEAR;
      if (inRoundedRect(nx, ny, 0, 0, 1, 1, 0.19)) {
        if (inRect(nx, ny, 0.15, 0.22, 0.85, 0.78)) {         // 账簿
          if (inRect(nx, ny, 0.15, 0.22, 0.34, 0.78)) c = DARKBLUE; // 装订边
          else {
            c = WHITE;
            for (const [ly, lx] of lines) {
              if (ny >= ly && ny <= ly + 0.045 && nx >= 0.42 && nx <= 0.42 + lx) { c = BLUE; break; }
            }
          }
        } else c = BLUE;
      }
      const o = (y * S + x) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3];
    }
  }
  return px;
}

// ---- ICO 打包 ----
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type = icon
  header.writeUInt16LE(pngs.length, 4);
  const parts = [header];
  let offset = 6 + pngs.length * 16;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
    e.writeUInt16LE(1, 4);             // planes
    e.writeUInt16LE(32, 6);            // bpp
    e.writeUInt32LE(p.buffer.length, 8);
    e.writeUInt32LE(offset, 12);
    parts.push(e);
    offset += p.buffer.length;
  }
  for (const p of pngs) parts.push(p.buffer);
  return Buffer.concat(parts);
}

const sizes = [256, 128, 64, 32, 16];
const pngs = sizes.map(s => ({ size: s, buffer: pngEncode(s, s, renderIcon(s)) }));
const ico = packIco(pngs);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('已生成 build/icon.ico,大小', ico.length, '字节,含尺寸', sizes.join('/'));
