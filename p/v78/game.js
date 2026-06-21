// プロトタイプ 01 — 等高線 / 円窓 / 斜面の重さ / 30秒後の俯瞰リプレイ
import { clamp, lerp, easeInOut, easeOut, TAU, rgba, makeRng } from './util.js';
import { makeTerrain, HEIGHT_SCALE } from './terrain.js';
import { contourLevel, levelsFor } from './contours.js';
import { createInput } from './input.js';

const CFG = {
  // 体力制（時間制限の代わり）
  HP_WALK: 0.015,         // 平地を歩く消費(体力/秒・平地は少なめ)
  HP_CLIMB_K: 380,        // 登りで増える消費の強さ
  HP_DESC_K: 240,         // 下りで増える消費の強さ(登りより軽め)
  FALL_LAND_K: 2.6,       // 着地ダメージ＝転落した高さ×これ
  FALL_LAND_MIN: 0.06,    // 着地ダメージの下限
  FALL_LAND_MAX: 0.9,     // 着地ダメージの上限(大転落はほぼ致命)
  STUN_RED: 1.0,          // 着地後に赤く固まる演出時間(操作不能)
  STUN_SHAKE: 0.32,       // 黒に戻ってブルっと震える時間(操作不能)
  HEAL: 0.35,             // ドリンク1本の回復量
  HP_MAX: 2,              // 酸素の上限(最大値以上を取れる＝2周目は外側のリング)
  HEALTH_LAG: 2.6,        // ダメージ/回復の追従(格ゲー風)速度
  RADAR_MIN: 480,         // 低地でのレーダー到達距離(高所ほど伸びる)
  VIEW_RADIUS_WORLD: 235, // 既定(低地・最ズームイン)の視界半径
  HIGH_VIEW_FROM: 0.5,    // この高さ(全体比)を超えると円形レンズが広がり始める
  HIGH_VIEW_TO: 0.7,      // この高さで見晴らし全開（レンズ最大）
  ITEM_DETECT_MUL: 1.5,   // 高所(FROM以上)でアイテムを探知できる範囲＝見晴らし×これ
  REC_TURN: 7.0,          // リザルト共有動画：地形が1回転するのにかける秒数(等速・遅め)
  REC_ROUTE: 2.6,         // 共有動画でルートを再生しきる秒数
  SUMMIT_TOL: 0.006,      // 到達最高度がフィールド最高とこの差以内なら「頂上到達」とみなす
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
  CLIMB_MAX: 0.0040,      // 登り：これより急だと登れず滑り落ちる（崖）
  DOWN_FALL_K: 0.0042,    // 下り/横：steep×入力の強さ がこれを超えると踏み外す（そろり下れば安全）
  TREMBLE_FROM: 0.62,     // 転落しきい値の何割で震え始めるか
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
// 高度カラー(5色): 下から 黄土(砂地)→黄緑→緑→ブルーグレー(高山の岩場)→白。しきいは高さ0..1。
const ALT_C = [[198, 172, 116], [156, 176, 92], [86, 138, 74], [124, 142, 156], [238, 238, 232]];
const ALT_TH = [0.10, 0.18, 0.30, 0.46];
const altColor = (h) => h < ALT_TH[0] ? ALT_C[0] : h < ALT_TH[1] ? ALT_C[1] : h < ALT_TH[2] ? ALT_C[2] : h < ALT_TH[3] ? ALT_C[3] : ALT_C[4];

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
uniform vec3 uC0, uC1, uC2, uC3, uC4;
uniform vec4 uTH;
uniform float uShadeLo, uShadeHi, uRvScale, uStep;
void main(){
  float h = vH;
  float w = fwidth(h);
  vec3 c = uC0;
  c = mix(c, uC1, smoothstep(uTH.x - w, uTH.x + w, h));
  c = mix(c, uC2, smoothstep(uTH.y - w, uTH.y + w, h));
  c = mix(c, uC3, smoothstep(uTH.z - w, uTH.z + w, h));
  c = mix(c, uC4, smoothstep(uTH.w - w, uTH.w + w, h));
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
        c0: tf('uC0'), c1: tf('uC1'), c2: tf('uC2'), c3: tf('uC3'), c4: tf('uC4'), th: tf('uTH'),
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
const SHADE_LO = 1.0; // 尾根谷度の明暗は一旦なし（1=陰影なし。戻すなら 0.68/1.16 など）
const SHADE_HI = 1.0;

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
const VERSION = 'v78'; // タイトル脇に表示（凍結時に各版の番号が残る）

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
  record: '#2e9e5b',    // 自己記録更新（緑＝達成。赤は警告色なので避ける）
};

const ROCKET_START = 3.2, ROCKET_DUR = 1.8; // リザルトの救助ロケット降下タイミング
const CONFETTI_COLORS = ['#e0512e', '#c8920a', '#2a7fd0', '#1f8a8a', '#e8e6df', '#f0c020']; // 紙吹雪

// 散布。バッテリー(レーダー)は低地に、酸素ボンベ(ドリンク)は高地に寄せる。
// シード固定の乱数で配置するので、同じシード(=同じ地形)なら全員アイテム位置も同じ。
function spawnPickups(terrain, R, seed) {
  const list = [];
  const rng = makeRng(((seed >>> 0) * 2654435761 + 12345) >>> 0);
  const rnd = () => { const a = rng() * TAU, rr = 240 + rng() * (R - 300); return { x: Math.cos(a) * rr, y: Math.sin(a) * rr }; };
  const place = (type, mode) => {
    let best = rnd();
    if (mode !== 'any') {
      let bs = mode === 'low' ? Infinity : -Infinity;
      for (let k = 0; k < 12; k++) { const p = rnd(); const s = terrain.height(p.x, p.y); if (mode === 'low' ? s < bs : s > bs) { bs = s; best = p; } }
    }
    list.push({ x: best.x, y: best.y, type, taken: false });
  };
  for (let i = 0; i < CFG.RADAR_COUNT; i++) place('radar', 'low');
  for (let i = 0; i < CFG.DRINK_COUNT; i++) place('drink', 'high');
  return list;
}

// レーダーのマーク（同心円＋スイープ）。電池ボタンの表示などに使う。
function drawRadarMark(ctx, x, y, s, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (const rr of [s * 0.5, s]) { ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s * 0.72, y - s * 0.72); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.fill();
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

// フィールド内の最高地点を探す（細かいグリッドで候補を拾い、上位から勾配上昇で精密化）
// 粗すぎると鋭い峰を取りこぼし「表示の最高地点より上に行ける」不具合になるため密にサンプルする
function findFieldMax(terrain, R) {
  const N = 150;                          // ≒20単位刻み（地形の最小スケールに見合う密度）
  const cands = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -R + (2 * R) * (i / (N - 1));
      const y = -R + (2 * R) * (j / (N - 1));
      if (x * x + y * y > R * R) continue;
      cands.push({ x, y, h: terrain.height(x, y) });
    }
  }
  cands.sort((a, b) => b.h - a.h);
  const seeds = cands.slice(0, 12);       // 上位候補それぞれから登って局所最適の取りこぼしを防ぐ
  let best = seeds[0];
  const g = { x: 0, y: 0 };
  for (const s of seeds) {
    let x = s.x, y = s.y, h = s.h;
    let step = (2 * R) / (N - 1);
    for (let it = 0; it < 90; it++) {
      terrain.gradient(x, y, g);
      const m = Math.hypot(g.x, g.y) || 1;
      const nx = x + (g.x / m) * step;
      const ny = y + (g.y / m) * step;
      if (nx * nx + ny * ny <= R * R) {
        const nh = terrain.height(nx, ny);
        if (nh > h) { x = nx; y = ny; h = nh; continue; }
      }
      step *= 0.6;
      if (step < 0.3) break;
    }
    if (h > best.h) best = { x, y, h };
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
  const GRID_CAP = 224;                    // 格子バッファの最大辺（高所でレンズ拡大時も世界固定セルを保つため余裕を持たせる）
  const grid = new Float32Array(GRID_CAP * GRID_CAP); // ワールド固定格子の作業領域
  const gridB = new Float32Array(GRID_CAP * GRID_CAP); // ぼかし
  const gridT = new Float32Array(GRID_CAP * GRID_CAP); // ぼかし作業用
  const gridRV = new Float32Array(GRID_CAP * GRID_CAP); // 尾根谷度
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
  // リザルトで立てる旗と同じ形（ポール＋右向きの三角ペナント）
  const ICON_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21V3"/><path d="M9 4 L20 8.5 L9 13 Z" fill="currentColor" stroke="none"/></svg>';
  if (viewBtn) {
    viewBtn.innerHTML = ICON_FLAG;
    viewBtn.addEventListener('click', () => {
      if (game.state === 'play') { game.flagged = true; beginEnd(); }
    });
  }

  // リザルトの共有（画像／地形が等速で回る動画）。
  const shareWrap = document.getElementById('share');
  const shareImgBtn = document.getElementById('shareImg');
  const shareVidBtn = document.getElementById('shareVid');
  const ICON_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M21 16l-5-5-6 6"/></svg>';
  const ICON_VID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z" fill="currentColor" stroke="none"/></svg>';
  const ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>';
  let recording = null; // {mr, t, dur, startYaw}
  let pendingShare = null; // 録画完了後、ユーザー操作で共有するための保留データ {blob, filename}
  if (shareImgBtn) shareImgBtn.innerHTML = ICON_IMG;
  if (shareVidBtn) shareVidBtn.innerHTML = ICON_VID;

  // 共有 or 端末でダウンロード（Web Share が使えない環境のフォールバック）
  function shareOrSave(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  function shareImage() {
    if (recording) return;
    canvas.toBlob((blob) => { if (blob) shareOrSave(blob, 'topopo.png'); }, 'image/png');
  }

  function pickVideoMime() {
    if (!window.MediaRecorder) return '';
    for (const m of ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  function shareVideo() {
    if (recording || game.state !== 'end') return;
    // 録画直後：保留中の動画があれば、このタップ（ユーザー操作）で共有する
    // ※録画は数秒かかり navigator.share のユーザー操作許可が切れるため、共有は次のタップで行う
    if (pendingShare) {
      const ps = pendingShare; pendingShare = null;
      if (shareVidBtn) { shareVidBtn.classList.remove('ready'); shareVidBtn.innerHTML = ICON_VID; }
      shareOrSave(ps.blob, ps.filename);
      return;
    }
    const mime = pickVideoMime();
    if (!mime || !canvas.captureStream) { shareImage(); return; } // 非対応端末は画像で代替
    let mr;
    try { mr = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 }); }
    catch (_) { shareImage(); return; }
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      if (shareVidBtn) { shareVidBtn.classList.remove('rec'); shareVidBtn.disabled = false; }
      if (shareImgBtn) shareImgBtn.disabled = false;
      const type = mime.split(';')[0];
      const blob = new Blob(chunks, { type });
      // 共有はユーザー操作が必要なので、ボタンを「共有待ち」表示にして次のタップで共有
      pendingShare = { blob, filename: 'topopo.' + (type === 'video/mp4' ? 'mp4' : 'webm') };
      if (shareVidBtn) { shareVidBtn.innerHTML = ICON_UP; shareVidBtn.classList.add('ready'); }
    };
    // 等速回転を制御（録画中は慣性/自動オービットを止める）。
    // 1セット=「ルート再生→ロケット到着→(到達なら)紙吹雪→2秒」。これが収まる整数回転ぶんの長さに。
    const cam = game.end.cam;
    cam.touched = true; cam.yawVel = 0;
    game.end.confetti = null; // 録画では「ルート→旗→紙吹雪」の順に出すためリセット
    const turn = CFG.REC_TURN, routeDur = CFG.REC_ROUTE, rktDur = ROCKET_DUR;
    const seqEnd = routeDur + rktDur + 2.0;
    const dur = Math.ceil(seqEnd / turn) * turn;
    recording = { mr, t: 0, dur, turn, routeDur, rktDur, startYaw: cam.yaw };
    if (shareVidBtn) { shareVidBtn.classList.add('rec'); shareVidBtn.disabled = true; }
    if (shareImgBtn) shareImgBtn.disabled = true;
    // 録画開始前に「録画用の最初のフレーム」を一度描く（ルート未再生・旗/他人なし）。
    // これをしないと captureStream が直前の完成画面を1フレーム拾ってしまう。
    renderEnd();
    try { mr.start(); } catch (_) { recording = null; if (shareVidBtn) { shareVidBtn.classList.remove('rec'); shareVidBtn.disabled = false; } if (shareImgBtn) shareImgBtn.disabled = false; shareImage(); }
  }
  if (shareImgBtn) shareImgBtn.addEventListener('click', shareImage);
  if (shareVidBtn) shareVidBtn.addEventListener('click', shareVideo);

  // デイリーチャレンジは同じ端末で1日1回。リザルトをブラウザに保存し、再訪時はそれを再生。
  const dailyLabel = () => {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  };
  const loadDailyResult = (label) => {
    try { const s = JSON.parse(localStorage.getItem('topopo_daily_result') || 'null'); return (s && s.date === label && Array.isArray(s.path) && s.path.length) ? s : null; } catch (_) { return null; }
  };
  const saveDailyResult = (g) => {
    try {
      const max = 140, step = Math.max(1, Math.ceil(g.path.length / max)), path = [];
      for (let i = 0; i < g.path.length; i += step) path.push([Math.round(g.path[i].x), Math.round(g.path[i].y), +g.path[i].h.toFixed(3)]);
      const last = g.path[g.path.length - 1]; path.push([Math.round(last.x), Math.round(last.y), +last.h.toFixed(3)]);
      localStorage.setItem('topopo_daily_result', JSON.stringify({ date: g.dateLabel, path, best: +g.best.toFixed(4), flagged: !!g.flagged }));
    } catch (_) {}
  };

  // 紙吹雪の1粒。spread=初期配置（画面内外に散らす）/ false=上から再投入（ループ用）
  const mkConfetti = (spread) => ({
    x: Math.random() * W,
    y: spread ? Math.random() * 1.2 * H - 0.6 * H : -14,
    vy: 120 + Math.random() * 150,
    vx: (Math.random() - 0.5) * 40,
    rot: Math.random() * TAU, vrot: (Math.random() - 0.5) * 6,
    w: 5 + Math.random() * 6, h: 3 + Math.random() * 4,
    col: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
    ph: Math.random() * TAU, sw: 2 + Math.random() * 3, sa: 20 + Math.random() * 30,
  });

  function newGame() {
    // デイリーチャレンジ：URLに ?daily が付いていれば、その日の日付をシードに固定
    const daily = new URLSearchParams(location.search).has('daily');
    let runNumber = 1, dateLabel = '';
    if (daily) {
      // JST(UTC+9)の日付を YYYYMMDD の整数に。全員その日は同じ地形・足跡が貯まる
      const d = new Date(Date.now() + 9 * 3600 * 1000);
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
      runNumber = y * 10000 + m * 100 + day; // 例: 20260616（ラン番号(小さい整数)と衝突しない）
      const p2 = (n) => String(n).padStart(2, '0');
      dateLabel = y + '-' + p2(m) + '-' + p2(day);
    } else {
      // ラン回数をブラウザに記録。Nラン目は全員同じ地形 → 足跡が噛み合う
      try {
        runNumber = (parseInt(localStorage.getItem('topopo_run') || '0', 10) || 0) + 1;
        localStorage.setItem('topopo_run', String(runNumber));
      } catch (_) { /* localStorage不可でも続行 */ }
    }
    const terrain = makeTerrain(runSeed(runNumber));
    game = {
      terrain,
      runNumber,
      daily,                        // デイリーチャレンジか
      dateLabel,                    // デイリー時の日付表示
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
      flash: 0,                   // 記録更新の演出(HUDの数字ポップ)
      rec: false,                 // 自己記録を更新中＝緑表示（数値が下がると黒へ）
      lastAlt: undefined,         // 前フレームの高度(数値)。下降検知用
      flagged: false,             // 中央タップで旗を立てて終了したか
      radar: 0,             // レーダー所持数(1回ぶんのズームアウト)
      radarFlies: [],       // レーダー取得演出（左下ボタンへ飛ぶ）
      marks: [],            // 取得/偵察した地点 {x,y,h,type}（リザルト表示用）
      pickups: spawnPickups(terrain, CFG.FIELD_R, runNumber),
      npcs: spawnNpcs(CFG.FIELD_R),
      riding: null,         // ジップライン移動中の目標 {tx,ty}
      fall: null,           // 転落中の速度 {vx,vy,t,h0}（操作不能）
      stun: 0,              // 着地後に赤く固まる演出時間(操作不能)
      recoverShake: 0,      // 黒に戻ってブルっと震える時間(操作不能)
      grace: 0,             // 復帰直後の無敵(突かれない)時間
      curSpeed: 0,          // 現在の速度係数(描画の線長に使用)
      tremble: 0,           // 転落しきい値への近さ(プレイヤーの震え)
      moveDir: { x: 0, y: 0 },
      path: [{ x: 0, y: 0, h: terrain.height(0, 0) }],
      readyPulse: 0,
      replay: false,        // 保存済みデイリーの再生か（記録はしない）
      end: null,
    };
    input.state.everPressed = false;
    input.state.zoomReq = 0;
    endPointers.clear();
    endGesture = null;
    if (viewBtn) { viewBtn.style.display = 'none'; viewBtn.classList.remove('hot'); }
    if (shareWrap) shareWrap.classList.remove('on'); // 共有ボタンを隠す
    pendingShare = null;
    if (shareVidBtn) { shareVidBtn.classList.remove('ready', 'rec'); shareVidBtn.disabled = false; shareVidBtn.innerHTML = ICON_VID; }
    fetchGhosts(runNumber);
    // デイリーは1日1回：保存済みのリザルトがあれば、その結果画面を再生する
    if (daily) {
      const saved = loadDailyResult(dateLabel);
      if (saved) {
        game.path = saved.path.map((p) => ({ x: p[0], y: p[1], h: p[2] }));
        game.best = saved.best;
        game.flagged = !!saved.flagged;
        const last = game.path[game.path.length - 1];
        game.px = last.x; game.py = last.y;
        game.replay = true;
        beginEnd();
      }
    }
  }

  // 他プレイヤーの足跡を取得（同シード=同じラン番号）。失敗は無視。
  // 不正なゴーストを除外：(1)フィールド円の外（プレイヤーは毎フレーム円内にクランプされる）
  // (2)記録された高さが現在の地形と合わない（別地形/壊れデータ＝浮いて見える）。
  function fetchGhosts(runNumber) {
    const lim2 = (CFG.FIELD_R * 1.02) ** 2;
    fetch('/api/runs?seed=' + runNumber)
      .then((r) => (r.ok ? r.json() : []))
      .then((runs) => {
        if (!(game && game.runNumber === runNumber && Array.isArray(runs))) return;
        const terr = game.terrain;
        const ok = (r) => {
          if (!Array.isArray(r.path) || r.path.length < 2) return false;
          for (const p of r.path) if (p[0] * p[0] + p[1] * p[1] > lim2) return false; // 圏外
          let n = 0, hit = 0; const step = Math.max(1, Math.floor(r.path.length / 10));
          for (let i = 0; i < r.path.length; i += step) { const p = r.path[i]; n++; if (Math.abs(terr.height(p[0], p[1]) - p[2]) < 0.025) hit++; }
          return n > 0 && hit / n >= 0.6; // 高さが現在の地形とおおむね一致
        };
        let gs = runs.filter(ok);
        // 終了後に届いた場合は、確定済みの俯瞰領域からはみ出すものを表示しない
        const rg = game.end && game.end.region;
        if (game.state === 'end' && rg) {
          gs = gs.filter((r) => r.path.every((p) => Math.abs(p[0] - rg.cx) <= rg.half && Math.abs(p[1] - rg.cy) <= rg.half));
        }
        game.ghosts = gs;
      })
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
    const W = window.innerWidth, H = window.innerHeight;
    const cx = W / 2, cy = H / 2;
    const R0 = Math.min(W, H) * 0.46;
    const playerH = game.terrain.height(game.px, game.py);
    const hi = clamp((playerH / Math.max(0.25, game.field.max.h) - CFG.HIGH_VIEW_FROM) / (CFG.HIGH_VIEW_TO - CFG.HIGH_VIEW_FROM), 0, 1);
    const ppu0 = R0 / CFG.VIEW_RADIUS_WORLD;
    const blend = clamp((game.viewR - CFG.VIEW_RADIUS_WORLD) / (CFG.ZOOM_MAX_R - CFG.VIEW_RADIUS_WORLD), 0, 1);
    const Rhi = lerp(R0, Math.hypot(W, H) * 0.5, hi);
    const R = lerp(Rhi, R0, blend); // レーダー時は既定の円に縮小（renderPlayと一致）
    const camx = lerp(game.px, 0, blend), camy = lerp(game.py, 0, blend);
    const frameR = lerp(Rhi / ppu0, CFG.FIELD_R * 1.07, blend);
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
      cam.tiltOff = clamp(cam.tiltOff - dy * 0.004, -0.45, 0.62);
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
        game.marks.push({ x: game.px, y: game.py, h: game.terrain.height(game.px, game.py), type: 'scan', pi: game.path.length });
      }
    }
    playTap = null;
  });
  window.addEventListener('pointerup', (e) => {
    if (game.state !== 'end' || !endPointers.has(e.pointerId)) return;
    endPointers.delete(e.pointerId);
    if (endPointers.size === 0) {
      if (!recording && endGesture && !endGesture.moved && performance.now() - endGesture.t0 < 350 && game.end.t > 2.2) {
        // デイリーは1回だけ。終了後のタップは通常の最新版で開始
        if (game.daily) location.href = '/'; else newGame();
      }
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
      const altNow = altOf(hNow);
      if (hNow > g.best) { g.best = hNow; g.flash = 0.7; g.rec = true; } // 自己記録更新＝達成(緑)
      else if (g.lastAlt !== undefined && altNow < g.lastAlt) { g.rec = false; } // 数値が下がった瞬間に黒へ
      g.lastAlt = altNow;
      if (g.flash > 0) g.flash -= dt;
      for (const fl of g.radarFlies) fl.t += dt / 0.5; // 0.5秒で着地
      if (g.radarFlies.some((f) => f.t >= 1)) g.radarFlies = g.radarFlies.filter((f) => f.t < 1);
      let moved = false;
      g.curSpeed = 0;
      g.tremble = 0; // 転落しきい値への近さ（その他状態では震えない）
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
          // 着地：落ちた高さに応じて大ダメージ → 1秒赤く固まる演出へ
          const drop = Math.max(0, g.fall.h0 - g.terrain.height(g.px, g.py));
          const dmg = clamp(drop * CFG.FALL_LAND_K, CFG.FALL_LAND_MIN, CFG.FALL_LAND_MAX);
          g.health = clamp(g.health - dmg, 0, CFG.HP_MAX);
          g.fall = null;
          g.stun = CFG.STUN_RED;
          if (g.health <= 0) { g.flagged = true; beginEnd(); return; } // 力尽きた地点に旗
        }
        moved = true;
      } else if (g.stun > 0) {
        // 放心(演出)：1秒赤く固まる。操作不能。終わると「ブルっと震え」へ
        g.stun -= dt;
        if (g.stun <= 0) { g.stun = 0; g.recoverShake = CFG.STUN_SHAKE; }
      } else if (g.recoverShake > 0) {
        // 黒に戻ってブルっと震える。終わったら操作可能（ハメ防止の無敵猶予つき）
        g.recoverShake -= dt;
        if (g.recoverShake <= 0) g.recoverShake = 0; // 復帰（敵なしのため無敵猶予graceは廃止）
      } else {
        const mv = input.read();
        // 転落判定（新ロジック）：
        //  ・登り＝入力が強くても転けない。急すぎて登れない崖(steep>CLIMB_MAX)だけ滑り落ちる。
        //  ・下り/横/その場＝「急斜面 × 入力の強さ」が大きいと踏み外す（=そろり下れば安全）。
        g.terrain.gradient(g.px, g.py, grad);
        const steep = Math.hypot(grad.x, grad.y);
        const ds = grad.x * mv.x + grad.y * mv.y;        // +上り −下り（進行方向の傾斜）
        const goingUp = mv.mag > 0.12 && ds > 0;
        const danger = goingUp ? steep / CFG.CLIMB_MAX   // 崖は登れず滑り落ちる
                               : steep * mv.mag / CFG.DOWN_FALL_K; // 勢いよく下る/横切るほど危険
        g.tremble = clamp((danger - CFG.TREMBLE_FROM) / (1 - CFG.TREMBLE_FROM), 0, 1);
        if (danger > 1) {
          // 転落開始：ダメージは着地時に「落ちた高さ」に応じて発生。滑った地点をリザルト用に記録
          g.fall = { vx: 0, vy: 0, t: 0, h0: g.terrain.height(g.px, g.py) };
          g.marks.push({ x: g.px, y: g.py, h: g.terrain.height(g.px, g.py), type: 'fall', pi: g.path.length });
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
          // 平地は少なめ。登り・下りとも傾斜に応じて増える（登りの方が重い）
          const slopeCost = along > 0 ? along * CFG.HP_CLIMB_K : -along * CFG.HP_DESC_K;
          drain = CFG.HP_WALK * mv.mag * (1 + slopeCost);
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
            g.marks.push({ x: it.x, y: it.y, h: g.terrain.height(it.x, it.y), type: it.type, pi: g.path.length });
            if (it.type === 'radar') { g.radar += 1; g.radarFlies.push({ t: 0 }); } // 左下へ飛ぶ演出
            else if (it.type === 'drink') g.health = Math.min(CFG.HP_MAX, g.health + CFG.HEAL); // 回復(上限以上も貯まる)
          }
        }
      }
      // 体力の消費/回復と追従表示（格ゲー風）
      g.drainRate = drain;
      g.health = clamp(g.health - drain * dt, 0, CFG.HP_MAX);
      g.healthLag += (g.health - g.healthLag) * Math.min(1, dt * CFG.HEALTH_LAG);
      if (g.health <= 0) { g.flagged = true; beginEnd(); return; } // 酸素が尽きた地点に旗
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
            // 突き落とされる：着地時に高さ分のダメージ（転落と同じ仕組み）
            g.fall = { vx: ux * CFG.NPC_PUSH_SPEED, vy: uy * CFG.NPC_PUSH_SPEED, t: 0, h0: g.terrain.height(g.px, g.py) };
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
      if (recording) {
        // 共有動画：等速回転（1回転=turn秒。録画中は慣性/自動オービットを止める）
        recording.t += dt;
        cam.yaw = recording.startYaw + (recording.t / recording.turn) * TAU;
        if (recording.t >= recording.dur) { const mr = recording.mr; recording = null; try { mr.stop(); } catch (_) {} }
      } else {
        // 慣性（フリックで回り続けて減衰）。指を置いていない時のみ
        if (endPointers.size === 0) {
          cam.yaw += cam.yawVel * dt;
          cam.yawVel *= Math.exp(-dt * 2.2);
          if (Math.abs(cam.yawVel) < 0.0005) cam.yawVel = 0;
        }
        // 未操作なら、イントロ後にゆっくり自動オービット
        if (!cam.touched && g.end.t > 3.0) cam.yaw += 0.09 * dt;
      }
      // 紙吹雪（頂上到達でロケット着地後・録画中も降り続く）。録画中はロケット到着後に降らせる
      const confReady = recording ? (recording.t >= recording.routeDur + recording.rktDur) : (g.end.t > ROCKET_START + ROCKET_DUR);
      if (g.end.summit && confReady) {
        if (!g.end.confetti) { g.end.confetti = []; for (let i = 0; i < 100; i++) g.end.confetti.push(mkConfetti(true)); }
        for (const c of g.end.confetti) {
          c.y += c.vy * dt;
          c.x += c.vx * dt + Math.sin((g.end.t + c.ph) * c.sw) * c.sa * dt;
          c.rot += c.vrot * dt;
          if (c.y > H + 14) Object.assign(c, mkConfetti(false));
        }
      }
    }
  }

  function beginEnd() {
    const g = game;
    const last = g.path[g.path.length - 1];
    if (Math.hypot(g.px - last.x, g.py - last.y) > 0.5) {
      g.path.push({ x: g.px, y: g.py, h: g.terrain.height(g.px, g.py) });
    }
    if (!g.replay) {
      postRun(); // 自分のランを記録（他プレイヤーの足跡になる）
      if (g.daily) saveDailyResult(g); // デイリーはリザルトを保存（再訪時に再生）
    }
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
    // 既に読み込めている他プレイヤーの足跡も収める（地形外にはみ出さないように）
    if (g.ghosts) for (const gh of g.ghosts) {
      const pa = gh.path; if (!pa) continue;
      for (const p of pa) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    }
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
      summit: g.best >= g.field.max.h - CFG.SUMMIT_TOL, // 頂上到達で終わったか（紙吹雪/発光）
      confetti: null,
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
    if (shareWrap) shareWrap.classList.add('on'); // 共有ボタンを表示
  }

  // 数値表示（★=自己記録 / ▲=目標 / ●=現在地 / ✦=ボーナス）。常時表示。
  // 数値：▲最高地点 / ★到達した最高度（小）／ ●現在の高度（やや大・記録更新でポップ／頂上で発光）
  function drawHud(playerH, maxH, best, flash, glow, rec) {
    const top = 22;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillStyle = COL.peak;
    ctx.fillText('▲ ' + altOf(maxH), W / 2, top);
    ctx.fillStyle = 'rgba(40,39,35,0.55)';
    ctx.fillText('★ ' + altOf(best), W / 2, top + 19);
    const g2 = glow || 0;
    const pop = flash > 0 ? 1 + 0.4 * (flash / 0.7) : 1;
    ctx.save();
    if (g2 > 0) { ctx.shadowColor = `rgba(255,210,80,${0.8 * g2})`; ctx.shadowBlur = 18 * g2; }
    ctx.font = `700 ${Math.round(23 * pop)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillStyle = g2 > 0 ? COL.peak : (rec ? COL.record : '#26251f'); // 記録更新中は緑(数値が下がると黒)
    ctx.fillText('● ' + altOf(playerH), W / 2, top + 44);
    ctx.restore();
  }

  // 左端の縦型・高度計（上端＝フィールド最高。4色スケール＋現在地/記録/目標）
  function drawAltMeter(curH, best, maxH) {
    const x = 16, w = 9;
    const y0 = H * 0.72, y1 = H * 0.26; // 下=0, 上=最高(maxH)
    const top = Math.max(maxH, 1e-3);
    const at = (a) => y0 + (y1 - y0) * clamp(a / top, 0, 1);
    const st = (a) => clamp(a / top, 0, 1); // 色スケールも maxH 基準
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, rgba(ALT_C[0]));
    for (let i = 0; i < ALT_TH.length; i++) {
      grad.addColorStop(st(ALT_TH[i]), rgba(ALT_C[i]));     // 段彩のくっきりした境界
      grad.addColorStop(st(ALT_TH[i]), rgba(ALT_C[i + 1]));
    }
    grad.addColorStop(1, rgba(ALT_C[ALT_C.length - 1]));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y1, w, y0 - y1);
    ctx.strokeStyle = 'rgba(40,39,35,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y1, w, y0 - y1);
    // 目標(▲) と 記録(★)。近接時は★を少し下げて重なりを避ける
    const yMax = at(maxH);
    let yBest = at(best);
    if (Math.abs(yBest - yMax) < 12) yBest = yMax + 12;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = COL.peak;
    ctx.fillText('▲', x + w + 3, yMax);
    ctx.fillStyle = '#26251f';
    ctx.fillText('★', x + w + 3, yBest);
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
    const R0 = Math.min(W, H) * 0.46;          // 基本のレンズ半径
    const ALWAYS = CFG.ALWAYS_R;               // 常に見える近距離バブル
    const N = CFG.GRID_N;
    const playerH = g.terrain.height(g.px, g.py);
    const hN = clamp(playerH / Math.max(0.25, g.field.max.h * 0.85), 0, 1);
    // 高所(全体の50%以上)では、ズームは変えず「円形の外枠(レンズ)自体」を広げて見晴らしUP（70%で全開）
    const hi = clamp((playerH / Math.max(0.25, g.field.max.h) - CFG.HIGH_VIEW_FROM) / (CFG.HIGH_VIEW_TO - CFG.HIGH_VIEW_FROM), 0, 1);
    const NORMAL = CFG.VIEW_RADIUS_WORLD;      // 倍率(縮尺)は一定
    const ppu0 = R0 / NORMAL;                   // 通常の固定倍率（レンズが広がっても地形の大きさは不変）
    const blend = clamp((g.viewR - CFG.VIEW_RADIUS_WORLD) / (CFG.ZOOM_MAX_R - CFG.VIEW_RADIUS_WORLD), 0, 1);
    const Rhi = lerp(R0, Math.hypot(W, H) * 0.5, hi); // 高所で広がる通常レンズ
    const R = lerp(Rhi, R0, blend);             // レーダー(引き)時は見晴らしに関わらず既定の円に縮小
    const camx = lerp(g.px, 0, blend), camy = lerp(g.py, 0, blend);
    const frameRNormal = Rhi / ppu0;            // 通常：レンズ半径に応じて世界を多く見せる（倍率一定）
    const frameR = lerp(frameRNormal, CFG.FIELD_R * 1.07, blend); // レーダーは全域
    // レーダーは高所ほど遠くまで届く（低い所では狭い）
    const farSight = lerp(CFG.RADAR_MIN, 2 * CFG.FIELD_R, hN);
    const sightR = lerp(frameRNormal, farSight, blend);
    const ppu = R / frameR;
    // レーダー（ズームアウト）表示：ダークなレーダー画面＋波紋
    const radarView = blend > 0.5;
    // 等高線グリッドのセル幅。通常時(レンズ拡大含む)は世界固定の基準セルにして
    // うねうね動くのを防ぐ（拡大はセル数で吸収）。ズーム中だけは frameR に追従させ負荷を抑える。
    const baseCELL = (2 * CFG.VIEW_RADIUS_WORLD) / (N - 1);
    const CELL = blend > 0.02 ? (2 * frameR) / (N - 1) : baseCELL;
    const psxR = cx + (g.px - camx) * ppu, psyR = cy + (g.py - camy) * ppu; // レーダー原点(自分)
    const pingT = (g.time % 2.2) / 2.2;       // 波紋の位相
    const pingR = pingT * (R * 1.25);          // 波紋の半径(画面px)

    ctx.fillStyle = COL.out;
    ctx.fillRect(0, 0, W, H);

    // ワールドに整列した格子をサンプリング（パン中もうねらない／セル幅一定でレンズ拡大でもうねらない）
    const ox0 = Math.floor((camx - frameR) / CELL) * CELL;
    const oy0 = Math.floor((camy - frameR) / CELL) * CELL;
    const nx = Math.min(GRID_CAP, Math.ceil((2 * frameR) / CELL) + 2);
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
          // 高度カラー4色＋尾根谷度の陰影（レーダー時はこの塗りは使わず等高線のみ）
          const c = altColor(h);
          const shade = SHADE_LO + (SHADE_HI - SHADE_LO) * clamp(0.5 + rv * scale, 0, 1);
          d[idx] = Math.min(255, c[0] * shade);
          d[idx + 1] = Math.min(255, c[1] * shade);
          d[idx + 2] = Math.min(255, c[2] * shade);
          d[idx + 3] = 255;
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

    // レーダー表示：自分と同じ高さの等高線だけを光らせる（同高度の地形を浮かび上がらせる）
    const drawPlayerIso = () => {
      ctx.save();
      ctx.strokeStyle = 'rgba(130,235,215,0.95)';
      ctx.shadowColor = 'rgba(110,225,205,0.9)';
      ctx.shadowBlur = 7;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      contourLevel(grid, nx, ny, playerH, (a, b, c, d) => {
        ctx.moveTo(sxOf(a), syOf(b));
        ctx.lineTo(sxOf(c), syOf(d));
      });
      ctx.stroke();
      ctx.restore();
    };

    // 視線遮蔽：拡大時のみ、各方角で「自分の高さ+5等高線」を超える地点まで
    const occlude = true; // 常時オクルージョン（遮蔽の先は見えない）
    let poly = null;
    if (occlude) {
      // 通常は「自分の高さ+3等高線」まで見えるが、レーダーは自分のいる高さの輪郭で遮蔽する
      const thresh = radarView ? playerH : playerH + CFG.LOS_CONTOURS * CFG.CONTOUR_STEP;
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
      if (radarView) {
        drawPlayerIso(); // レーダーは自分と同じ高さの等高線だけ
      } else {
        drawTint();
        drawContours();
      }
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

    // アイテム（未取得・視界内に表示）。レーダー=青緑 / ドリンク=青
    // 高所(50%以上)では「見晴らし×1.5」の範囲まで探知し、画面外のものは視界の端に方向の三角を出す
    const heightFrac = playerH / Math.max(0.25, g.field.max.h);
    const detectR = CFG.ITEM_DETECT_MUL * sightR;
    const aMargin = 18;
    const offArea = (sx, sy) => Math.hypot(sx - cx, sy - cy) > R - aMargin || sx < aMargin || sx > W - aMargin || sy < aMargin || sy > H - aMargin;
    for (const it of g.pickups) {
      if (it.taken) continue;
      const col = it.type === 'drink' ? COL.drink : COL.item;
      const rgbStr = it.type === 'drink' ? '42,127,208' : '31,138,138';
      if (visibleAt(it.x, it.y)) {
        const sx = wsx(it.x), sy = wsy(it.y);
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
        continue;
      }
      // 探知された画面外アイテムの方向三角（高所のみ・通常ビュー）
      if (radarView || heightFrac < CFG.HIGH_VIEW_FROM) continue;
      if (Math.hypot(it.x - g.px, it.y - g.py) > detectR) continue;
      const sx = wsx(it.x), sy = wsy(it.y);
      if (!offArea(sx, sy)) continue;
      let dx = sx - cx, dy = sy - cy; const dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl, uy = dy / dl;
      const txE = ux > 1e-3 ? (W - aMargin - cx) / ux : ux < -1e-3 ? (aMargin - cx) / ux : Infinity;
      const tyE = uy > 1e-3 ? (H - aMargin - cy) / uy : uy < -1e-3 ? (aMargin - cy) / uy : Infinity;
      const edge = Math.min(R - aMargin, txE, tyE);
      const ex = cx + ux * edge, ey = cy + uy * edge;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.fillStyle = `rgb(${rgbStr})`;
      ctx.strokeStyle = 'rgba(247,246,242,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-5, 6); ctx.lineTo(-5, -6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // 他プレイヤーの最終到達地点（小さなグレーの旗＋手前のルートを少しだけ）。視界内のみ表示。
    if (!radarView && g.ghosts) {
      for (const gh of g.ghosts) {
        const pa = gh.path; if (!pa || !pa.length) continue;
        const lp = pa[pa.length - 1];
        if (!visibleAt(lp[0], lp[1])) continue;
        // たどり着くまでの経路を少しだけ（最後の数点）グレーの線で
        const startI = Math.max(0, pa.length - 4);
        ctx.strokeStyle = 'rgba(70,66,58,0.26)';
        ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = startI; i < pa.length; i++) {
          const tx = wsx(pa[i][0]), ty = wsy(pa[i][1]);
          if (i === startI) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
        }
        ctx.stroke();
        // 小さなグレーの旗
        const fx = wsx(lp[0]), fy = wsy(lp[1]);
        ctx.strokeStyle = 'rgba(70,66,58,0.6)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 11); ctx.stroke();
        ctx.fillStyle = 'rgba(70,66,58,0.6)';
        ctx.beginPath(); ctx.moveTo(fx, fy - 11); ctx.lineTo(fx + 7, fy - 8.5); ctx.lineTo(fx, fy - 6); ctx.closePath(); ctx.fill();
      }
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


    // フィールド境界（世界の縁）。外側はモヤがかかって徐々に見えなくなる
    {
      const bx = wsx(0), by = wsy(0);
      const br = g.field.r * ppu;
      const fc = radarView ? '11,22,26' : '247,246,242'; // モヤの色（レーダーは暗い）
      const band = 150; // モヤで霞んでいく幅(px)
      const fog = ctx.createRadialGradient(bx, by, br, bx, by, br + band);
      fog.addColorStop(0, `rgba(${fc},0)`);
      fog.addColorStop(0.55, `rgba(${fc},0.8)`);
      fog.addColorStop(1, `rgba(${fc},1)`); // 完全に覆って向こうは見えない
      ctx.fillStyle = fog;
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      // 縁をうっすら示す破線（モヤの中にぼんやり）
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = radarView ? 'rgba(150,210,255,0.25)' : 'rgba(40,39,35,0.22)';
      ctx.lineWidth = 1.5;
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

    // 体力(酸素)リング（残量＝弧の長さ。色＝消費ペース。格ゲー風のダメージ赤/回復青）
    // 上限(1.0)を超えた分は、ひとつ外側のリング(2周目)として表示する
    if (g.state === 'play') {
      const rr = R0 + 7, dr = 5, A0 = -Math.PI / 2; // リングは基本半径に固定（レンズ拡大時も画面内に保つ）
      const hp = clamp(g.health, 0, CFG.HP_MAX), lag = clamp(g.healthLag, 0, CFG.HP_MAX);
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'butt';
      // 本体（消費ペースで色：低=穏やか / 高=暖色）。残量が少ないと警告色。
      const pace = clamp(g.drainRate / 0.12, 0, 1);
      let pc = [Math.round(lerp(70, 224, pace)), Math.round(lerp(150, 110, pace)), Math.round(lerp(120, 60, pace))];
      if (g.health < 0.25) pc = (Math.sin(g.time * 14) > 0) ? [240, 205, 50] : [248, 248, 244]; // 25%未満：黄⇔白の点滅
      else if (g.health < 0.5) pc = [240, 200, 45]; // 50%未満：黄色
      const laps = Math.max(1, Math.ceil(Math.max(hp, lag) - 1e-6)); // 表示するリング数
      for (let L = 0; L < laps; L++) {
        const rL = rr + L * dr;
        const hpL = clamp(hp - L, 0, 1), lagL = clamp(lag - L, 0, 1);
        // 背景の薄い輪
        ctx.strokeStyle = 'rgba(40,39,35,0.12)';
        ctx.beginPath(); ctx.arc(cx, cy, rL, 0, TAU); ctx.stroke();
        // ダメージ(赤)/回復(青)の追従部分
        if (lagL > hpL + 1e-3) {
          ctx.strokeStyle = COL.dmg;
          ctx.beginPath(); ctx.arc(cx, cy, rL, A0 + hpL * TAU, A0 + lagL * TAU); ctx.stroke();
        } else if (lagL < hpL - 1e-3) {
          ctx.strokeStyle = COL.heal;
          ctx.beginPath(); ctx.arc(cx, cy, rL, A0 + lagL * TAU, A0 + hpL * TAU); ctx.stroke();
        }
        // 本体
        ctx.strokeStyle = `rgb(${pc[0]},${pc[1]},${pc[2]})`;
        ctx.beginPath(); ctx.arc(cx, cy, rL, A0, A0 + Math.min(hpL, lagL) * TAU); ctx.stroke();
      }
      // O₂ 表記（2 は下付き）。最も外側のリング上端
      ctx.fillStyle = `rgb(${pc[0]},${pc[1]},${pc[2]})`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const oy2 = cy - (rr + (laps - 1) * dr) - 11;
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
    let psx = wsx(g.px), psy = wsy(g.py);
    const falling = !!g.fall;
    const stunned = g.stun > 0;        // 着地後に赤く固まる
    const recovering = g.recoverShake > 0; // 黒に戻ってブルっと震える
    // 震え：崖っぷちの危うさ／復帰時のブルっと（復帰は黒のまま強めに揺らす）
    const trm = recovering ? 1 : (g.tremble || 0);
    if (trm > 0 && !g.fall && !stunned) {
      const amp = recovering ? 3.2 : trm * trm * 4.5;
      psx += (Math.random() - 0.5) * 2 * amp;
      psy += (Math.random() - 0.5) * 2 * amp;
    }
    const pulse = g.state === 'ready' ? 1 + 0.12 * Math.sin(g.readyPulse * 4) : 1;
    ctx.fillStyle = (falling || stunned) ? COL.accent : '#26251f'; // 赤=転落/放心、黒=通常/復帰
    ctx.beginPath();
    ctx.arc(psx, psy, 7 * pulse, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = (falling || stunned) ? 'rgba(224,81,46,0.4)' : 'rgba(38,37,31,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(psx, psy, 13 * pulse, 0, TAU);
    ctx.stroke();
    if (falling) {
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

    // タイトル(ready)では数値HUDを出さない（ロゴ等との重なりを避ける）
    if (g.state !== 'ready') drawHud(g.terrain.height(g.px, g.py), g.field.max.h, g.best, g.flash, 0, g.rec);
    drawAltMeter(g.terrain.height(g.px, g.py), g.best, g.field.max.h);

    // 左下のレーダーボタン（所持時）。取得時はプレイヤーから飛んでくる演出。
    const rb = { x: 42, y: H - 60, r: 24 };
    if (g.radar > 0) {
      ctx.fillStyle = 'rgba(247,246,242,0.85)';
      ctx.beginPath(); ctx.arc(rb.x, rb.y, rb.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = COL.item; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(rb.x, rb.y, rb.r, 0, TAU); ctx.stroke();
      drawRadarMark(ctx, rb.x, rb.y, 10, COL.item); // ボタンはレーダーのマーク（拾うのは電池）
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
    // 左下の表示はデイリーの日付だけ（通常のシード番号は出さない）
    if (g.daily) {
      ctx.fillStyle = 'rgba(40,39,35,0.45)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.fillText('☼ ' + g.dateLabel, 16, H - 20);
    }

    // タイトル（ready のときだけ）
    if (g.state === 'ready') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = Math.min(W, H) * 0.085;
      const circleTop = cy - R;
      // デイリーのバッジ寸法を先に測る（ロゴと積んで円の上に収める）
      let badge = null;
      if (g.daily) {
        const fb = Math.round(size * 0.26);
        ctx.font = `700 ${fb}px ui-monospace, "SF Mono", Menlo, monospace`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2em';
        const label = '☼ Daily Challenge';
        const tw = ctx.measureText(label).width;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        badge = { fb, label, w: tw + 16, h: fb + 9 }; // パディング狭め
      }
      // ロゴ位置：デイリー時はバッジぶん上に積んで、円形と被らないようにする
      let logoY;
      if (badge) {
        const gap = 12;
        const blockH = size + gap + badge.h;
        const blockTop = Math.max(10, circleTop - 16 - blockH);
        logoY = blockTop + size / 2;
        badge.yc = blockTop + size + gap + badge.h / 2;
      } else {
        logoY = Math.max(size, circleTop - size * 0.7);
      }
      // ロゴ
      ctx.textAlign = 'center';
      ctx.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.28em';
      ctx.fillStyle = 'rgba(38,37,31,0.88)';
      const tcx = cx + size * 0.14;
      ctx.fillText('TOPOPO', tcx, logoY);
      const tw = ctx.measureText('TOPOPO').width;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      // タイトル脇にバージョン番号
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(size * 0.34)}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.fillStyle = 'rgba(38,37,31,0.4)';
      // 末尾Oの右 ~10px に寄せる（measureText は末尾の字間も含むので1字間ぶん戻す）
      ctx.fillText(VERSION, tcx + tw / 2 - size * 0.28 + 10, logoY - size * 0.2);
      // デイリーチャレンジのバッジ（四角い枠線で囲む・円形には被らない）
      if (badge) {
        const bx0 = cx - badge.w / 2, by0 = badge.yc - badge.h / 2;
        ctx.fillStyle = 'rgba(247,246,242,0.72)';
        ctx.fillRect(bx0, by0, badge.w, badge.h);
        ctx.strokeStyle = COL.peak; ctx.lineWidth = 1.5;
        ctx.strokeRect(bx0, by0, badge.w, badge.h);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `700 ${badge.fb}px ui-monospace, "SF Mono", Menlo, monospace`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2em';
        ctx.fillStyle = COL.peak;
        ctx.fillText(badge.label, cx, badge.yc);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      }
    }
  }

  // ---- 描画: 斜め俯瞰のリプレイ（orbit可） -------------------------------
  function renderEnd() {
    const g = game;
    const e = g.end;
    const { cx, cy, half } = e.region;
    // ルート再生の進捗（録画/通常で共通）。取得アイコンもこの進捗まで出さない。
    const ownReveal = recording ? clamp(recording.t / recording.routeDur, 0, 1) : clamp((e.t - 0.7) / 1.3, 0, 1);
    // 他プレイヤーのルートの再生進捗（自分の再生のあと順に伸びる）。各人の終着旗もこれで出す。
    const ghostReveal = clamp((e.t - 2.3) / 1.8, 0, 1);

    ctx.fillStyle = COL.paper;
    ctx.fillRect(0, 0, W, H);

    // カメラ: 真上(プレイヤー中心・ゲーム中のズーム)から、引きながら傾く
    const R = Math.min(W, H) * 0.46;
    const k = easeInOut(clamp(e.t / 3.2, 0, 1));
    const tilt = clamp(lerp(0, 0.98, k) + e.cam.tiltOff, 0.12, 1.55); // ほぼ水平(約89°)まで倒せる＝高さがよく分かる
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
      gl.uniform3f(u.c0, ALT_C[0][0] / 255, ALT_C[0][1] / 255, ALT_C[0][2] / 255);
      gl.uniform3f(u.c1, ALT_C[1][0] / 255, ALT_C[1][1] / 255, ALT_C[1][2] / 255);
      gl.uniform3f(u.c2, ALT_C[2][0] / 255, ALT_C[2][1] / 255, ALT_C[2][2] / 255);
      gl.uniform3f(u.c3, ALT_C[3][0] / 255, ALT_C[3][1] / 255, ALT_C[3][2] / 255);
      gl.uniform3f(u.c4, ALT_C[4][0] / 255, ALT_C[4][1] / 255, ALT_C[4][2] / 255);
      gl.uniform4f(u.th, ALT_TH[0], ALT_TH[1], ALT_TH[2], ALT_TH[3]);
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
      // 再生タイミング（録画中は自分のルートを最初から再生し、他人のルートは出さない）
      const ownProg = ownReveal;
      const ghostProg = ghostReveal;
      gl.depthMask(false);
      if (!recording && e.ghostBuilt) drawTube(glR.gpbo, e.gpCount, glR.gdbo, e.gdCount, ghostProg, 1.5, [0.42, 0.40, 0.36]);
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
        const hm = H4[k]; // プレイ画面と同じ段彩のくっきり塗り分け
        const col = altColor(hm);
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

    // 他プレイヤーの足跡（GL不可時のみ2Dの薄線で。GL時はグレーのチューブで再生）。録画中は出さない
    if (!recording && !useGL && g.ghosts && g.ghosts.length) {
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

    // 到達地点: 高さを示す縦線 + 脈打つ点（録画中はルート再生が終わってから出す）
    const epr = project(ep.x, ep.y, ep.h);
    const base = project(ep.x, ep.y, e.gmin);
    const showEnd = !recording || recording.t >= recording.routeDur;
    if (showEnd) {
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
    }

    // 取得地点（レーダー/ボーナス）と、レーダーを使った地点。
    // ルート再生がその地点に達するまでは出さない（拾った/使ったタイミングで現れる）。
    const finalLen = Math.max(1, g.path.length - 1);
    for (const m of g.marks) {
      const frac = m.pi != null ? clamp(m.pi / finalLen, 0, 1) : 0;
      if (ownReveal < frac) continue;
      const mr = project(m.x, m.y, m.h);
      if (m.type === 'scan') {
        ctx.strokeStyle = 'rgba(31,138,138,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 5, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 9, 0, TAU); ctx.stroke();
      } else if (m.type === 'fall') {
        // 足を滑らせた地点：赤系の丸＋滑りを表すジグザグ
        ctx.fillStyle = 'rgba(247,246,242,0.92)';
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = COL.dmg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 7, 0, TAU); ctx.stroke();
        ctx.strokeStyle = COL.dmg; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(mr.sx - 3.2, mr.sy - 3); ctx.lineTo(mr.sx + 0.6, mr.sy - 0.6);
        ctx.lineTo(mr.sx - 2, mr.sy + 1.4); ctx.lineTo(mr.sx + 3.2, mr.sy + 3.6);
        ctx.stroke();
      } else {
        const col = m.type === 'drink' ? COL.drink : COL.item;
        ctx.fillStyle = 'rgba(247,246,242,0.92)';
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mr.sx, mr.sy, 7, 0, TAU); ctx.stroke();
        drawItemGlyph(ctx, mr.sx, mr.sy, m.type, 5, col);
      }
    }

    // 他プレイヤーの終着点に小さなグレーの旗（録画中は出さない）。各人のルート再生が終わったら立つ。
    if (!recording && g.ghosts && g.ghosts.length) {
      // 各ゴーストのルート再生が完了する進捗（チューブの連結順＝g.ghosts順）を一度求める
      if (!e.ghostEnds || e.ghostEnds.length !== g.ghosts.length) {
        let totalSeg = 0;
        for (const gh of g.ghosts) { const pa = gh.path; if (pa && pa.length >= 2) totalSeg += pa.length - 1; }
        let cum = 0; e.ghostEnds = [];
        for (const gh of g.ghosts) { const pa = gh.path; cum += (pa && pa.length >= 2) ? pa.length - 1 : 0; e.ghostEnds.push(totalSeg > 0 ? cum / totalSeg : 1); }
      }
      for (let gi = 0; gi < g.ghosts.length; gi++) {
        const pa = g.ghosts[gi].path; if (!pa || !pa.length) continue;
        if (ghostReveal < (e.ghostEnds[gi] != null ? e.ghostEnds[gi] : 1)) continue; // 再生が終着に届くまで旗を出さない
        const lp = pa[pa.length - 1];
        const fr = project(lp[0], lp[1], lp[2]);
        ctx.strokeStyle = 'rgba(70,66,58,0.6)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(fr.sx, fr.sy); ctx.lineTo(fr.sx, fr.sy - 14); ctx.stroke();
        ctx.fillStyle = 'rgba(70,66,58,0.6)';
        ctx.beginPath(); ctx.moveTo(fr.sx, fr.sy - 14); ctx.lineTo(fr.sx + 9, fr.sy - 11); ctx.lineTo(fr.sx, fr.sy - 8); ctx.closePath(); ctx.fill();
      }
    }

    // 最高地点へロケットが降りてくる（＝どこが頂上だったかの答え合わせ）。録画中はルート再生後に降下
    const pk = g.field.max;
    const pkr = project(pk.x, pk.y, pk.h);
    let prog = -1;
    if (recording) { if (recording.t > recording.routeDur) prog = clamp((recording.t - recording.routeDur) / recording.rktDur, 0, 1); }
    else if (e.t > ROCKET_START) prog = clamp((e.t - ROCKET_START) / ROCKET_DUR, 0, 1);
    if (prog >= 0) {
      const ry = lerp(-60, pkr.sy, easeOut(prog)); // 上空から着地点へ
      const landed = prog >= 1;
      // 着地点の輪（マーカー）
      ctx.strokeStyle = `rgba(200,146,10,${landed ? 0.5 + 0.3 * Math.sin(e.t * 4) : 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pkr.sx, pkr.sy, landed ? 9 : 6, 0, TAU); ctx.stroke();
      drawRocket(pkr.sx, ry, 9, !landed); // 降下中は噴射
    }

    if (masking) ctx.restore();

    // 頂上到達なら高度表示を発光（ロケット着地後・録画中はその進行に合わせる）
    const glowOn = recording ? (recording.t >= recording.routeDur + recording.rktDur) : (e.t > ROCKET_START + ROCKET_DUR);
    const glow = (e.summit && glowOn) ? 0.6 + 0.4 * Math.sin(e.t * 4) : 0;

    // 紙吹雪（頂上到達。録画中も降り続く）
    if (e.confetti) {
      for (const c of e.confetti) {
        ctx.save();
        ctx.translate(c.x, c.y); ctx.rotate(c.rot);
        ctx.fillStyle = c.col;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();
      }
    }

    // 数値は上部の三角/星/現在地のみ（大きな自己最高度表示はなし）。頂上で発光。
    // 現在高度は、ルート再生の「いま伸びている先端」の高度にする（収録中も進むほど数字が変わる）。
    const headIdx = g.path.length ? Math.min(g.path.length - 1, Math.floor(ownReveal * (g.path.length - 1))) : 0;
    const headH = g.path.length ? g.path[headIdx].h : ep.h;
    drawHud(headH, g.field.max.h, g.best, 0, glow);

    // この地形を遊んだ人数（人アイコン＋数）を小さく。デイリーのみ日付も。シード番号は出さない
    {
      const players = (g.ghosts ? g.ghosts.length : 0) + 1;
      const bx = 18; let by = H - 24;
      ctx.fillStyle = 'rgba(40,39,35,0.5)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
      if (g.daily) { ctx.fillText('☼ ' + g.dateLabel, bx, by); by += 18; }
      // 人アイコン＋人数
      const hx = bx + 2, hy = by;
      ctx.beginPath(); ctx.arc(hx, hy - 4, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 4, hy + 4); ctx.quadraticCurveTo(hx, hy - 2, hx + 4, hy + 4); ctx.closePath(); ctx.fill();
      ctx.fillText(String(players), hx + 10, hy);
    }

    // 再挑戦を促す微かなパルス（イントロ後・言葉なし）。録画中は消す
    if (!recording && e.t > 2.2) {
      const rp = (e.t % 1.8) / 1.8;
      ctx.strokeStyle = `rgba(38,37,31,${0.35 * (1 - rp)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.9, 8 + rp * 26, 0, TAU);
      ctx.stroke();
    }

    // 共有動画の収録中は下部に TOPOPO のロゴ（デイリーはその下に Daily Challenge バッジ）
    if (recording) {
      const logoSize = Math.round(Math.min(W, H) * 0.078); // 1.3倍に拡大
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (g.daily) {
        const fb = Math.round(logoSize * 0.42);
        const bh = fb + 9;
        const setH = logoSize + 10 + bh;
        const topY = H - 56 - setH; // ロゴ＋バッジのセットを1つ分上げる
        ctx.font = `700 ${logoSize}px ui-monospace, "SF Mono", Menlo, monospace`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.3em';
        ctx.fillStyle = 'rgba(38,37,31,0.9)';
        ctx.fillText('TOPOPO', W / 2, topY);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.font = `700 ${fb}px ui-monospace, "SF Mono", Menlo, monospace`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.18em';
        const label = '☼ Daily Challenge';
        const bw = ctx.measureText(label).width + 16;
        const byc = topY + logoSize * 0.5 + bh * 0.5 + 8;
        ctx.fillStyle = 'rgba(247,246,242,0.72)';
        ctx.fillRect(W / 2 - bw / 2, byc - bh / 2, bw, bh);
        ctx.strokeStyle = COL.peak; ctx.lineWidth = 1.5;
        ctx.strokeRect(W / 2 - bw / 2, byc - bh / 2, bw, bh);
        ctx.fillStyle = COL.peak;
        ctx.fillText(label, W / 2, byc);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      } else {
        const topY = H - 36 - logoSize; // ロゴ1つ分上げる
        ctx.font = `700 ${logoSize}px ui-monospace, "SF Mono", Menlo, monospace`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.3em';
        ctx.fillStyle = 'rgba(38,37,31,0.9)';
        ctx.fillText('TOPOPO', W / 2, topY);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      }
    }
  }

  // ---- ループ --------------------------------------------------------------
  let prev = performance.now();
  let bodyTitle = null, bodyDaily = null;
  function frame(now) {
    let dt = (now - prev) / 1000;
    prev = now;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    if (game.state === 'end') renderEnd();
    else renderPlay();
    // タイトル画面のリンク類（versions/story/daily）は ready のときだけ表示
    const isTitle = game.state === 'ready';
    if (isTitle !== bodyTitle) { bodyTitle = isTitle; document.body.classList.toggle('titlescreen', isTitle); }
    const isDaily = !!game.daily;
    if (isDaily !== bodyDaily) { bodyDaily = isDaily; document.body.classList.toggle('dailymode', isDaily); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
