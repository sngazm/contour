// 平面波の和で作る連続地形。高さも勾配も解析的に求まるので、
// 坂の傾き（移動コスト）を正確に出せるのが利点。
// 仕上げに指数シェイピングをかけ、平地を広く・高所を稀で険しくする。
import { makeRng, TAU, clamp } from './util.js';

// 標高の縦方向スケール（ワールド単位）。斜め俯瞰の高さ表現に使う。
// 移動コストは勾配から直接計算するため、この値には依存しない。
export const HEIGHT_SCALE = 900;

// シェイピング指数（大きいほど高所が稀＆険しく、平地が広くなる）
const SHAPE = 2.5;

export function makeTerrain(seed) {
  const rng = makeRng(seed);
  const waves = [];
  const octaves = 7;
  let amp = 1;
  let total = 0;
  // 大きくゆるやかな起伏 → 細かいディテール、の順に重ねる。
  // 基本周波数を低めにして「峰の数」を減らす。
  for (let i = 0; i < octaves; i++) {
    const freq = 0.0026 * Math.pow(1.9, i);
    const ang = rng() * TAU;
    waves.push({
      kx: Math.cos(ang) * freq,
      ky: Math.sin(ang) * freq,
      amp,
      phase: rng() * TAU,
    });
    total += amp;
    amp *= 0.62;
  }
  const norm = 1 / total; // 生の高さを約 -1..1 に収める

  // 生地形と勾配をまとめて評価
  function evalRaw(x, y, out) {
    let h = 0;
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const p = w.kx * x + w.ky * y + w.phase;
      h += w.amp * Math.sin(p);
      const c = Math.cos(p) * w.amp;
      gx += w.kx * c;
      gy += w.ky * c;
    }
    out.h = h * norm;
    out.gx = gx * norm;
    out.gy = gy * norm;
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
