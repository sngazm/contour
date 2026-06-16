// プロトタイプ 01 — 等高線 / 円窓 / 斜面の重さ / 30秒後の俯瞰リプレイ
import { clamp, lerp, easeInOut, easeOut, TAU, rgba } from './util.js';
import { makeTerrain, HEIGHT_SCALE } from './terrain.js';
import { contourLevel, levelsFor } from './contours.js';
import { createInput } from './input.js';

const CFG = {
  // 体力制（時間制限の代わり）
  HP_WALK: 0.035,         // 平地を歩く消費(体力/秒)
  HP_CLIMB_K: 380,        // 登りで増える消費の強さ
  FALL_DAMAGE: 0.2,       // 転落1回のダメージ(発生時に一括・約20%)
  HEAL: 0.35,             // ドリンク1本の回復量
  HEALTH_LAG: 2.6,        // ダメージ/回復の追従(格ゲー風)速度
  RADAR_MIN: 480,         // 低地でのレーダー到達距離(高所ほど伸びる)
  VIEW_RADIUS_WORLD: 235, // 既定(最ズームイン)の視界半径
  ALWAYS_R: 80,           // 常に見える近距離バブル(これより外は視線遮蔽)
  ZOOM_MAX_R: 1500,       // ピンチアウトで見渡せる最大の視界半径
  GRID_N: 84,             // 等高線サンプルの格子解像度(ズームに依らず一定負荷)
  CONTOUR_STEP: 0.03,     // 等高線の間隔(高さ 0..1)
  LOS_CONTOURS: 3,        // 視線遮蔽のしきい: 自分の高さ + これ×等高線間隔まで見える
  VIEWSHED_RAYS: 96,      // 視線遮蔽を測る方角の数
  VIEWSHED_STEPS: 88,     // 1方角あたりの探索ステップ数
  BASE_SPEED: 100,        // 平地の移動速度(ワールド単位/秒)
  UPHILL_K: 400,          // 斜面が速度に効く強さ
  SPEED_MIN: 0.16,        // 急登での下限係数
  SPEED_MAX: 1.7,         // 下りでの上限係数
  PATH_MIN_STEP: 5,       // 軌跡を記録する最小移動距離
  FIELD_R: 1500,          // フィールド(ステージ)の半径。これが最高地点の探索範囲
  RADAR_COUNT: 5,         // レーダー（谷に多い）
  DRINK_COUNT: 5,         // ドリンク缶（体力回復・満遍なく）
  PICKUP_R: 30,           // アイテム取得の距離
  GLOVE_K_MUL: 0.34,      // グローブ装備時の登坂ペナルティ倍率
  GLOVE_MIN: 0.6,         // グローブ装備時の最低速度係数(急崖でも登れる)
  GLOVE_MAX: 1.12,        // グローブ装備時の最高速度(下りが軽快でなくなる=不便)
  ZIP_SPEED: 300,         // ジップライン移動の等速(ワールド単位/秒)
  ZIP_ARRIVE: 6,          // 到着判定の距離
  SLOPE_AVG_DIST: 45,     // 速度を決める傾斜の平均距離(進行方向の±これ)
  FALL_SLOPE: 0.0034,     // これより急で「登っていない」と滑り落ちる
  CLIMB_MAX: 0.0048,      // これより急だと押していても登れず転落
  FALL_RECOVER: 0.0022,   // これより緩くなれば踏ん張りを取り戻す
  FALL_ACCEL: 220000,     // 転落の加速(傾斜に比例)
  FALL_DRAG: 3,           // 転落の減衰(/秒)
  GLOVE_FALL_MUL: 2.6,    // グローブ装備で転落しにくくなる倍率
  NPC_COUNT: 0,           // NPCの数(0で無効。コードは残置)
  NPC_SPEED: 62,          // NPCの基礎速度(プレイヤーより遅い)
  NPC_AGGRO: 118,         // 索敵半径＝プレイヤー視界(235)の半分。先に気づかれにくい
  NPC_PUSH_R: 26,         // この距離で突き落とす
  NPC_PUSH_SPEED: 250,    // 突き落としの初速
  NPC_VISION_CONTOURS: 3, // NPCは自分より これ×等高線 以上高い地形の向こうが見えない
  NPC_CHASE_MEMORY: 0.8,  // 見失ってから追跡を続ける秒数
  PLAYER_CHARGE: 1.15,    // この速度係数以上で突っ込むと逆にNPCを突き落とせる
  NPC_SATISFIED: 4.5,     // 突き落とした後、満足して登りに戻る秒数(追跡しない)
  PUSH_GRACE: 1.3,        // 放心から復帰した直後、突かれない猶予秒数(ハメ防止)
  NPC_LOOK_R: 320,        // NPCが登り目標を探す範囲(広い範囲で登る)
  NPC_DOWN: 6,            // 撃破されたNPCの放心秒数(消えずに復帰)
};

const RV_BLUR = 12; // 尾根谷度の近傍半径(セル数。広いほどマダラが減る)
// 高度カラー(4色): 下から 青→緑→黄土→白。しきいは高さ0..1。
const ALT4 = [[58, 108, 162], [104, 156, 86], [184, 150, 78], [240, 238, 230]];
const ALT_TH = [0.15, 0.24, 0.35];

// ---- リザルト地形用 WebGL2 シェーダー（ピクセル単位で色帯＋等高線＋AA）----
const VERT_SRC = `#version 300 es
in vec2 aPos; in float aH; in float aRV;
uniform vec2 uCam, uYaw, uTilt, uOrigin, uView;
uniform float uScale, uZ, uDepth;
out float vH; out float vRV;
void main(){
  float X = aPos.x - uCam.x, Y = aPos.y - uCam.y;
  float rx = X*uYaw.x - Y*uYaw.y;
  float ry = X*uYaw.y + Y*uYaw.x;
  float Z = aH * uZ;
  float sx = uOrigin.x + rx*uScale;
  float sy = uOrigin.y + ry*uScale*uTilt.x - Z*uScale*uTilt.y;
  vH = aH; vRV = aRV;
  gl_Position = vec4(sx/uView.x*2.0 - 1.0, 1.0 - sy/uView.y*2.0, -ry*uDepth, 1.0);
}`;
const FRAG_SRC = `#version 300 es
precision highp float;
in float vH; in float vRV;
out vec4 frag;
uniform vec3 uC0, uC1, uC2, uC3, uTH;
uniform float uShadeLo, uShadeHi, uRvScale, uStep;
void main(){
  float h = vH;
  float w = fwidth(h);
  vec3 c = uC0;
  c = mix(c, uC1, smoothstep(uTH.x - w, uTH.x + w, h));
  c = mix(c, uC2, smoothstep(uTH.y - w, uTH.y + w, h));
  c = mix(c, uC3, smoothstep(uTH.z - w, uTH.z + w, h));
  float shade = uShadeLo + (uShadeHi - uShadeLo) * clamp(0.5 + vRV*uRvScale, 0.0, 1.0);
  c *= shade;
  float lp = fract(h / uStep);
  float dd = min(lp, 1.0 - lp) * uStep;
  float line = 1.0 - smoothstep(0.0, max(w, 1e-5) * 0.9, dd);
  c = mix(c, c * 0.5, line * 0.5);
  frag = vec4(c, 1.0);
}`;
// 経路用：スクリーン空間で一定幅に押し出す（角度に依らず太さ一定＝パイプ）。同じ深度で隠面。
const GLSL_PROJ = `
uniform vec2 uCam, uYaw, uTilt, uOrigin, uView;
uniform float uScale, uZ, uDepth, uHalfW;
vec3 proj(vec2 pw, float h){
  float X = pw.x - uCam.x, Y = pw.y - uCam.y;
  float rx = X*uYaw.x - Y*uYaw.y;
  float ry = X*uYaw.y + Y*uYaw.x;
  float Z = h * uZ;
  return vec3(uOrigin.x + rx*uScale, uOrigin.y + ry*uScale*uTilt.x - Z*uScale*uTilt.y, ry);
}`;
const VERT_LINE = `#version 300 es
in vec2 aPos; in float aH; in vec2 aPos2; in float aH2; in float aSide;
${GLSL_PROJ}
void main(){
  vec3 P = proj(aPos, aH), Q = proj(aPos2, aH2);
  vec2 d = Q.xy - P.xy; float L = length(d);
  vec2 nrm = L > 0.0001 ? vec2(-d.y, d.x) / L : vec2(0.0, 1.0);
  vec2 sp = P.xy + nrm * aSide * uHalfW;
  gl_Position = vec4(sp.x/uView.x*2.0 - 1.0, 1.0 - sp.y/uView.y*2.0, -P.z*uDepth, 1.0);
}`;
const FRAG_LINE = `#version 300 es
precision highp float; out vec4 frag; uniform vec4 uColor;
void main(){ frag = uColor; }`;
// 各頂点の円（ラウンド接合＋丸キャップ）
const VERT_DISC = `#version 300 es
in vec2 aPos; in float aH; in vec2 aCorner;
out vec2 vUV;
${GLSL_PROJ}
void main(){
  vec3 P = proj(aPos, aH);
  vec2 sp = P.xy + aCorner * uHalfW;
  vUV = aCorner;
  gl_Position = vec4(sp.x/uView.x*2.0 - 1.0, 1.0 - sp.y/uView.y*2.0, -P.z*uDepth, 1.0);
}`;
const FRAG_DISC = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag; uniform vec4 uColor;
void main(){ if (dot(vUV, vUV) > 1.0) discard; frag = uColor; }`;
function setupGL(gl) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const prog = (vsrc, fsrc) => {
    const vs = mk(gl.VERTEX_SHADER, vsrc), fs = mk(gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return null; }
    return p;
  };
  const pTerr = prog(VERT_SRC, FRAG_SRC), pLine = prog(VERT_LINE, FRAG_LINE), pDisc = prog(VERT_DISC, FRAG_DISC);
  if (!pTerr || !pLine || !pDisc) return null;
  const tf = (n) => gl.getUniformLocation(pTerr, n);
  const lf = (n) => gl.getUniformLocation(pLine, n);
  const df = (n) => gl.getUniformLocation(pDisc, n);
  const TUN = ['cam', 'yaw', 'tilt', 'origin', 'view', 'scale', 'z', 'depth'];
  const xform = (fn) => { const o = {}; for (const n of TUN) o[n] = fn('u' + n[0].toUpperCase() + n.slice(1)); return o; };
  return {
    vbo: gl.createBuffer(), ibo: gl.createBuffer(), pbo: gl.createBuffer(), dbo: gl.createBuffer(),
    gpbo: gl.createBuffer(), gdbo: gl.createBuffer(), // ゴースト用（リボン/円）
    terr: {
      prog: pTerr,
      aPos: gl.getAttribLocation(pTerr, 'aPos'), aH: gl.getAttribLocation(pTerr, 'aH'), aRV: gl.getAttribLocation(pTerr, 'aRV'),
      u: Object.assign(xform(tf), {
        c0: tf('uC0'), c1: tf('uC1'), c2: tf('uC2'), c3: tf('uC3'), th: tf('uTH'),
        shadeLo: tf('uShadeLo'), shadeHi: tf('uShadeHi'), rvScale: tf('uRvScale'), step: tf('uStep'),
      }),
    },
    line: {
      prog: pLine,
      aPos: gl.getAttribLocation(pLine, 'aPos'), aH: gl.getAttribLocation(pLine, 'aH'),
      aPos2: gl.getAttribLocation(pLine, 'aPos2'), aH2: gl.getAttribLocation(pLine, 'aH2'), aSide: gl.getAttribLocation(pLine, 'aSide'),
      u: Object.assign(xform(lf), { color: lf('uColor'), halfW: lf('uHalfW') }),
    },
    disc: {
      prog: pDisc,
      aPos: gl.getAttribLocation(pDisc, 'aPos'), aH: gl.getAttribLocation(pDisc, 'aH'), aCorner: gl.getAttribLocation(pDisc, 'aCorner'),
      u: Object.assign(xform(df), { color: df('uColor'), halfW: df('uHalfW') }),
    },
  };
}
const SHADE_LO = 0.68; // 谷の暗さ
const SHADE_HI = 1.16; // 尾根の明るさ

// ラン番号 → 地形シード（全クライアントで決定的＝同じNラン目は同じ地形）
function runSeed(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return h >>> 0;
}

// NPCを撒く（開始地点から離して散らす）
function spawnNpcs(R) {
  const list = [];
  for (let i = 0; i < CFG.NPC_COUNT; i++) {
    const a = Math.random() * TAU;
    const r = 260 + Math.random() * (R - 320);
    list.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, chaseT: 0, satT: 0, down: 0, goal: null, goalT: 0, dx: 0, dy: 0, fvx: 0, fvy: 0 });
  }
  return list;
}

// セパラブルなボックスぼかし（src→dst、tmp は作業用）
function boxBlur(src, nx, ny, rb, tmp, dst) {
  const w = 2 * rb + 1;
  for (let j = 0; j < ny; j++) {
    let sum = 0;
    for (let i = -rb; i <= rb; i++) sum += src[j * nx + clamp(i, 0, nx - 1)];
    for (let i = 0; i < nx; i++) {
      tmp[j * nx + i] = sum / w;
      sum += src[j * nx + clamp(i + rb + 1, 0, nx - 1)] - src[j * nx + clamp(i - rb, 0, nx - 1)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let sum = 0;
    for (let j = -rb; j <= rb; j++) sum += tmp[clamp(j, 0, ny - 1) * nx + i];
    for (let j = 0; j < ny; j++) {
      dst[j * nx + i] = sum / w;
      sum += tmp[clamp(j + rb + 1, 0, ny - 1) * nx + i] - tmp[clamp(j - rb, 0, ny - 1) * nx + i];
    }
  }
}

// 高度を読みやすい整数に
const altOf = (h) => Math.round(h * 1000);
const VERSION = 'v49'; // タイトル脇に表示（凍結時に各版の番号が残る）

// 白ベースの配色
const COL = {
  out: '#e7e6e0',       // 円窓の外
  lens: '#f7f6f2',      // 円窓の中
  paper: '#f5f4ef',     // リザルトの地
  ink: 'rgba(40,39,35,0.55)',
  inkMajor: 'rgba(26,25,22,0.9)',
  edge: 'rgba(40,39,35,0.5)',
  accent: '#e0512e',    // 軌跡・到達点
  peak: '#c8920a',      // フィールド最高地点
  item: '#1f8a8a',      // レーダー
  drink: '#2a7fd0',     // ドリンク缶（回復）
  heal: '#3a90e0',      // 回復の青
  dmg: '#d8392f',       // ダメージの赤
};

// 散布。レーダーは谷(尾根谷度↓)に寄せる。ドリンクは満遍なく。
function spawnPickups(terrain, R) {
  const list = [];
  const rvAt = (x, y) => {
    const h = terrain.height(x, y);
    const s = terrain.height(x + 120, y) + terrain.height(x - 120, y) + terrain.height(x, y + 120) + terrain.height(x, y - 120);
    return h - s / 4; // 谷で負, 尾根で正
  };
  const rnd = () => { const a = Math.random() * TAU, rr = 240 + Math.random() * (R - 300); return { x: Math.cos(a) * rr, y: Math.sin(a) * rr }; };
  const place = (type, mode) => {
    let best = rnd();
    if (mode !== 'any') {
      let bs = mode === 'valley' ? Infinity : -Infinity;
      for (let k = 0; k < 12; k++) { const p = rnd(); const s = rvAt(p.x, p.y); if (mode === 'valley' ? s < bs : s > bs) { bs = s; best = p; } }
    }
    list.push({ x: best.x, y: best.y, type, taken: false });
  };
  for (let i = 0; i < CFG.RADAR_COUNT; i++) place('radar', 'valley');
  for (let i = 0; i < CFG.DRINK_COUNT; i++) place('drink', 'any');
  return list;
}

// アイテムのアイコン（中心 x,y / 半径 s）。token=外枠の輪も描く。
function drawItemGlyph(ctx, x, y, type, s, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, s * 0.16);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (type === 'radar') {
    // バッテリー（電池）
    const w = s * 0.6, h = s * 0.92;
    ctx.strokeRect(x - w, y - h, w * 2, h * 2);
    ctx.fillRect(x - w * 0.45, y - h - s * 0.18, w * 0.9, s * 0.18); // 端子
    ctx.fillRect(x - w * 0.6, y - h * 0.15, w * 1.2, h * 0.55);      // 充電バー
  } else if (type === 'drink') {
    // 酸素ボンベ（丸頭のシリンダー＋バルブ）
    const w = s * 0.5, h = s * 0.98;
    ctx.beginPath();
    ctx.moveTo(x - w, y + h);
    ctx.lineTo(x - w, y - h + w);
    ctx.quadraticCurveTo(x - w, y - h, x, y - h);
    ctx.quadraticCurveTo(x + w, y - h, x + w, y - h + w);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(x - s * 0.12, y - h - s * 0.24, s * 0.24, s * 0.28); // バルブ
  } else if (type === 'glove') {
    // 二段のシェブロン（登る／上へ）
    for (let k = 0; k < 2; k++) {
      const o = -s * 0.5 + k * s * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y + o + s * 0.35);
      ctx.lineTo(x, y + o - s * 0.1);
      ctx.lineTo(x + s * 0.5, y + o + s * 0.35);
      ctx.stroke();
    }
  } else if (type === 'goggle') {
    // 双眼のゴーグル
    const r = s * 0.34;
    ctx.beginPath(); ctx.arc(x - r * 1.05, y, r, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + r * 1.05, y, r, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.1, y); ctx.lineTo(x + r * 0.1, y); ctx.stroke();
  } else {
    // ジップライン：斜めのワイヤーと滑車
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y - s * 0.55);
    ctx.lineTo(x + s * 0.6, y + s * 0.55);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, s * 0.26, 0, TAU); ctx.fill();
  }
}

// フィールド内の最高地点を探す（粗いグリッド → 勾配上昇で微調整）
function findFieldMax(terrain, R) {
  let best = { x: 0, y: 0, h: -1 };
  const N = 72;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -R + (2 * R) * (i / (N - 1));
      const y = -R + (2 * R) * (j / (N - 1));
      if (x * x + y * y > R * R) continue;
      const h = terrain.height(x, y);
      if (h > best.h) best = { x, y, h };
    }
  }
  const g = { x: 0, y: 0 };
  let x = best.x, y = best.y;
  let step = (2 * R) / (N - 1);
  for (let it = 0; it < 60; it++) {
    terrain.gradient(x, y, g);
    const m = Math.hypot(g.x, g.y) || 1;
    const nx = x + (g.x / m) * step;
    const ny = y + (g.y / m) * step;
    if (nx * nx + ny * ny <= R * R) {
      const nh = terrain.height(nx, ny);
      if (nh > best.h) { best = { x: nx, y: ny, h: nh }; x = nx; y = ny; continue; }
    }
    step *= 0.6;
    if (step < 0.4) break;
  }
  return best;
}

export function start(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const input = createInput(canvas);
  const grid = new Float32Array(96 * 96); // ワールド固定格子の作業領域
  const gridB = new Float32Array(96 * 96); // ぼかし
  const gridT = new Float32Array(96 * 96); // ぼかし作業用
  const gridRV = new Float32Array(96 * 96); // 尾根谷度
  const grad = { x: 0, y: 0 };
  const shadeCanvas = document.createElement('canvas'); // 段彩/立体図用オフスクリーン
  const shadeCtx = shadeCanvas.getContext('2d');
  const fillPX = new Float32Array(120 * 120); // リザルト塗りの頂点投影バッファ
  const fillPY = new Float32Array(120 * 120);
  const fillPD = new Float32Array(120 * 120);
  const glCanvas = document.createElement('canvas'); // リザルト地形の WebGL 描画先
  const gl = glCanvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  const glR = gl ? setupGL(gl) : null;

  let game;
  // リザルトのカメラ操作（1本指=orbit / 2本指=ズーム / タップ=再挑戦）
  const endPointers = new Map();
  let endGesture = null;
  let pinchPrev = 0;
  let playTap = null; // プレイ中の中央タップ（旗を立てて終了）判定
  const endPinchDist = () => {
    const v = [...endPointers.values()];
    return v.length < 2 ? 0 : Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
  };

  // 右下の旗ボタン。押すとその場に旗を立てて即終了。最高点付近では強調(.hot)。
  const viewBtn = document.getElementById('viewbtn');
  const ICON_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4.5h11l-2.6 3.3L17 11H6"/></svg>';
  if (viewBtn) {
    viewBtn.innerHTML = ICON_FLAG;
    viewBtn.addEventListener('click', () => {
      if (game.state === 'play') { game.flagged = true; beginEnd(); }
    });
  }

  function newGame() {
    // ラン回数をブラウザに記録。Nラン目は全員同じ地形 → 足跡が噛み合う
    let runNumber = 1;
    try {
      runNumber = (parseInt(localStorage.getItem('topopo_run') || '0', 10) || 0) + 1;
      localStorage.setItem('topopo_run', String(runNumber));
    } catch (_) { /* localStorage不可でも続行 */ }
    const terrain = makeTerrain(runSeed(runNumber));
    game = {
      terrain,
      runNumber,
      ghosts: [],                   // 他プレイヤーの足跡（非同期で読み込む）
      field: { r: CFG.FIELD_R, max: findFieldMax(terrain, CFG.FIELD_R) },
      state: 'ready',
      time: 0,
      health: 1,            // 体力(0で終了)
      healthLag: 1,         // 表示の追従値(格ゲー風のダメージ/回復)
      drainRate: 0,         // 現在の消費ペース(リング色用)
      far: false,                   // レーダー偵察中(ズームアウト)か
      viewR: CFG.VIEW_RADIUS_WORLD, // 現在の視界半径(補間用)
      px: 0, py: 0,
      best: terrain.height(0, 0), // 到達した最高高度（自己記録＝スコア）
      flash: 0,                   // 記録更新の演出(HUDの数字)
      flagged: false,             // 中央タップで旗を立てて終了したか
      radar: 0,             // レーダー所持数(1回ぶんのズームアウト)
      radarFlies: [],       // レーダー取得演出（左下ボタンへ飛ぶ）
      marks: [],            // 取得/偵察した地点 {x,y,h,type}（リザルト表示用）
      pickups: spawnPickups(terrain, CFG.FIELD_R),
      npcs: spawnNpcs(CFG.FIELD_R),
      riding: null,         // ジップライン移動中の目標 {tx,ty}
      fall: null,           // 転落中の速度 {vx,vy,t}（操作不能）
      stun: 0,              // 転落後の放心時間(操作不能)
      stunMax: 0,
      grace: 0,             // 復帰直後の無敵(突かれない)時間
      curSpeed: 0,          // 現在の速度係数(描画の線長に使用)
      moveDir: { x: 0, y: 0 },
      path: [{ x: 0, y: 0, h: terrain.height(0, 0) }],
      readyPulse: 0,
      end: null,
    };
    input.state.everPressed = false;
    input.state.zoomReq = 0;
    endPointers.clear();
    endGesture = null;
    if (viewBtn) { viewBtn.style.display = 'none'; viewBtn.classList.remove('hot'); }
    fetchGhosts(runNumber);
  }

  // 他プレイヤーの足跡を取得（同シード=同じラン番号）。失敗は無視。範囲外データは除外。
  function fetchGhosts(runNumber) {
    const lim = CFG.FIELD_R * 1.4;
    const ok = (r) => Array.isArray(r.path) && r.path.length > 1 &&
      r.path.every((p) => Math.abs(p[0]) < lim && Math.abs(p[1]) < lim);
    fetch('/api/runs?seed=' + runNumber)
      .then((r) => (r.ok ? r.json() : []))
      .then((runs) => { if (game && game.runNumber === runNumber && Array.isArray(runs)) game.ghosts = runs.filter(ok); })
      .catch(() => {});
  }

  // 自分のランを送信（軌跡を間引いて）。失敗は無視。
  function postRun() {
    const g = game;
    const max = 48, step = Math.max(1, Math.ceil(g.path.length / max)), path = [];
    for (let i = 0; i < g.path.length; i += step) path.push([Math.round(g.path[i].x), Math.round(g.path[i].y), +g.path[i].h.toFixed(3)]);
    const last = g.path[g.path.length - 1];
    path.push([Math.round(last.x), Math.round(last.y), +last.h.toFixed(3)]);
    try {
      fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed: g.runNumber, path, best: altOf(g.best), flagged: g.flagged }),
      }).catch(() => {});
    } catch (_) {}
  }
  newGame();

  // 画面座標→ワールド座標（プレイ中ビュー）
  function screenToWorld(sx, sy) {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const R = Math.min(window.innerWidth, window.innerHeight) * 0.46;
    const NORMAL = CFG.VIEW_RADIUS_WORLD;
    const blend = clamp((game.viewR - NORMAL) / (CFG.ZOOM_MAX_R - NORMAL), 0, 1);
    const camx = lerp(game.px, 0, blend), camy = lerp(game.py, 0, blend);
    const frameR = lerp(NORMAL, CFG.FIELD_R * 1.07, blend);
    const ppu = R / frameR;
    return { x: camx + (sx - cx) / ppu, y: camy + (sy - cy) / ppu };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'end') {
      playTap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      return;
    }
    endPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (endPointers.size === 1) {
      endGesture = { t0: performance.now(), moved: false, lastX: e.clientX, lastY: e.clientY, vyaw: 0 };
    } else if (endPointers.size === 2) {
      if (endGesture) endGesture.moved = true;
      pinchPrev = endPinchDist();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (game.state !== 'end') {
      if (playTap && Math.hypot(e.clientX - playTap.x, e.clientY - playTap.y) > 8) playTap.moved = true;
      return;
    }
    if (!endPointers.has(e.pointerId)) return;
    endPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cam = game.end.cam;
    if (endPointers.size >= 2) {
      const d = endPinchDist();
      if (pinchPrev > 0 && d > 0) cam.zoom = clamp(cam.zoom * (d / pinchPrev), 0.6, 2.4);
      pinchPrev = d;
      if (endGesture) endGesture.moved = true;
    } else if (endGesture) {
      const dx = e.clientX - endGesture.lastX, dy = e.clientY - endGesture.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 4) endGesture.moved = true;
      const dyaw = -dx * 0.006;
      cam.yaw += dyaw; cam.yawVel = 0; endGesture.vyaw = dyaw;
      cam.tiltOff = clamp(cam.tiltOff - dy * 0.004, -0.45, 0.5);
      cam.touched = true;
      endGesture.lastX = e.clientX; endGesture.lastY = e.clientY;
    }
  });
  // 左下レーダーボタンの画面上の位置（描画とタップで共有）
  const radarBtnPos = () => ({ x: 42, y: window.innerHeight - 60, r: 24 });
  window.addEventListener('pointerup', () => {
    // プレイ中：左下のレーダーボタンを短くタップ＝偵察（所持時）
    if (game.state === 'play' && !game.far && game.radar > 0 && playTap && !playTap.moved &&
        performance.now() - playTap.t < 300) {
      const r = canvas.getBoundingClientRect();
      const b = radarBtnPos();
      if (Math.hypot((playTap.x - r.left) - b.x, (playTap.y - r.top) - b.y) < b.r + 6) {
        game.far = true; game.radar -= 1;
        game.marks.push({ x: game.px, y: game.py, h: game.terrain.height(game.px, game.py), type: 'scan' });
      }
    }
    playTap = null;
  });
  window.addEventListener('pointerup', (e) => {
    if (game.state !== 'end' || !endPointers.has(e.pointerId)) return;
    endPointers.delete(e.pointerId);
    if (endPointers.size === 0) {
      if (endGesture && !endGesture.moved && performance.now() - endGesture.t0 < 350 && game.end.t > 2.2) newGame();
      else if (endGesture) game.end.cam.yawVel = (endGesture.vyaw || 0) * 16; // フリック慣性
      endGesture = null;
    } else if (endPointers.size === 1) {
      const rem = [...endPointers.values()][0];
      if (endGesture) { endGesture.lastX = rem.x; endGesture.lastY = rem.y; }
      pinchPrev = 0;
    }
  });
  // PCのホイールでリザルトをズーム
  canvas.addEventListener('wheel', (e) => {
    if (game.state !== 'end') return;
    e.preventDefault();
    game.end.cam.zoom = clamp(game.end.cam.zoom * Math.exp(-e.deltaY * 0.0015), 0.6, 2.4);
  }, { passive: false });

  // ---- 更新 ----------------------------------------------------------------
  function update(dt) {
    const g = game;
    if (g.state === 'ready' || g.state === 'play') {
      input.consumeZoomReq(); // ピンチ/ホイールのズームは使わない(レーダー制)
      if (g.far && input.read().mag > 0) g.far = false; // 動き出したら偵察解除
      const target = g.far ? CFG.ZOOM_MAX_R : CFG.VIEW_RADIUS_WORLD;
      g.viewR += (target - g.viewR) * Math.min(1, dt * 8);
      // 旗ボタン：プレイ中は常時表示。最高点付近(=記録が目標に肉薄)で強調
      if (viewBtn) {
        viewBtn.style.display = g.state === 'play' ? '' : 'none';
        const nearTop = g.terrain.height(g.px, g.py) >= g.field.max.h - 1.5 * CFG.CONTOUR_STEP;
        viewBtn.classList.toggle('hot', g.state === 'play' && nearTop);
      }
    }
    if (g.state === 'ready') {
      g.readyPulse += dt;
      if (input.read().mag > 0) g.state = 'play';
      return;
    }
    if (g.state === 'play') {
      g.time += dt;
      const hNow = g.terrain.height(g.px, g.py);
      if (hNow > g.best) { g.best = hNow; g.flash = 0.7; } // 自己記録更新＝達成
      if (g.flash > 0) g.flash -= dt;
      if (g.grace > 0) g.grace -= dt;
      for (const fl of g.radarFlies) fl.t += dt / 0.5; // 0.5秒で着地
      if (g.radarFlies.some((f) => f.t >= 1)) g.radarFlies = g.radarFlies.filter((f) => f.t < 1);
      let moved = false;
      g.curSpeed = 0;
      let drain = 0; // この瞬間の体力消費ペース(体力/秒)
      if (g.riding) {
        // ジップライン：等速で目標へ（地形を無視）
        const dx = g.riding.tx - g.px, dy = g.riding.ty - g.py;
        const d = Math.hypot(dx, dy);
        const step = CFG.ZIP_SPEED * dt;
        if (d > 0) { g.moveDir.x = dx / d; g.moveDir.y = dy / d; }
        if (d <= CFG.ZIP_ARRIVE || d <= step) { g.px = g.riding.tx; g.py = g.riding.ty; g.riding = null; }
        else { g.px += (dx / d) * step; g.py += (dy / d) * step; }
        g.curSpeed = CFG.ZIP_SPEED / CFG.BASE_SPEED; // 速い＝最長
        drain = CFG.HP_WALK * 0.6; // 滑空は軽い消費
        moved = true;
      } else if (g.fall) {
        // 転落中：操作不能。下り方向(=勾配の逆)へ加速しながら滑り落ちる
        g.fall.t += dt;
        g.terrain.gradient(g.px, g.py, grad);
        const steep = Math.hypot(grad.x, grad.y);
        if (steep > 1e-6) {
          const a = CFG.FALL_ACCEL * steep * dt;
          g.fall.vx += (-grad.x / steep) * a;
          g.fall.vy += (-grad.y / steep) * a;
        }
        g.fall.vx -= g.fall.vx * CFG.FALL_DRAG * dt;
        g.fall.vy -= g.fall.vy * CFG.FALL_DRAG * dt;
        g.px += g.fall.vx * dt;
        g.py += g.fall.vy * dt;
        const spd = Math.hypot(g.fall.vx, g.fall.vy);
        if (spd > 1e-4) { g.moveDir.x = g.fall.vx / spd; g.moveDir.y = g.fall.vy / spd; }
        g.curSpeed = spd / CFG.BASE_SPEED;
        if (steep < CFG.FALL_RECOVER && spd < 70) {
          // 緩斜面で停止 → 落下時間に応じて放心(1〜3秒)
          g.stun = clamp(g.fall.t * 1.3, 1, 3);
          g.stunMax = g.stun;
          g.fall = null;
        }
        moved = true;
      } else if (g.stun > 0) {
        // 放心：操作不能でその場に。復帰時に無敵猶予を付与（ハメ防止）
        g.stun -= dt;
        if (g.stun <= 0) g.grace = CFG.PUSH_GRACE;
      } else {
        const mv = input.read();
        // 転落判定：急すぎる／急斜面で登っていない なら転がり落ちる
        g.terrain.gradient(g.px, g.py, grad);
        const steep = Math.hypot(grad.x, grad.y);
        const fallS = CFG.FALL_SLOPE, climbMax = CFG.CLIMB_MAX;
        const climbing = mv.mag > 0.25 && (grad.x * mv.x + grad.y * mv.y) > 0; // 上りへ踏ん張る
        if (steep > climbMax || (steep > fallS && !climbing)) {
          g.fall = { vx: 0, vy: 0, t: 0 };
          g.health = clamp(g.health - CFG.FALL_DAMAGE, 0, 1); // 転落ダメージ(約20%)
          moved = true;
        } else if (mv.mag > 0) {
          // 進行方向の±一定距離の平均勾配（瞬間の凹凸でガタつかせない）
          const D = CFG.SLOPE_AVG_DIST;
          const hA = g.terrain.height(g.px + mv.x * D, g.py + mv.y * D);
          const hB = g.terrain.height(g.px - mv.x * D, g.py - mv.y * D);
          const along = (hA - hB) / (2 * D); // +で登り
          const f = clamp(1 - along * CFG.UPHILL_K, CFG.SPEED_MIN, CFG.SPEED_MAX);
          const sp = CFG.BASE_SPEED * f * mv.mag * dt;
          g.px += mv.x * sp;
          g.py += mv.y * sp;
          g.moveDir.x = mv.x; g.moveDir.y = mv.y;
          g.curSpeed = f * mv.mag; // 実際の速度係数
          drain = CFG.HP_WALK * mv.mag * (1 + Math.max(0, along) * CFG.HP_CLIMB_K); // 登りほど消費
          moved = true;
        }
      }
      if (moved) {
        const d = Math.hypot(g.px, g.py); // フィールド外には出られない
        if (d > g.field.r) { g.px *= g.field.r / d; g.py *= g.field.r / d; }
        const last = g.path[g.path.length - 1];
        if (Math.hypot(g.px - last.x, g.py - last.y) >= CFG.PATH_MIN_STEP) {
          g.path.push({ x: g.px, y: g.py, h: g.terrain.height(g.px, g.py) });
        }
        // アイテム取得（レーダー）
        for (const it of g.pickups) {
          if (!it.taken && Math.hypot(g.px - it.x, g.py - it.y) < CFG.PICKUP_R) {
            it.taken = true;
            g.marks.push({ x: it.x, y: it.y, h: g.terrain.height(it.x, it.y), type: it.type });
            if (it.type === 'radar') { g.radar += 1; g.radarFlies.push({ t: 0 }); } // 左下へ飛ぶ演出
            else if (it.type === 'drink') g.health = Math.min(1, g.health + CFG.HEAL); // 回復
          }
        }
      }
      // 体力の消費/回復と追従表示（格ゲー風）
      g.drainRate = drain;
      g.health = clamp(g.health - drain * dt, 0, 1);
      g.healthLag += (g.health - g.healthLag) * Math.min(1, dt * CFG.HEALTH_LAG);
      if (g.health <= 0) { beginEnd(); return; }
      // NPC：広い範囲で高い所へ登る／プレイヤーが見えて近いと追跡し突き落とす
      let anyPush = false;
      const playerH = g.terrain.height(g.px, g.py);
      for (const n of g.npcs) {
        if (n.down > 0) {
          // 撃破され転落中：操作不能でクルクル回りながら自然に滑り落ちる
          n.down -= dt;
          g.terrain.gradient(n.x, n.y, grad);
          const st = Math.hypot(grad.x, grad.y);
          if (st > 1e-6) { const a = CFG.FALL_ACCEL * st * dt; n.fvx += (-grad.x / st) * a; n.fvy += (-grad.y / st) * a; }
          n.fvx -= n.fvx * CFG.FALL_DRAG * dt; n.fvy -= n.fvy * CFG.FALL_DRAG * dt;
          n.x += n.fvx * dt; n.y += n.fvy * dt;
          const nd2 = Math.hypot(n.x, n.y);
          if (nd2 > g.field.r) { n.x *= g.field.r / nd2; n.y *= g.field.r / nd2; n.fvx *= 0.3; n.fvy *= 0.3; }
          continue;
        }
        const dpx = g.px - n.x, dpy = g.py - n.y;
        const dp = Math.hypot(dpx, dpy);
        if (n.satT > 0) n.satT -= dt;
        // 視線：自分の標高±3等高線の範囲だけ見える（高い尾根に遮られる／低地は見えない）
        let sees = false;
        if (n.satT <= 0 && dp < CFG.NPC_AGGRO && dp > 1e-3) {
          const npcH = g.terrain.height(n.x, n.y);
          const band = CFG.NPC_VISION_CONTOURS * CFG.CONTOUR_STEP;
          if (playerH >= npcH - band) { // 自分より3等高線以上低い所は見えない
            const thr = npcH + band;     // 3等高線以上高い地形の向こうも見えない
            const ux = dpx / dp, uy = dpy / dp, lim = dp * 0.85;
            sees = true;
            for (let s = 1; s <= 12; s++) {
              if (g.terrain.height(n.x + ux * (lim * s / 12), n.y + uy * (lim * s / 12)) > thr) { sees = false; break; }
            }
          }
        }
        if (sees) n.chaseT = CFG.NPC_CHASE_MEMORY; else if (n.chaseT > 0) n.chaseT -= dt;
        const chasing = n.chaseT > 0;

        let dirx = 0, diry = 0;
        if (chasing && dp > 1e-3) {
          dirx = dpx / dp; diry = dpy / dp;
        } else {
          // 広い範囲を見渡して、より高い地点を目標に登る（局所に留まらない）
          n.goalT -= dt;
          if (!n.goal || n.goalT <= 0 || Math.hypot(n.goal.x - n.x, n.goal.y - n.y) < 30) {
            const R = CFG.NPC_LOOK_R;
            let best = { x: n.x, y: n.y, h: g.terrain.height(n.x, n.y) }, found = false;
            for (let a = 0; a < 8; a++) {
              const th = (a / 8) * TAU;
              for (const rr of [R * 0.6, R]) {
                const qx = n.x + Math.cos(th) * rr, qy = n.y + Math.sin(th) * rr;
                const h = g.terrain.height(qx, qy);
                if (h > best.h) { best = { x: qx, y: qy, h }; found = true; }
              }
            }
            if (!found) { const th = Math.random() * TAU; best = { x: n.x + Math.cos(th) * R, y: n.y + Math.sin(th) * R }; }
            n.goal = { x: best.x, y: best.y };
            n.goalT = 2.5 + Math.random() * 2;
          }
          const gx2 = n.goal.x - n.x, gy2 = n.goal.y - n.y, gd = Math.hypot(gx2, gy2);
          if (gd > 1e-3) { dirx = gx2 / gd; diry = gy2 / gd; }
        }
        g.terrain.gradient(n.x, n.y, grad);
        const along = grad.x * dirx + grad.y * diry;
        const f = clamp(1 - along * CFG.UPHILL_K, 0.3, 1.4);
        const sp = CFG.NPC_SPEED * f * dt;
        n.x += dirx * sp; n.y += diry * sp;
        if (dirx || diry) { n.dx = dirx; n.dy = diry; } // 進行方向を保持(描画用)
        const nd = Math.hypot(n.x, n.y);
        if (nd > g.field.r) { n.x *= g.field.r / nd; n.y *= g.field.r / nd; }
        // 接触：速度を乗せて突っ込めば撃破(転落+6秒放心)／そうでなければ突かれる
        if (dp < CFG.NPC_PUSH_R && !g.fall && g.stun <= 0) {
          const ux = dpx / (dp || 1), uy = dpy / (dp || 1);
          if (g.curSpeed > CFG.PLAYER_CHARGE) {
            // 突き落とす：弾かれて転がり落ちる初速を与える
            n.fvx = -ux * CFG.NPC_PUSH_SPEED; n.fvy = -uy * CFG.NPC_PUSH_SPEED;
            n.down = CFG.NPC_DOWN; n.chaseT = 0;
          } else if (g.grace <= 0 && n.satT <= 0) {
            g.fall = { vx: ux * CFG.NPC_PUSH_SPEED, vy: uy * CFG.NPC_PUSH_SPEED, t: 0 };
            g.health = clamp(g.health - CFG.FALL_DAMAGE, 0, 1);
            n.x -= ux * 30; n.y -= uy * 30;
            anyPush = true;
          }
        }
      }
      if (anyPush) for (const n of g.npcs) { n.satT = CFG.NPC_SATISFIED; n.chaseT = 0; } // 全員満足
      return;
    }
    if (g.state === 'end') {
      g.end.t += dt;
      const cam = g.end.cam;
      // 慣性（フリックで回り続けて減衰）。指を置いていない時のみ
      if (endPointers.size === 0) {
        cam.yaw += cam.yawVel * dt;
        cam.yawVel *= Math.exp(-dt * 2.2);
        if (Math.abs(cam.yawVel) < 0.0005) cam.yawVel = 0;
      }
      // 未操作なら、イントロ後にゆっくり自動オービット
      if (!cam.touched && g.end.t > 3.0) cam.yaw += 0.09 * dt;
    }
  }

  function beginEnd() {
    const g = game;
    const last = g.path[g.path.length - 1];
    if (Math.hypot(g.px - last.x, g.py - last.y) > 0.5) {
      g.path.push({ x: g.px, y: g.py, h: g.terrain.height(g.px, g.py) });
    }
    postRun(); // 自分のランを記録（他プレイヤーの足跡になる）
    // 軌跡の範囲＋余白で俯瞰領域を決める
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of g.path) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // 最高地点も必ず画に収める
    const pk = g.field.max;
    minX = Math.min(minX, pk.x); maxX = Math.max(maxX, pk.x);
    minY = Math.min(minY, pk.y); maxY = Math.max(maxY, pk.y);
    const span = Math.max(maxX - minX, maxY - minY, 420);
    const half = span / 2 + span * 0.5;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // 等高線を一度だけ抽出し、3Dセグメント(両端=同じ標高)として保存
    const CX = 120, RY = 120;
    const heights = new Float32Array(CX * RY);
    let gmin = Infinity, gmax = -Infinity;
    for (let r = 0; r < RY; r++) {
      for (let c = 0; c < CX; c++) {
        const wx = cx - half + (2 * half) * (c / (CX - 1));
        const wy = cy - half + (2 * half) * (r / (RY - 1));
        const h = g.terrain.height(wx, wy);
        heights[r * CX + c] = h;
        if (h < gmin) gmin = h;
        if (h > gmax) gmax = h;
      }
    }
    const sx0 = [], sy0 = [], sx1 = [], sy1 = [], sh = [];
    const toWX = (c) => cx - half + (2 * half) * (c / (CX - 1));
    const toWY = (r) => cy - half + (2 * half) * (r / (RY - 1));
    for (const lv of levelsFor(gmin, gmax, CFG.CONTOUR_STEP)) {
      contourLevel(heights, CX, RY, lv, (a, b, c, d) => {
        sx0.push(toWX(a)); sy0.push(toWY(b));
        sx1.push(toWX(c)); sy1.push(toWY(d));
        sh.push(lv);
      });
    }

    // 尾根谷度（塗りの陰影用）
    const rv = new Float32Array(CX * RY);
    const tA = new Float32Array(CX * RY), tB = new Float32Array(CX * RY);
    boxBlur(heights, CX, RY, 6, tA, tB);
    let rvMax = 1e-4;
    for (let k = 0; k < CX * RY; k++) { const d = heights[k] - tB[k]; rv[k] = d; const a = d < 0 ? -d : d; if (a > rvMax) rvMax = a; }

    g.end = {
      t: 0,
      region: { cx, cy, half },
      gmin, gmax,
      heights, CX, RY, rv, rvScale: 0.5 / Math.max(rvMax, 0.02),
      seg: {
        x0: Float32Array.from(sx0), y0: Float32Array.from(sy0),
        x1: Float32Array.from(sx1), y1: Float32Array.from(sy1),
        h: Float32Array.from(sh), n: sh.length,
      },
      cam: { yaw: 0, yawVel: 0, zoom: 1, tiltOff: 0, touched: false },
      glCount: 0, glPathCount: 0, glDiscCount: 0, ghostBuilt: false, gpCount: 0, gdCount: 0,
    };
    // WebGL 用メッシュをアップロード（頂点= worldX,worldY,height,rv / 三角形インデックス）
    if (glR) {
      const verts = new Float32Array(CX * RY * 4);
      for (let r = 0; r < RY; r++) {
        for (let c = 0; c < CX; c++) {
          const i = r * CX + c, o = i * 4;
          verts[o] = cx - half + (2 * half) * (c / (CX - 1));
          verts[o + 1] = cy - half + (2 * half) * (r / (RY - 1));
          verts[o + 2] = heights[i];
          verts[o + 3] = rv[i];
        }
      }
      const idx = new Uint16Array((CX - 1) * (RY - 1) * 6);
      let p = 0;
      for (let r = 0; r + 1 < RY; r++) {
        for (let c = 0; c + 1 < CX; c++) {
          const a = r * CX + c, b = a + 1, d = (r + 1) * CX + c, e2 = d + 1;
          idx[p++] = a; idx[p++] = d; idx[p++] = b;
          idx[p++] = b; idx[p++] = d; idx[p++] = e2;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, glR.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glR.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      g.end.glCount = idx.length;

      // 経路：各区間を「自点/相手点/左右」で持つ。幅はシェーダーがスクリーン空間で付ける
      // bias=地面から少し浮かせる量（食い込み防止）
      const pts = g.path, bias = 0.022, pv = [];
      const vtx = (t, o, side) => pv.push(t.x, t.y, t.h + bias, o.x, o.y, o.h + bias, side);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        vtx(a, b, 1); vtx(a, b, -1); vtx(b, a, -1);   // 三角形1
        vtx(b, a, -1); vtx(a, b, -1); vtx(b, a, 1);   // 三角形2
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, glR.pbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pv), gl.STATIC_DRAW);
      g.end.glPathCount = pv.length / 7;

      // 各頂点に円（ラウンド接合＋丸キャップ）。スクリーン空間のビルボード矩形→fragで円に
      const dv = [];
      const disc = (p, cxv, cyv) => dv.push(p.x, p.y, p.h + bias, cxv, cyv);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        disc(p, -1, -1); disc(p, 1, -1); disc(p, 1, 1);
        disc(p, -1, -1); disc(p, 1, 1); disc(p, -1, 1);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, glR.dbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dv), gl.STATIC_DRAW);
      g.end.glDiscCount = dv.length / 5;
    }
    g.state = 'end';
    endPointers.clear();
    endGesture = null;
    if (viewBtn) { viewBtn.style.display = 'none'; viewBtn.classList.remove('hot'); }
  }

  // 数値表示（★=自己記録 / ▲=目標 / ●=現在地 / ✦=ボーナス）。常時表示。
  function drawHud(playerH, maxH, best, flash) {
    const top = 26;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pop = flash > 0 ? 1 + 0.5 * (flash / 0.7) : 1;
    ctx.font = `700 ${Math.round(20 * pop)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillStyle = flash > 0 ? COL.accent : '#26251f';
    ctx.fillText('★ ' + altOf(best), W / 2, top);
    ctx.font = '600 14px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillStyle = COL.peak;
    ctx.fillText('▲ ' + altOf(maxH), W / 2, top + 24);
    ctx.fillStyle = 'rgba(40,39,35,0.5)';
    ctx.fillText('● ' + altOf(playerH), W / 2, top + 44);
  }

  // 左端の縦型・高度計（上端＝フィールド最高。4色スケール＋現在地/記録/目標）
  function drawAltMeter(curH, best, maxH) {
    const x = 16, w = 9;
    const y0 = H * 0.72, y1 = H * 0.26; // 下=0, 上=最高(maxH)
    const top = Math.max(maxH, 1e-3);
    const at = (a) => y0 + (y1 - y0) * clamp(a / top, 0, 1);
    const st = (a) => clamp(a / top, 0, 1); // 色スケールも maxH 基準
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, rgba(ALT4[0]));
    grad.addColorStop(st(ALT_TH[0]), rgba(ALT4[0]));
    grad.addColorStop(st(ALT_TH[0]), rgba(ALT4[1]));
    grad.addColorStop(st(ALT_TH[1]), rgba(ALT4[1]));
    grad.addColorStop(st(ALT_TH[1]), rgba(ALT4[2]));
    grad.addColorStop(st(ALT_TH[2]), rgba(ALT4[2]));
    grad.addColorStop(st(ALT_TH[2]), rgba(ALT4[3]));
    grad.addColorStop(1, rgba(ALT4[3]));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y1, w, y0 - y1);
    ctx.strokeStyle = 'rgba(40,39,35,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y1, w, y0 - y1);
    // 目標(▲) と 記録(★)
    ctx.fillStyle = COL.peak;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.fillText('▲', x + w + 3, at(maxH));
    ctx.fillStyle = '#26251f';
    ctx.fillText('★', x + w + 3, at(best));
    // 現在地マーカー（右向き三角）
    const yc = at(curH);
    ctx.fillStyle = '#26251f';
    ctx.beginPath();
    ctx.moveTo(x - 3, yc); ctx.lineTo(x - 11, yc - 5); ctx.lineTo(x - 11, yc + 5);
    ctx.closePath(); ctx.fill();
  }

  function drawTriangle(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.9, y + s * 0.7);
    ctx.lineTo(x - s * 0.9, y + s * 0.7);
    ctx.closePath();
  }

  // 救助ロケット（底辺 = y に着地）。flame=降下中の噴射
  function drawRocket(x, y, s, flame) {
    const w = s * 0.55, bodyTop = y - s * 1.9, noseTop = y - s * 2.8;
    if (flame) {
      const fl = s * (1.2 + 0.6 * Math.random());
      ctx.fillStyle = 'rgba(255,170,70,0.9)';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.6, y); ctx.lineTo(x + w * 0.6, y); ctx.lineTo(x, y + fl);
      ctx.closePath(); ctx.fill();
    }
    // 機体
    ctx.fillStyle = '#eef2f4';
    ctx.beginPath();
    ctx.moveTo(x - w, y); ctx.lineTo(x - w, bodyTop);
    ctx.quadraticCurveTo(x - w, noseTop, x, noseTop);
    ctx.quadraticCurveTo(x + w, noseTop, x + w, bodyTop);
    ctx.lineTo(x + w, y);
    ctx.closePath(); ctx.fill();
    // フィン
    ctx.fillStyle = COL.accent;
    ctx.beginPath();
    ctx.moveTo(x - w, y - s * 0.4); ctx.lineTo(x - w - s * 0.5, y); ctx.lineTo(x - w, y); ctx.closePath();
    ctx.moveTo(x + w, y - s * 0.4); ctx.lineTo(x + w + s * 0.5, y); ctx.lineTo(x + w, y); ctx.closePath();
    ctx.fill();
    // 窓
    ctx.fillStyle = '#2a7fd0';
    ctx.beginPath(); ctx.arc(x, bodyTop - s * 0.2, s * 0.26, 0, TAU); ctx.fill();
  }

  // ---- 描画: トップダウン（円窓） -----------------------------------------
  function renderPlay() {
    const g = game;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.46;
    const ALWAYS = CFG.ALWAYS_R;               // 常に見える近距離バブル
    const N = CFG.GRID_N;
    // 通常はプレイヤー中心、引きに応じてマップ中心へ。引き切るとマップ全域が枠に収まる
    const NORMAL = CFG.VIEW_RADIUS_WORLD;
    const blend = clamp((g.viewR - NORMAL) / (CFG.ZOOM_MAX_R - NORMAL), 0, 1);
    const camx = lerp(g.px, 0, blend), camy = lerp(g.py, 0, blend);
    const frameR = lerp(NORMAL, CFG.FIELD_R * 1.07, blend); // 画面に収める半径
    const playerH = g.terrain.height(g.px, g.py);
    // レーダーは高所ほど遠くまで届く（低い所では狭い）
    const hN = clamp(playerH / Math.max(0.25, g.field.max.h * 0.85), 0, 1);
    const farSight = lerp(CFG.RADAR_MIN, 2 * CFG.FIELD_R, hN);
    const sightR = lerp(NORMAL, farSight, blend);
    const ppu = R / frameR;
    const CELL = (2 * frameR) / (N - 1);
    // レーダー（ズームアウト）表示：ダークなレーダー画面＋波紋
    const radarView = blend > 0.5;
    const psxR = cx + (g.px - camx) * ppu, psyR = cy + (g.py - camy) * ppu; // レーダー原点(自分)
    const pingT = (g.time % 2.2) / 2.2;       // 波紋の位相
    const pingR = pingT * (R * 1.25);          // 波紋の半径(画面px)

    ctx.fillStyle = COL.out;
    ctx.fillRect(0, 0, W, H);

    // ワールドに整列した格子をサンプリング（パン中もうねらない）
    const ox0 = Math.floor((camx - frameR) / CELL) * CELL;
    const oy0 = Math.floor((camy - frameR) / CELL) * CELL;
    const nx = Math.ceil((2 * frameR) / CELL) + 2;
    const ny = nx;
    let gmin = Infinity, gmax = -Infinity;
    for (let j = 0; j < ny; j++) {
      const wy = oy0 + j * CELL;
      for (let i = 0; i < nx; i++) {
        const h = g.terrain.height(ox0 + i * CELL, wy);
        grid[j * nx + i] = h;
        if (h < gmin) gmin = h;
        if (h > gmax) gmax = h;
      }
    }
    const sxOf = (gx) => cx + (ox0 + gx * CELL - camx) * ppu;
    const syOf = (gy) => cy + (oy0 + gy * CELL - camy) * ppu;
    const wsx = (wx) => cx + (wx - camx) * ppu; // ワールド→画面
    const wsy = (wy) => cy + (wy - camy) * ppu;

    // 高度カラー(青→緑→黄土→白)に、尾根谷度の陰影(谷=暗/尾根=明)を重ねる。
    const drawTint = () => {
      boxBlur(grid, nx, ny, RV_BLUR, gridT, gridB);
      let maxAbs = 1e-4;
      for (let k = 0; k < nx * ny; k++) {
        const rv = grid[k] - gridB[k];
        gridRV[k] = rv;
        const a = rv < 0 ? -rv : rv;
        if (a > maxAbs) maxAbs = a;
      }
      const scale = 0.5 / Math.max(maxAbs, 0.02);
      const M = clamp(Math.round(2 * R), 96, 360);
      shadeCanvas.width = M; shadeCanvas.height = M;
      const img = shadeCtx.createImageData(M, M);
      const d = img.data;
      for (let v = 0; v < M; v++) {
        const gyf = (v / (M - 1)) * (ny - 1);
        const j = gyf | 0, fj = gyf - j, j2 = Math.min(ny - 1, j + 1);
        for (let u = 0; u < M; u++) {
          const gxf = (u / (M - 1)) * (nx - 1);
          const i = gxf | 0, fi = gxf - i, i2 = Math.min(nx - 1, i + 1);
          const w00 = (1 - fi) * (1 - fj), w10 = fi * (1 - fj), w01 = (1 - fi) * fj, w11 = fi * fj;
          const k00 = j * nx + i, k10 = j * nx + i2, k01 = j2 * nx + i, k11 = j2 * nx + i2;
          const h = grid[k00] * w00 + grid[k10] * w10 + grid[k01] * w01 + grid[k11] * w11;
          const rv = gridRV[k00] * w00 + gridRV[k10] * w10 + gridRV[k01] * w01 + gridRV[k11] * w11;
          const idx = (v * M + u) * 4;
          if (radarView) {
            // ダークなレーダー配色：自分より高い所は明るいティール、低い所は目立たない
            const rvN = clamp(0.5 + rv * scale, 0, 1);
            let rr, gg, bb;
            if (h >= playerH) {
              const up = clamp((h - playerH) * 7, 0, 1);
              const b = 0.5 + 0.5 * up + 0.25 * (rvN - 0.5);
              rr = 24 + 70 * b; gg = 70 + 150 * b; bb = 80 + 120 * b;
            } else {
              const lo = 14 + 16 * rvN; // 低地は低コントラストの暗色
              rr = lo * 0.8; gg = lo; bb = lo * 1.1;
            }
            // 波紋が通過した所を一瞬照らす
            const wx = ox0 + gxf * CELL, wy = oy0 + gyf * CELL;
            const sd = Math.hypot(wx - g.px, wy - g.py) * ppu;
            const glow = Math.exp(-((sd - pingR) / 26) * ((sd - pingR) / 26));
            rr += glow * 90; gg += glow * 120; bb += glow * 130;
            d[idx] = Math.min(255, rr); d[idx + 1] = Math.min(255, gg); d[idx + 2] = Math.min(255, bb); d[idx + 3] = 255;
          } else {
            const c = h < ALT_TH[0] ? ALT4[0] : h < ALT_TH[1] ? ALT4[1] : h < ALT_TH[2] ? ALT4[2] : ALT4[3];
            const shade = SHADE_LO + (SHADE_HI - SHADE_LO) * clamp(0.5 + rv * scale, 0, 1);
            d[idx] = Math.min(255, c[0] * shade);
            d[idx + 1] = Math.min(255, c[1] * shade);
            d[idx + 2] = Math.min(255, c[2] * shade);
            d[idx + 3] = 255;
          }
        }
      }
      shadeCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; // 境界をなめらかに
      ctx.drawImage(shadeCanvas, sxOf(0), syOf(0), (nx - 1) * CELL * ppu, (ny - 1) * CELL * ppu);
    };

    const drawContours = () => {
      for (const lv of levelsFor(gmin, gmax, CFG.CONTOUR_STEP)) {
        const major = Math.round(lv / CFG.CONTOUR_STEP) % 5 === 0;
        ctx.strokeStyle = major ? COL.inkMajor : COL.ink;
        ctx.lineWidth = major ? 1.6 : 1;
        ctx.beginPath();
        contourLevel(grid, nx, ny, lv, (a, b, c, d) => {
          ctx.moveTo(sxOf(a), syOf(b));
          ctx.lineTo(sxOf(c), syOf(d));
        });
        ctx.stroke();
      }
    };

    // 視線遮蔽：拡大時のみ、各方角で「自分の高さ+5等高線」を超える地点まで
    const occlude = true; // 常時オクルージョン（遮蔽の先は見えない）
    let poly = null;
    if (occlude) {
      const thresh = g.terrain.height(g.px, g.py) + CFG.LOS_CONTOURS * CFG.CONTOUR_STEP;
      const RAYS = CFG.VIEWSHED_RAYS, STEPS = CFG.VIEWSHED_STEPS;
      poly = [];
      for (let a = 0; a < RAYS; a++) {
        const th = (a / RAYS) * TAU;
        const dc = Math.cos(th), ds = Math.sin(th);
        let rb = sightR;
        for (let k = 1; k <= STEPS; k++) {
          const r = ALWAYS + (sightR - ALWAYS) * (k / STEPS);
          if (g.terrain.height(g.px + dc * r, g.py + ds * r) > thresh) { rb = r; break; }
        }
        poly.push([wsx(g.px + dc * rb), wsy(g.py + ds * rb)]);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = radarView ? '#0b161a' : COL.lens; // レーダーは暗い地
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    if (occlude) {
      // 見える範囲だけに等高線を描く
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.clip();
      drawTint();
      if (!radarView) drawContours();
      ctx.restore();

      // 遮蔽された側を伏せる（多角形を穴にした even-odd 塗り）
      ctx.beginPath();
      ctx.rect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.fillStyle = radarView ? '#0b161a' : 'rgba(231,229,222,0.7)';
      ctx.fill('evenodd');

      // 地平線（壁にぶつかって見えない縁）。レーダーは青白く光らせる
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      if (radarView) {
        ctx.save();
        ctx.strokeStyle = 'rgba(180,225,255,0.9)';
        ctx.shadowColor = 'rgba(150,210,255,0.9)';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(40,39,35,0.22)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      drawTint();
      drawContours();
    }

    // レーダーの波紋（自分から同心円が広がる）
    if (radarView) {
      ctx.save();
      ctx.shadowColor = 'rgba(150,220,255,0.8)';
      ctx.shadowBlur = 6;
      for (let s = 0; s < 2; s++) {
        const ph = (pingT + s * 0.5) % 1;
        const rad = ph * (R * 1.25);
        ctx.strokeStyle = `rgba(170,225,255,${0.55 * (1 - ph)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(psxR, psyR, rad, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(180,230,255,0.95)';
      ctx.beginPath(); ctx.arc(psxR, psyR, 3, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // ある地点が今の視界で見えているか（視界半径内＋視線が通る）
    const pThresh = g.terrain.height(g.px, g.py) + CFG.LOS_CONTOURS * CFG.CONTOUR_STEP;
    const visibleAt = (wx, wy) => {
      const dx = wx - g.px, dy = wy - g.py;
      const d = Math.hypot(dx, dy);
      if (d >= sightR) return false;
      if (!occlude) return true;
      const limit = d * 0.9;
      if (limit <= ALWAYS) return true;
      const ux = dx / d, uy = dy / d;
      for (let k = 1; k <= 30; k++) {
        const r = ALWAYS + (limit - ALWAYS) * (k / 30);
        if (g.terrain.height(g.px + ux * r, g.py + uy * r) > pThresh) return false;
      }
      return true;
    };
    const itemPulse = ((g.time + g.readyPulse) % 1.2) / 1.2;

    // アイテム（未取得・視界内のみ表示）。レーダー=青緑 / ドリンク=青
    for (const it of g.pickups) {
      if (it.taken || !visibleAt(it.x, it.y)) continue;
      const sx = wsx(it.x), sy = wsy(it.y);
      const col = it.type === 'drink' ? COL.drink : COL.item;
      const rgbStr = it.type === 'drink' ? '42,127,208' : '31,138,138';
      ctx.strokeStyle = `rgba(${rgbStr},${0.5 * (1 - itemPulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 12 + itemPulse * 10, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(247,246,242,0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy, 13, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, 13, 0, TAU);
      ctx.stroke();
      drawItemGlyph(ctx, sx, sy, it.type, 9, col);
    }

    // NPC（視界内）。プレイヤーを追っている個体はアクセントで警告
    for (const n of g.npcs) {
      const ddx = n.x - g.px, ddy = n.y - g.py;
      if (Math.hypot(ddx, ddy) >= sightR) continue;
      const sx = wsx(n.x), sy = wsy(n.y);
      if (n.down > 0) {
        // 撃破され転落／放心中：薄く＋クルクル回る棒＋回復リング
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#46423b';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, TAU);
        ctx.fill();
        const ang = g.time * 16;
        ctx.strokeStyle = 'rgba(38,37,31,0.5)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx - Math.cos(ang) * 9, sy - Math.sin(ang) * 9);
        ctx.lineTo(sx + Math.cos(ang) * 9, sy + Math.sin(ang) * 9);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(38,37,31,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 13, -Math.PI / 2, -Math.PI / 2 + clamp(n.down / CFG.NPC_DOWN, 0, 1) * TAU);
        ctx.stroke();
        continue;
      }
      const chasing = n.chaseT > 0;
      // 進行方向の線
      if (n.dx || n.dy) {
        ctx.strokeStyle = chasing ? COL.accent : 'rgba(38,37,31,0.5)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + n.dx * 15, sy + n.dy * 15);
        ctx.stroke();
      }
      ctx.fillStyle = '#46423b';
      ctx.beginPath();
      ctx.arc(sx, sy, 5.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = chasing ? COL.accent : 'rgba(38,37,31,0.4)';
      ctx.lineWidth = chasing ? 2 : 1.4;
      ctx.beginPath();
      ctx.arc(sx, sy, chasing ? 9 + itemPulse * 3 : 8, 0, TAU);
      ctx.stroke();
    }

    // ジップラインのワイヤー（移動中）
    if (g.riding) {
      const tx = wsx(g.riding.tx), ty = wsy(g.riding.ty);
      ctx.strokeStyle = COL.item;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(wsx(g.px), wsy(g.py));
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.item;
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, TAU);
      ctx.fill();
    }


    // フィールド境界（世界の縁）。外側を陰らせ、縁を線で示す
    {
      const bx = wsx(0), by = wsy(0);
      const br = g.field.r * ppu;
      ctx.beginPath();
      ctx.rect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fillStyle = 'rgba(70,66,58,0.32)'; // 圏外を陰らせる
      ctx.fill('evenodd');
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = 'rgba(40,39,35,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ふちを軽く沈めてレンズ感を出す
    const vg = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
    vg.addColorStop(0, 'rgba(120,116,104,0)');
    vg.addColorStop(1, 'rgba(120,116,104,0.22)');
    ctx.fillStyle = vg;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();

    // レンズの縁
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.edge;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    // 体力リング（残量＝弧の長さ。色＝消費ペース。格ゲー風のダメージ赤/回復青）
    if (g.state === 'play') {
      const rr = R + 7, A0 = -Math.PI / 2;
      const hp = clamp(g.health, 0, 1), lag = clamp(g.healthLag, 0, 1);
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'butt';
      // 背景の薄い輪
      ctx.strokeStyle = 'rgba(40,39,35,0.12)';
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      // ダメージ(赤)/回復(青)の追従部分
      if (lag > hp + 1e-3) {
        ctx.strokeStyle = COL.dmg;
        ctx.beginPath(); ctx.arc(cx, cy, rr, A0 + hp * TAU, A0 + lag * TAU); ctx.stroke();
      } else if (lag < hp - 1e-3) {
        ctx.strokeStyle = COL.heal;
        ctx.beginPath(); ctx.arc(cx, cy, rr, A0 + lag * TAU, A0 + hp * TAU); ctx.stroke();
      }
      // 本体（消費ペースで色：低=穏やか / 高=暖色）
      const pace = clamp(g.drainRate / 0.12, 0, 1);
      const pc = [Math.round(lerp(70, 224, pace)), Math.round(lerp(150, 110, pace)), Math.round(lerp(120, 60, pace))];
      ctx.strokeStyle = `rgb(${pc[0]},${pc[1]},${pc[2]})`;
      ctx.beginPath(); ctx.arc(cx, cy, rr, A0, A0 + Math.min(hp, lag) * TAU); ctx.stroke();
      // O₂ 表記（2 は下付き）。リング上端
      ctx.fillStyle = `rgb(${pc[0]},${pc[1]},${pc[2]})`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const oy2 = cy - rr - 11;
      ctx.font = '700 13px ui-monospace, "SF Mono", Menlo, monospace';
      const wO = ctx.measureText('O').width;
      ctx.font = '700 9px ui-monospace, "SF Mono", Menlo, monospace';
      const w2 = ctx.measureText('2').width;
      const x0 = cx - (wO + w2) / 2;
      ctx.font = '700 13px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.fillText('O', x0, oy2);
      ctx.font = '700 9px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.fillText('2', x0 + wO, oy2 + 3);
    }

    // プレイヤー（通常は中央。引き時はマップ上の実位置に）。転落中はアクセント色＆回転
    const mv = input.read();
    const psx = wsx(g.px), psy = wsy(g.py);
    const falling = !!g.fall;
    const stunned = g.stun > 0;
    const pulse = g.state === 'ready' ? 1 + 0.12 * Math.sin(g.readyPulse * 4) : 1;
    ctx.fillStyle = (falling || stunned) ? COL.accent : '#26251f';
    ctx.beginPath();
    ctx.arc(psx, psy, 7 * pulse, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = (falling || stunned) ? 'rgba(224,81,46,0.4)' : 'rgba(38,37,31,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(psx, psy, 13 * pulse, 0, TAU);
    ctx.stroke();
    if (stunned) {
      const frac = clamp(g.stun / (g.stunMax || 1), 0, 1);
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(psx, psy, 17, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      ctx.stroke();
    } else if (falling) {
      const ang = g.time * 16;
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(psx - Math.cos(ang) * 12, psy - Math.sin(ang) * 12);
      ctx.lineTo(psx + Math.cos(ang) * 12, psy + Math.sin(ang) * 12);
      ctx.stroke();
    } else if (g.curSpeed > 0.001) {
      const len = lerp(10, 44, clamp(g.curSpeed / CFG.SPEED_MAX, 0, 1));
      ctx.strokeStyle = '#26251f';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(psx, psy);
      ctx.lineTo(psx + g.moveDir.x * (7 + len), psy + g.moveDir.y * (7 + len));
      ctx.stroke();
    }

    // レーダー所持中：プレイヤーを脈打つ青緑の輪で強調＝中央タップできる合図
    if (g.state === 'ready') {
      const pr = (g.readyPulse % 1.6) / 1.6;
      ctx.strokeStyle = `rgba(38,37,31,${0.45 * (1 - pr)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(psx, psy, 13 + pr * 40, 0, TAU);
      ctx.stroke();
    }

    if (mv.active) {
      ctx.strokeStyle = 'rgba(38,37,31,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mv.ox, mv.oy, 64, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(38,37,31,0.4)';
      ctx.beginPath();
      ctx.arc(mv.px, mv.py, 18, 0, TAU);
      ctx.fill();
    }

    drawHud(g.terrain.height(g.px, g.py), g.field.max.h, g.best, g.flash);
    drawAltMeter(g.terrain.height(g.px, g.py), g.best, g.field.max.h);

    // 左下のレーダーボタン（所持時）。取得時はプレイヤーから飛んでくる演出。
    const rb = { x: 42, y: H - 60, r: 24 };
    if (g.radar > 0) {
      ctx.fillStyle = 'rgba(247,246,242,0.85)';
      ctx.beginPath(); ctx.arc(rb.x, rb.y, rb.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = COL.item; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(rb.x, rb.y, rb.r, 0, TAU); ctx.stroke();
      drawItemGlyph(ctx, rb.x, rb.y, 'radar', 11, COL.item);
      if (g.radar > 1) {
        ctx.fillStyle = COL.item; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 12px ui-monospace, Menlo, monospace';
        ctx.fillText('×' + g.radar, rb.x + rb.r - 2, rb.y + rb.r - 4);
      }
    }
    // 取得演出：プレイヤー(中央)→ボタンへ飛ぶ
    for (const fl of g.radarFlies) {
      const p = easeInOut(clamp(fl.t, 0, 1));
      const fx = lerp(cx, rb.x, p), fy = lerp(cy, rb.y, p);
      const sc = lerp(11, 9, p);
      ctx.fillStyle = 'rgba(247,246,242,0.95)';
      ctx.beginPath(); ctx.arc(fx, fy, sc + 3, 0, TAU); ctx.fill();
      drawItemGlyph(ctx, fx, fy, 'radar', sc, COL.item);
    }
    // #ラン番号（左下・最下段）
    ctx.fillStyle = 'rgba(40,39,35,0.45)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText('#' + g.runNumber, 16, H - 20);

    // タイトル（ready のときだけ）
    if (g.state === 'ready') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = Math.min(W, H) * 0.085;
      const ty = Math.max(size, cy - R - size * 0.7);
      ctx.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.28em';
      ctx.fillStyle = 'rgba(38,37,31,0.88)';
      const tcx = cx + size * 0.14;
      ctx.fillText('TOPOPO', tcx, ty);
      const tw = ctx.measureText('TOPOPO').width; // 文字間隔込みの実幅
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      // タイトル脇にバージョン番号（実幅から右に余白を空ける）
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(size * 0.34)}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.fillStyle = 'rgba(38,37,31,0.4)';
      ctx.fillText(VERSION, tcx + tw / 2 + 12, ty - size * 0.24);
    }
  }

  // ---- 描画: 斜め俯瞰のリプレイ（orbit可） -------------------------------
  function renderEnd() {
    const g = game;
    const e = g.end;
    const { cx, cy, half } = e.region;

    ctx.fillStyle = COL.paper;
    ctx.fillRect(0, 0, W, H);

    // カメラ: 真上(プレイヤー中心・ゲーム中のズーム)から、引きながら傾く
    const R = Math.min(W, H) * 0.46;
    const k = easeInOut(clamp(e.t / 3.2, 0, 1));
    const tilt = clamp(lerp(0, 0.98, k) + e.cam.tiltOff, 0.12, 1.32);
    const yaw = e.cam.yaw;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);

    const startScale = R / CFG.VIEW_RADIUS_WORLD;          // ゲーム中と同じ縮尺
    const fitScale = (Math.min(W, H) * 0.8) / (2 * half);
    const scale = lerp(startScale, fitScale, k) * e.cam.zoom;
    const ep = g.path[g.path.length - 1];
    const ccx = lerp(ep.x, cx, k); // 視野中心: 到達点 → 領域中心
    const ccy = lerp(ep.y, cy, k);
    const ox = W / 2;
    const oy = H * 0.54;
    const EXAG = 1.25;
    const depthHalf = half * 1.45;

    const project = (wx, wy, h) => {
      const X = wx - ccx, Y = wy - ccy;
      const rx = X * cyaw - Y * syaw;
      const ry = X * syaw + Y * cyaw;
      const Z = h * HEIGHT_SCALE * EXAG;
      return {
        sx: ox + rx * scale,
        sy: oy + ry * scale * ct - Z * scale * st,
        ry,
      };
    };

    const useGL = glR && e.glCount > 0;
    if (useGL) {
      // WebGL でリザルト地形をピクセル単位に塗る（色帯＋等高線＋AA）
      if (glCanvas.width !== canvas.width || glCanvas.height !== canvas.height) {
        glCanvas.width = canvas.width; glCanvas.height = canvas.height;
      }
      const T = glR.terr, u = T.u;
      const setX = (uu) => { // 共有の投影uniform
        gl.uniform2f(uu.cam, ccx, ccy); gl.uniform2f(uu.yaw, cyaw, syaw); gl.uniform2f(uu.tilt, ct, st);
        gl.uniform2f(uu.origin, ox, oy); gl.uniform2f(uu.view, W, H);
        gl.uniform1f(uu.scale, scale); gl.uniform1f(uu.z, HEIGHT_SCALE * EXAG); gl.uniform1f(uu.depth, 1 / (depthHalf * 2.2));
      };
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(T.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, glR.vbo);
      gl.enableVertexAttribArray(T.aPos); gl.vertexAttribPointer(T.aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(T.aH); gl.vertexAttribPointer(T.aH, 1, gl.FLOAT, false, 16, 8);
      gl.enableVertexAttribArray(T.aRV); gl.vertexAttribPointer(T.aRV, 1, gl.FLOAT, false, 16, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glR.ibo);
      setX(u);
      gl.uniform3f(u.c0, ALT4[0][0] / 255, ALT4[0][1] / 255, ALT4[0][2] / 255);
      gl.uniform3f(u.c1, ALT4[1][0] / 255, ALT4[1][1] / 255, ALT4[1][2] / 255);
      gl.uniform3f(u.c2, ALT4[2][0] / 255, ALT4[2][1] / 255, ALT4[2][2] / 255);
      gl.uniform3f(u.c3, ALT4[3][0] / 255, ALT4[3][1] / 255, ALT4[3][2] / 255);
      gl.uniform3f(u.th, ALT_TH[0], ALT_TH[1], ALT_TH[2]);
      gl.uniform1f(u.shadeLo, SHADE_LO);
      gl.uniform1f(u.shadeHi, SHADE_HI);
      gl.uniform1f(u.rvScale, e.rvScale);
      gl.uniform1f(u.step, CFG.CONTOUR_STEP);
      gl.drawElements(gl.TRIANGLES, e.glCount, gl.UNSIGNED_SHORT, 0);

      // 経路チューブの再生：自分（朱）→他人（グレー・細め）の順に伸びる
      const Ln = glR.line, Dz = glR.disc;
      const drawTube = (pbo, ribCount, dbo, discCount, prog, halfW, col) => {
        if (prog <= 0 || ribCount <= 0) return;
        gl.useProgram(Ln.prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
        gl.enableVertexAttribArray(Ln.aPos); gl.vertexAttribPointer(Ln.aPos, 2, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(Ln.aH); gl.vertexAttribPointer(Ln.aH, 1, gl.FLOAT, false, 28, 8);
        gl.enableVertexAttribArray(Ln.aPos2); gl.vertexAttribPointer(Ln.aPos2, 2, gl.FLOAT, false, 28, 12);
        gl.enableVertexAttribArray(Ln.aH2); gl.vertexAttribPointer(Ln.aH2, 1, gl.FLOAT, false, 28, 20);
        gl.enableVertexAttribArray(Ln.aSide); gl.vertexAttribPointer(Ln.aSide, 1, gl.FLOAT, false, 28, 24);
        setX(Ln.u); gl.uniform1f(Ln.u.halfW, halfW);
        gl.uniform4f(Ln.u.color, col[0], col[1], col[2], 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, Math.floor((ribCount / 6) * prog) * 6);
        if (discCount > 0) {
          gl.useProgram(Dz.prog);
          gl.bindBuffer(gl.ARRAY_BUFFER, dbo);
          gl.enableVertexAttribArray(Dz.aPos); gl.vertexAttribPointer(Dz.aPos, 2, gl.FLOAT, false, 20, 0);
          gl.enableVertexAttribArray(Dz.aH); gl.vertexAttribPointer(Dz.aH, 1, gl.FLOAT, false, 20, 8);
          gl.enableVertexAttribArray(Dz.aCorner); gl.vertexAttribPointer(Dz.aCorner, 2, gl.FLOAT, false, 20, 12);
          setX(Dz.u); gl.uniform1f(Dz.u.halfW, halfW);
          gl.uniform4f(Dz.u.color, col[0], col[1], col[2], 1.0);
          gl.drawArrays(gl.TRIANGLES, 0, Math.floor((discCount / 6) * prog) * 6);
        }
      };
      // ゴーストのチューブ幾何を一度だけ生成
      if (g.ghosts && g.ghosts.length && !e.ghostBuilt) {
        const bias = 0.022, pv = [], dv = [];
        for (const gh of g.ghosts) {
          const pa = gh.path; if (!pa || pa.length < 2) continue;
          for (let i = 0; i + 1 < pa.length; i++) {
            const a = pa[i], b = pa[i + 1];
            const ax = a[0], ay = a[1], ah = a[2] + bias, bx = b[0], by = b[1], bh = b[2] + bias;
            pv.push(ax, ay, ah, bx, by, bh, 1, ax, ay, ah, bx, by, bh, -1, bx, by, bh, ax, ay, ah, -1,
                    bx, by, bh, ax, ay, ah, -1, ax, ay, ah, bx, by, bh, -1, bx, by, bh, ax, ay, ah, 1);
          }
          for (let i = 0; i < pa.length; i++) {
            const px = pa[i][0], py = pa[i][1], ph = pa[i][2] + bias;
            dv.push(px, py, ph, -1, -1, px, py, ph, 1, -1, px, py, ph, 1, 1, px, py, ph, -1, -1, px, py, ph, 1, 1, px, py, ph, -1, 1);
          }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, glR.gpbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pv), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, glR.gdbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dv), gl.STATIC_DRAW);
        e.gpCount = pv.length / 7; e.gdCount = dv.length / 5; e.ghostBuilt = true;
      }
      // 再生タイミング
      const pbStart = 0.7, ownDur = 1.3, gap = 0.3, ghostDur = 1.8;
      const ownProg = clamp((e.t - pbStart) / ownDur, 0, 1);
      const ghostProg = clamp((e.t - pbStart - ownDur - gap) / ghostDur, 0, 1);
      gl.depthMask(false);
      if (e.ghostBuilt) drawTube(glR.gpbo, e.gpCount, glR.gdbo, e.gdCount, ghostProg, 1.5, [0.42, 0.40, 0.36]);
      drawTube(glR.pbo, e.glPathCount, glR.dbo, e.glDiscCount, ownProg, 2.3, [0.88, 0.32, 0.18]);
      gl.depthMask(true);
    }

    // イントロ序盤は円窓が開いていくように見せる
    const diag = Math.hypot(W, H);
    const maskR = lerp(R, diag, easeOut(clamp(e.t / 0.8, 0, 1)));
    const masking = maskR < diag - 1;
    if (masking) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, maskR, 0, TAU);
      ctx.clip();
    }

    if (useGL) {
      ctx.drawImage(glCanvas, 0, 0, W, H); // GL で塗った地形を貼る
    }

    // 地形を高度カラー＋尾根谷度の陰影で塗る（GL不可時のフォールバック・奥行きソート面）
    if (!useGL) {
      const H4 = e.heights, CXr = e.CX, RYr = e.RY, rvg = e.rv, rvs = e.rvScale;
      for (let r = 0; r < RYr; r++) {
        const wy = cy - half + (2 * half) * (r / (RYr - 1));
        for (let c = 0; c < CXr; c++) {
          const kk = r * CXr + c;
          const p = project(cx - half + (2 * half) * (c / (CXr - 1)), wy, H4[kk]);
          fillPX[kk] = p.sx; fillPY[kk] = p.sy; fillPD[kk] = p.ry;
        }
      }
      const cells = [];
      for (let r = 0; r + 1 < RYr; r++) {
        for (let c = 0; c + 1 < CXr; c++) {
          const k = r * CXr + c;
          cells.push([(fillPD[k] + fillPD[k + 1] + fillPD[(r + 1) * CXr + c] + fillPD[(r + 1) * CXr + c + 1]) * 0.25, k, r, c]);
        }
      }
      cells.sort((a, b) => a[0] - b[0]); // 奥（ry小）から手前へ
      for (let ci = 0; ci < cells.length; ci++) {
        const k = cells[ci][1], r = cells[ci][2], c = cells[ci][3];
        const k10 = k + 1, k11 = (r + 1) * CXr + c + 1, k01 = (r + 1) * CXr + c;
        const hm = H4[k]; // プレイ画面と同じ4色のくっきり塗り分け
        const col = hm < ALT_TH[0] ? ALT4[0] : hm < ALT_TH[1] ? ALT4[1] : hm < ALT_TH[2] ? ALT4[2] : ALT4[3];
        const shade = SHADE_LO + (SHADE_HI - SHADE_LO) * clamp(0.5 + rvg[k] * rvs, 0, 1);
        const cs = `rgb(${Math.min(255, col[0] * shade) | 0},${Math.min(255, col[1] * shade) | 0},${Math.min(255, col[2] * shade) | 0})`;
        ctx.fillStyle = cs; ctx.strokeStyle = cs; ctx.lineWidth = 1; // 同色stroke で継ぎ目を消す
        ctx.beginPath();
        ctx.moveTo(fillPX[k], fillPY[k]);
        ctx.lineTo(fillPX[k10], fillPY[k10]);
        ctx.lineTo(fillPX[k11], fillPY[k11]);
        ctx.lineTo(fillPX[k01], fillPY[k01]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // 等高線（GL不可時のみ。GL使用時はシェーダーが等高線も描く）
    if (!useGL) {
      const BANDS = 8;
      const paths = [];
      for (let i = 0; i < BANDS; i++) paths.push(new Path2D());
      const s = e.seg;
      for (let i = 0; i < s.n; i++) {
        const a = project(s.x0[i], s.y0[i], s.h[i]);
        const b = project(s.x1[i], s.y1[i], s.h[i]);
        const depthN = clamp(((a.ry + b.ry) * 0.5 / depthHalf) * 0.5 + 0.5, 0, 1);
        const band = clamp((depthN * BANDS) | 0, 0, BANDS - 1);
        paths[band].moveTo(a.sx, a.sy);
        paths[band].lineTo(b.sx, b.sy);
      }
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineWidth = 1;
      for (let band = 0; band < BANDS; band++) {
        const gray = Math.round(lerp(210, 55, (band + 0.5) / BANDS));
        ctx.strokeStyle = `rgb(${gray},${gray},${gray})`;
        ctx.stroke(paths[band]);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 他プレイヤーの足跡（GL不可時のみ2Dの薄線で。GL時はグレーのチューブで再生）
    if (!useGL && g.ghosts && g.ghosts.length) {
      ctx.strokeStyle = 'rgba(70,66,58,0.16)';
      ctx.lineWidth = 1.2;
      for (const gh of g.ghosts) {
        const pa = gh.path;
        if (!pa || pa.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < pa.length; i++) {
          const pr = project(pa[i][0], pa[i][1], pa[i][2]);
          if (i === 0) ctx.moveTo(pr.sx, pr.sy); else ctx.lineTo(pr.sx, pr.sy);
        }
        ctx.stroke();
      }
    }

    // 軌跡（GL不可時のみ2Dで。GL使用時は深度付きリボンで描画済み）
    if (!useGL) {
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (let i = 0; i < g.path.length; i++) {
        const p = g.path[i];
        const pr = project(p.x, p.y, p.h);
        if (i === 0) ctx.moveTo(pr.sx, pr.sy);
        else ctx.lineTo(pr.sx, pr.sy);
      }
      ctx.stroke();
    }

    // スタート地点
    const sp = g.path[0];
    const spr = project(sp.x, sp.y, sp.h);
    ctx.strokeStyle = 'rgba(40,39,35,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(spr.sx, spr.sy, 7, 0, TAU);
    ctx.stroke();

    // 到達地点: 高さを示す縦線 + 脈打つ点
    const epr = project(ep.x, ep.y, ep.h);
    const base = project(ep.x, ep.y, e.gmin);
    ctx.strokeStyle = 'rgba(224,81,46,0.45)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(epr.sx, epr.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    if (g.flagged) {
      // 立てた旗
      const px = epr.sx, py = epr.sy, ph = 24;
      ctx.strokeStyle = '#26251f'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - ph); ctx.stroke();
      ctx.fillStyle = COL.accent;
      ctx.beginPath(); ctx.moveTo(px, py - ph); ctx.lineTo(px + 16, py - ph + 6); ctx.lineTo(px, py - ph + 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#26251f';
      ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fill();
    } else {
      const pulse = 1 + 0.22 * Math.sin(e.t * 5);
      ctx.fillStyle = COL.accent;
      ctx.beginPath();
      ctx.arc(epr.sx, epr.sy, 7 * pulse, 0, TAU);
      ctx.fill();
    }

    // 取得地点（レーダー/ボーナス）と、レーダーを使った地点
    for (const m of g.marks) {
      const mr = project(m.x, m.y, m.h);
      if (m.type === 'scan') {
        ctx.strokeStyle = 'rgba(31,138,138,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 5, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 9, 0, TAU); ctx.stroke();
      } else {
        const col = m.type === 'drink' ? COL.drink : COL.item;
        ctx.fillStyle = 'rgba(247,246,242,0.92)';
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 7, 0, TAU); ctx.stroke();
        drawItemGlyph(ctx, mr.sx, mr.sy, m.type, 5, col);
      }
    }

    // 他プレイヤーの終着点に小さなグレーの旗
    if (g.ghosts) {
      for (const gh of g.ghosts) {
        const pa = gh.path; if (!pa || !pa.length) continue;
        const lp = pa[pa.length - 1];
        const fr = project(lp[0], lp[1], lp[2]);
        ctx.strokeStyle = 'rgba(70,66,58,0.6)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(fr.sx, fr.sy); ctx.lineTo(fr.sx, fr.sy - 14); ctx.stroke();
        ctx.fillStyle = 'rgba(70,66,58,0.6)';
        ctx.beginPath(); ctx.moveTo(fr.sx, fr.sy - 14); ctx.lineTo(fr.sx + 9, fr.sy - 11); ctx.lineTo(fr.sx, fr.sy - 8); ctx.closePath(); ctx.fill();
      }
    }

    // 最高地点へロケットが降りてくる（＝どこが頂上だったかの答え合わせ）
    const pk = g.field.max;
    const pkr = project(pk.x, pk.y, pk.h);
    const ROCKET_START = 3.2, ROCKET_DUR = 1.8;
    if (e.t > ROCKET_START) {
      const prog = clamp((e.t - ROCKET_START) / ROCKET_DUR, 0, 1);
      const ry = lerp(-60, pkr.sy, easeOut(prog)); // 上空から着地点へ
      const landed = prog >= 1;
      // 着地点の輪（マーカー）
      ctx.strokeStyle = `rgba(200,146,10,${landed ? 0.5 + 0.3 * Math.sin(e.t * 4) : 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pkr.sx, pkr.sy, landed ? 9 : 6, 0, TAU); ctx.stroke();
      drawRocket(pkr.sx, ry, 9, !landed); // 降下中は噴射
    }

    if (masking) ctx.restore();

    // 最終スコア（大きく）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.min(W, H) * 0.13}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillStyle = 'rgba(38,37,31,0.9)';
    ctx.fillText('★ ' + altOf(g.best), W / 2, H * 0.18);

    drawHud(ep.h, g.field.max.h, g.best, 0);

    // ラン番号（#N）と、この地形を遊んだ人数（人アイコン＋数）を小さく
    {
      const players = (g.ghosts ? g.ghosts.length : 0) + 1;
      const bx = 18, by = H - 24;
      ctx.fillStyle = 'rgba(40,39,35,0.5)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.fillText('#' + g.runNumber, bx, by);
      // 人アイコン
      const hx = bx + 2, hy = by + 18;
      ctx.beginPath(); ctx.arc(hx, hy - 4, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 4, hy + 4); ctx.quadraticCurveTo(hx, hy - 2, hx + 4, hy + 4); ctx.closePath(); ctx.fill();
      ctx.fillText(String(players), hx + 10, hy);
    }

    // 再挑戦を促す微かなパルス（イントロ後・言葉なし）
    if (e.t > 2.2) {
      const rp = (e.t % 1.8) / 1.8;
      ctx.strokeStyle = `rgba(38,37,31,${0.35 * (1 - rp)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.9, 8 + rp * 26, 0, TAU);
      ctx.stroke();
    }
  }

  // ---- ループ --------------------------------------------------------------
  let prev = performance.now();
  function frame(now) {
    let dt = (now - prev) / 1000;
    prev = now;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    if (game.state === 'end') renderEnd();
    else renderPlay();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
