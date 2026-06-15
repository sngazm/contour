// 小さな汎用ユーティリティ。プロトタイプ間で共有する。

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

// イージング（終端で減速）
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// mulberry32: 軽量シード付き乱数
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 標高(-1..1)をその時々の色に。寒色の谷→暖色の頂。彩度は抑えめ。
const STOPS = [
  [0.0, [22, 33, 56]],   // 深い谷
  [0.32, [49, 74, 92]],
  [0.55, [104, 122, 110]],
  [0.74, [170, 158, 116]],
  [1.0, [233, 224, 196]], // 頂
];

export function elevColor(h) {
  // h: -1..1 -> t: 0..1
  const t = clamp((h + 1) * 0.5, 0, 1);
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const k = (t - t0) / (t1 - t0 || 1);
      return [
        Math.round(lerp(c0[0], c1[0], k)),
        Math.round(lerp(c0[1], c1[1], k)),
        Math.round(lerp(c0[2], c1[2], k)),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// 赤色立体図ふうの尾根谷ランプ。t:0=谷(暗赤)→1=尾根(白)。明度で尾根谷度を表す。
const RRIM = [
  [0.00, [92, 32, 28]],
  [0.30, [150, 58, 44]],
  [0.50, [196, 120, 96]],
  [0.72, [228, 188, 162]],
  [1.00, [250, 244, 238]],
];

export function rrim(t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < RRIM.length; i++) {
    if (x <= RRIM[i][0]) {
      const [t0, c0] = RRIM[i - 1];
      const [t1, c1] = RRIM[i];
      const k = (x - t0) / (t1 - t0 || 1);
      return [
        Math.round(lerp(c0[0], c1[0], k)),
        Math.round(lerp(c0[1], c1[1], k)),
        Math.round(lerp(c0[2], c1[2], k)),
      ];
    }
  }
  return RRIM[RRIM.length - 1][1];
}
