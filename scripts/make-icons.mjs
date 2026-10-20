// Рисует иконки приложения (PNG и SVG) без внешних библиотек: `npm run icons`.
// Рисунок: окно с тремя «потоками воздуха» на бирюзовом фоне.

import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const OUT = 'web/icons';
const BG_TOP = [20, 132, 120];
const BG_BOTTOM = [12, 92, 86];
const FG = [255, 255, 255];

// Фигуры в координатах 0..1. `inset` сжимает рисунок к центру (для maskable-иконки).
function shapes(inset) {
  const s = (v) => 0.5 + (v - 0.5) * inset;
  const bar = (y, x1, x2) => ({ y: s(y), x1: s(x1), x2: s(x2), r: 0.045 * inset });
  return [bar(0.36, 0.24, 0.70), bar(0.50, 0.30, 0.78), bar(0.64, 0.24, 0.62)];
}

function inBar(x, y, b) {
  const cx = Math.min(Math.max(x, b.x1), b.x2);
  return (x - cx) ** 2 + (y - b.y) ** 2 <= b.r ** 2;
}

function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
}

function render(size, { inset = 1, rounded = true } = {}) {
  const bars = shapes(inset);
  const ss = 4; // сглаживание: 4×4 выборки на пиксель
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (pxi + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (rounded && !inRoundedSquare(x, y, 0.22)) continue;
          bgHits++;
          if (bars.some((b) => inBar(x, y, b))) fgHits++;
        }
      }
      const n = ss * ss;
      const t = py / size;
      const bg = BG_TOP.map((c, i) => c + (BG_BOTTOM[i] - c) * t);
      const f = bgHits ? fgHits / bgHits : 0;
      const o = (py * size + pxi) * 4;
      for (let i = 0; i < 3; i++) px[o + i] = Math.round(bg[i] * (1 - f) + FG[i] * f);
      px[o + 3] = Math.round((bgHits / n) * 255);
    }
  }
  return encodePng(size, px);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // глубина цвета
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const bars = shapes(1)
    .map((b) => `<line x1="${b.x1 * 512}" y1="${b.y * 512}" x2="${b.x2 * 512}" y2="${b.y * 512}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${BG_TOP})"/><stop offset="1" stop-color="rgb(${BG_BOTTOM})"/></linearGradient></defs>
<rect width="512" height="512" rx="113" fill="url(#g)"/>
<g stroke="#fff" stroke-width="${0.09 * 512}" stroke-linecap="round">${bars}</g>
</svg>
`;
}

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/icon-192.png`, render(192));
await writeFile(`${OUT}/icon-512.png`, render(512));
// Maskable: Android сам обрежет форму, поэтому фон на весь квадрат, рисунок ближе к центру.
await writeFile(`${OUT}/icon-maskable-512.png`, render(512, { inset: 0.75, rounded: false }));
await writeFile(`${OUT}/icon.svg`, svg());
console.log('Иконки готовы');
