// 平面波の和で作る連続地形。高さも勾配も解析的に求まるので、
// 坂の傾き（移動コスト）を正確に出せるのが利点。
import { makeRng, TAU } from './util.js';

// 標高の縦方向スケール（ワールド単位）。傾斜計算と斜め俯瞰の高さに使う。
export const HEIGHT_SCALE = 520;

export function makeTerrain(seed) {
  const rng = makeRng(seed);
  const waves = [];
  const octaves = 7;
  let amp = 1;
  let total = 0;
  // 大きくゆるやかな起伏 → 細かいディテール、の順に重ねる
  for (let i = 0; i < octaves; i++) {
    const freq = 0.0042 * Math.pow(1.85, i);
    const ang = rng() * TAU;
    waves.push({
      kx: Math.cos(ang) * freq,
      ky: Math.sin(ang) * freq,
      amp,
      phase: rng() * TAU,
    });
    total += amp;
    amp *= 0.58;
  }
  const norm = 1 / total; // 高さを約 -1..1 に収める

  function height(x, y) {
    let h = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      h += w.amp * Math.sin(w.kx * x + w.ky * y + w.phase);
    }
    return h * norm;
  }

  // 勾配（標高単位/ワールド単位）。out{x,y} に書き込む。
  function gradient(x, y, out) {
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const c = Math.cos(w.kx * x + w.ky * y + w.phase) * w.amp;
      gx += w.kx * c;
      gy += w.ky * c;
    }
    out.x = gx * norm;
    out.y = gy * norm;
    return out;
  }

  return { height, gradient, seed };
}
