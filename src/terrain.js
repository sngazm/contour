// バリューノイズの多重合成(fBm)で作る連続地形。
// 各オクターブで座標を回転させ、格子・方向の偏り（縦横のひしゃげ）を消す。
// 高さも勾配も解析的に求まるので、坂の傾き（移動コスト）を正確に出せる。
import { makeRng, TAU, clamp } from './util.js';

// 標高の縦方向スケール（ワールド単位）。斜め俯瞰の高さ表現に使う。
export const HEIGHT_SCALE = 900;

// シェイピング指数（大きいほど高所が稀＆険しく、平地が広くなる）
const SHAPE = 2.5;

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const dfade = (t) => 30 * t * t * (t * (t - 2) + 1);

// 整数格子のハッシュ → [-1,1)
function vhash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

export function makeTerrain(seed) {
  const rng = makeRng(seed);
  const octaves = 6;
  const lacunarity = 2.0;
  const gain = 0.5;
  const waves = [];
  let freq = 1 / 620; // 最大スケール（ゆるい大起伏）
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const ang = rng() * TAU; // オクターブごとに座標を回転
    waves.push({
      freq,
      amp,
      cos: Math.cos(ang),
      sin: Math.sin(ang),
      seed: (seed + o * 1013904223) | 0,
    });
    total += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  const norm = 1 / total; // 生地形を約 -1..1 に収める

  // 生地形と勾配をまとめて評価（out に raw 値と d/dx, d/dy）
  function evalRaw(x, y, out) {
    let val = 0, dx = 0, dy = 0;
    for (let o = 0; o < waves.length; o++) {
      const w = waves[o];
      // 回転 → スケール
      const xr = x * w.cos - y * w.sin;
      const yr = x * w.sin + y * w.cos;
      const X = xr * w.freq, Y = yr * w.freq;
      const ix = Math.floor(X), iy = Math.floor(Y);
      const fx = X - ix, fy = Y - iy;
      const a = vhash(ix, iy, w.seed);
      const b = vhash(ix + 1, iy, w.seed);
      const c = vhash(ix, iy + 1, w.seed);
      const d = vhash(ix + 1, iy + 1, w.seed);
      const u = fade(fx), v = fade(fy);
      const i1 = a + u * (b - a);
      const i2 = c + u * (d - c);
      val += w.amp * (i1 + v * (i2 - i1));
      // ノイズの勾配（X,Y 空間）
      const gX = dfade(fx) * ((b - a) * (1 - v) + (d - c) * v);
      const gY = dfade(fy) * (i2 - i1);
      // X,Y → 回転前(xr,yr) は ×freq、さらに回転を戻して x,y へ
      const gxr = gX * w.freq, gyr = gY * w.freq;
      dx += w.amp * (gxr * w.cos + gyr * w.sin);
      dy += w.amp * (-gxr * w.sin + gyr * w.cos);
    }
    out.h = val * norm;
    out.gx = dx * norm;
    out.gy = dy * norm;
  }

  const tmp = { h: 0, gx: 0, gy: 0 };

  // シェイピング後の高さ（0..1）。0=最深部、1=最高峰。
  function height(x, y) {
    evalRaw(x, y, tmp);
    const t = clamp((tmp.h + 1) * 0.5, 0, 1);
    return Math.pow(t, SHAPE);
  }

  // シェイピング後の勾配（高さ0..1 / ワールド単位）。out{x,y} に書き込む。
  function gradient(x, y, out) {
    evalRaw(x, y, tmp);
    const t = clamp((tmp.h + 1) * 0.5, 0, 1);
    const d = SHAPE * Math.pow(t, SHAPE - 1) * 0.5; // d(height)/d(raw)
    out.x = d * tmp.gx;
    out.y = d * tmp.gy;
    return out;
  }

  return { height, gradient, seed };
}
