// OGP画像(1200x630)を生成。実地形(src/terrain.js)を円窓に等高線＋高度カラーで描き、
// ゲームと同じモノスペース系フォントで TOPOPO ロゴを添える。
//   node tools/make-og.mjs   → ルートに ogp.png を出力
import { writeFileSync, existsSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { makeTerrain } from '../src/terrain.js';

// ゲームのフォントスタック(ui-monospace/SF Mono/Menlo)に近い、クリーンなモノスペースを使う
const FONT_CANDIDATES = [
  '/mnt/skills/examples/canvas-design/canvas-fonts/IBMPlexMono-Bold.ttf',
  '/mnt/skills/examples/canvas-design/canvas-fonts/JetBrainsMono-Bold.ttf',
];
let FONT = 'DejaVu Sans Mono';
for (const p of FONT_CANDIDATES) { if (existsSync(p)) { GlobalFonts.registerFromPath(p, 'OGMono'); FONT = 'OGMono'; break; } }

const W = 1200, H = 630;
const PAPER = [245, 244, 239], INK = [38, 37, 31], ACCENT = '#e0512e';
const ALT_C = [[198, 172, 116], [156, 176, 92], [86, 138, 74], [124, 142, 156], [238, 238, 232]];
const ALT_TH = [0.10, 0.18, 0.30, 0.46];
const STEP = 0.03;
const altColor = (h) => h < ALT_TH[0] ? ALT_C[0] : h < ALT_TH[1] ? ALT_C[1] : h < ALT_TH[2] ? ALT_C[2] : h < ALT_TH[3] ? ALT_C[3] : ALT_C[4];
function runSeed(n) { let h = Math.imul(n ^ 0x9e3779b9, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return h >>> 0; }

const terrain = makeTerrain(runSeed(7));
let best = { x: 0, y: 0, h: -1 };
for (let y = -700; y <= 700; y += 35) for (let x = -700; x <= 700; x += 35) { const h = terrain.height(x, y); if (h > best.h) best = { x, y, h }; }
const camX = best.x, camY = best.y;

const cxC = 392, cyC = 315, RR = 268;
const viewWorld = 470, ppu = RR / viewWorld;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = `rgb(${PAPER})`; ctx.fillRect(0, 0, W, H);

// 円窓の地形（高さgrid→高度カラー＋等高線）をImageDataで描く
const img = ctx.createImageData(W, H);
const D = img.data;
for (let i = 0; i < W * H; i++) { D[i * 4] = PAPER[0]; D[i * 4 + 1] = PAPER[1]; D[i * 4 + 2] = PAPER[2]; D[i * 4 + 3] = 255; }
const hAt = (px, py) => terrain.height(camX + (px - cxC) / ppu, camY + (py - cyC) / ppu);
const x0 = cxC - RR - 1, x1 = cxC + RR + 1, y0 = cyC - RR - 1, y1 = cyC + RR + 1;
const bw = x1 - x0 + 1, hg = new Float32Array(bw * (y1 - y0 + 1));
for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) hg[(py - y0) * bw + (px - x0)] = hAt(px, py);
const band = (px, py) => Math.floor(hg[(py - y0) * bw + (px - x0)] / STEP);
for (let py = cyC - RR; py <= cyC + RR; py++) {
  for (let px = cxC - RR; px <= cxC + RR; px++) {
    const d = Math.hypot(px - cxC, py - cyC); if (d > RR) continue;
    let c = altColor(hg[(py - y0) * bw + (px - x0)]).slice();
    const b = band(px, py);
    if (b !== band(px + 1, py) || b !== band(px, py + 1)) { const k = (b % 5 === 0) ? 0.42 : 0.62; c = [c[0] * k, c[1] * k, c[2] * k]; }
    if (d > RR - 26) { const t = (d - (RR - 26)) / 26; c = [c[0] * (1 - 0.18 * t), c[1] * (1 - 0.18 * t), c[2] * (1 - 0.18 * t)]; }
    const o = (py * W + px) * 4; D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255;
  }
}
ctx.putImageData(img, 0, 0);

// 円の縁
ctx.strokeStyle = 'rgba(60,58,52,0.9)'; ctx.lineWidth = 3;
ctx.beginPath(); ctx.arc(cxC, cyC, RR, 0, Math.PI * 2); ctx.stroke();
// プレイヤー（白丸＋黒点）
ctx.fillStyle = 'rgb(247,246,242)'; ctx.beginPath(); ctx.arc(cxC, cyC, 13, 0, Math.PI * 2); ctx.fill();
ctx.fillStyle = `rgb(${INK})`; ctx.beginPath(); ctx.arc(cxC, cyC, 6.5, 0, Math.PI * 2); ctx.fill();

// TOPOPO ロゴ（ゲームと同系のモノスペース）
const zoneL = 700, zoneR = 1150, maxW = zoneR - zoneL - 24;
let size = 116;
ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
const ls = () => Math.round(size * 0.16);
const fit = () => { ctx.font = `700 ${size}px "${FONT}"`; if ('letterSpacing' in ctx) ctx.letterSpacing = ls() + 'px'; return ctx.measureText('TOPOPO').width + ls(); };
while (fit() > maxW && size > 40) size -= 2;
const tcx = (zoneL + zoneR) / 2, tcy = cyC - 14;
ctx.fillStyle = `rgb(${INK})`;
ctx.fillText('TOPOPO', tcx, tcy);
const tw = ctx.measureText('TOPOPO').width;
if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
// アクセント線
ctx.fillStyle = ACCENT;
ctx.fillRect(tcx - tw / 2, tcy + size * 0.62, tw, 5);

writeFileSync(new URL('../ogp.png', import.meta.url), canvas.toBuffer('image/png'));
console.log('wrote ogp.png', W + 'x' + H, 'font=' + FONT, 'size=' + size);
