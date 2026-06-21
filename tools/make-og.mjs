// OGP画像(1200x630)を生成する。実際の地形(src/terrain.js)を等高線＋高度カラーで円窓に描き、
// TOPOPO ロゴを添える。ブラウザ不要：Node の zlib で PNG を手書きエンコード。
//   node tools/make-og.mjs   → ルートに ogp.png を出力
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { makeTerrain } from '../src/terrain.js';

const W = 1200, H = 630;
const PAPER = [245, 244, 239];
const INK = [38, 37, 31];
const ALT_C = [[198, 172, 116], [156, 176, 92], [86, 138, 74], [124, 142, 156], [238, 238, 232]];
const ALT_TH = [0.10, 0.18, 0.30, 0.46];
const STEP = 0.03;
const altColor = (h) => h < ALT_TH[0] ? ALT_C[0] : h < ALT_TH[1] ? ALT_C[1] : h < ALT_TH[2] ? ALT_C[2] : h < ALT_TH[3] ? ALT_C[3] : ALT_C[4];

function runSeed(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return h >>> 0;
}

const terrain = makeTerrain(runSeed(7));

// 見栄えのする峰を中心に据える（粗く最大を探す）
let best = { x: 0, y: 0, h: -1 };
for (let y = -700; y <= 700; y += 35) for (let x = -700; x <= 700; x += 35) {
  const h = terrain.height(x, y); if (h > best.h) best = { x, y, h };
}
const camX = best.x, camY = best.y;

// 円窓
const cxC = 392, cyC = 315, RR = 268;
const viewWorld = 470, ppu = RR / viewWorld;

const buf = Buffer.alloc(W * H * 3);
const put = (x, y, c, a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  buf[o] = c[0] * a + buf[o] * (1 - a);
  buf[o + 1] = c[1] * a + buf[o + 1] * (1 - a);
  buf[o + 2] = c[2] * a + buf[o + 2] * (1 - a);
};
// 背景=紙
for (let i = 0; i < W * H; i++) { buf[i * 3] = PAPER[0]; buf[i * 3 + 1] = PAPER[1]; buf[i * 3 + 2] = PAPER[2]; }

// 円窓内の高さを先に計算（等高線のエッジ検出に隣接が要る）
const x0 = cxC - RR - 1, x1 = cxC + RR + 1, y0 = cyC - RR - 1, y1 = cyC + RR + 1;
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const hg = new Float32Array(bw * bh);
const wAt = (px, py) => [camX + (px - cxC) / ppu, camY + (py - cyC) / ppu];
for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
  const [wx, wy] = wAt(px, py);
  hg[(py - y0) * bw + (px - x0)] = terrain.height(wx, wy);
}
const bandOf = (px, py) => Math.floor(hg[(py - y0) * bw + (px - x0)] / STEP);

// 円窓を塗る：高度カラー＋等高線
for (let py = cyC - RR; py <= cyC + RR; py++) {
  for (let px = cxC - RR; px <= cxC + RR; px++) {
    const dx = px - cxC, dy = py - cyC, d = Math.hypot(dx, dy);
    if (d > RR) continue;
    const h = hg[(py - y0) * bw + (px - x0)];
    let c = altColor(h).slice();
    const b = bandOf(px, py);
    const major = (b % 5 === 0);
    if (b !== bandOf(px + 1, py) || b !== bandOf(px, py + 1)) {
      const k = major ? 0.42 : 0.62; // 等高線（主曲線は濃く）
      c = [c[0] * k, c[1] * k, c[2] * k];
    }
    // 縁を少し沈めてレンズ感
    if (d > RR - 26) { const t = (d - (RR - 26)) / 26; c = [c[0] * (1 - 0.18 * t), c[1] * (1 - 0.18 * t), c[2] * (1 - 0.18 * t)]; }
    put(px, py, c);
  }
}
// 円の縁
for (let a = 0; a < 6.2832; a += 0.0009) {
  for (let r = RR - 1.5; r <= RR + 1.5; r += 0.5) put(Math.round(cxC + Math.cos(a) * r), Math.round(cyC + Math.sin(a) * r), [60, 58, 52]);
}
// 中央のプレイヤー（白丸＋黒点）
for (let py = -16; py <= 16; py++) for (let px = -16; px <= 16; px++) {
  const d = Math.hypot(px, py);
  if (d <= 13) put(cxC + px, cyC + py, [247, 246, 242]);
}
for (let py = -7; py <= 7; py++) for (let px = -7; px <= 7; px++) {
  if (Math.hypot(px, py) <= 6.5) put(cxC + px, cyC + py, INK);
}

// --- TOPOPO ロゴ（モノスペース風の角ばった字）---
const rect = (ax, ay, bx, by, c) => { for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) put(x | 0, y | 0, c); };
function glyph(ch, lx, ly, cw, chh, th, c) {
  if (ch === 'T') { rect(lx, ly, lx + cw, ly + th, c); rect(lx + (cw - th) / 2, ly, lx + (cw + th) / 2, ly + chh, c); }
  else if (ch === 'O') { rect(lx, ly, lx + cw, ly + th, c); rect(lx, ly + chh - th, lx + cw, ly + chh, c); rect(lx, ly, lx + th, ly + chh, c); rect(lx + cw - th, ly, lx + cw, ly + chh, c); }
  else if (ch === 'P') { rect(lx, ly, lx + th, ly + chh, c); rect(lx, ly, lx + cw, ly + th, c); rect(lx, ly + (chh - th) / 2, lx + cw, ly + (chh + th) / 2, c); rect(lx + cw - th, ly, lx + cw, ly + (chh + th) / 2, c); }
}
const word = 'TOPOPO', cw = 70, chh = 104, th = 18, gap = 16;
const totalW = word.length * cw + (word.length - 1) * gap;
let lx = 760 - 0; // 右側に配置
// 右側の使える幅(720..1140)に収まるよう中央寄せ
const zoneL = 712, zoneR = 1148;
lx = (zoneL + zoneR) / 2 - totalW / 2;
const ly = cyC - chh / 2 - 18;
for (let i = 0; i < word.length; i++) glyph(word[i], lx + i * (cw + gap), ly, cw, chh, th, INK);
// サブのアクセント線＋小さなマーク
rect(lx, ly + chh + 22, lx + totalW, ly + chh + 26, [224, 81, 46]);

// --- PNG エンコード ---
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; buf.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3); }
const idat = deflateSync(raw, { level: 9 });

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../ogp.png', import.meta.url), png);
console.log('wrote ogp.png', W + 'x' + H, (png.length / 1024).toFixed(1) + 'KB');
