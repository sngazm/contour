// プロトタイプ 01 — 等高線 / 円窓 / 斜面の重さ / 30秒後の俯瞰リプレイ
import { clamp, lerp, easeInOut, easeOut, TAU, rgba } from './util.js';
import { makeTerrain, HEIGHT_SCALE } from './terrain.js';
import { contourLevel, levelsFor } from './contours.js';
import { createInput } from './input.js';

const CFG = {
  DURATION: 30,           // 1ゲームの長さ(秒)
  VIEW_RADIUS_WORLD: 235, // 既定(最ズームイン)の視界半径＝常時見える近距離バブル
  ZOOM_MAX_R: 1150,       // ピンチアウトで見渡せる最大の視界半径
  GRID_N: 84,             // 等高線サンプルの格子解像度(ズームに依らず一定負荷)
  CONTOUR_STEP: 0.03,     // 等高線の間隔(高さ 0..1)
  LOS_CONTOURS: 5,        // 視線遮蔽のしきい: 自分の高さ + これ×等高線間隔まで見える
  VIEWSHED_RAYS: 96,      // 視線遮蔽を測る方角の数
  VIEWSHED_STEPS: 64,     // 1方角あたりの探索ステップ数
  BASE_SPEED: 100,        // 平地の移動速度(ワールド単位/秒)
  UPHILL_K: 400,          // 斜面が速度に効く強さ
  SPEED_MIN: 0.16,        // 急登での下限係数
  SPEED_MAX: 1.7,         // 下りでの上限係数
  PATH_MIN_STEP: 5,       // 軌跡を記録する最小移動距離
  FIELD_R: 1500,          // フィールド(ステージ)の半径。これが最高地点の探索範囲
  ITEM_COUNT: 6,          // フィールドに撒くアイテム数
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
  NPC_COUNT: 10,          // NPCの数
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

const ITEM_TYPES = ['glove', 'goggle', 'zip'];
const RV_BLUR = 12; // 尾根谷度の近傍半径(セル数。広いほどマダラが減る)
// 尾根谷度を5段階の明暗で。谷(暗)→尾根(明)。
const GRAY5 = [
  [128, 124, 116],
  [165, 161, 152],
  [197, 193, 185],
  [224, 221, 214],
  [246, 244, 239],
];

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
  item: '#1f8a8a',      // アイテム
};

// アイテムを撒く（少なくとも各種1つ、残りはランダム。開始地点から離す）
function spawnItems(R) {
  const list = [];
  for (let i = 0; i < CFG.ITEM_COUNT; i++) {
    const a = Math.random() * TAU;
    const r = 320 + Math.random() * (R - 380);
    const type = i < ITEM_TYPES.length ? ITEM_TYPES[i] : ITEM_TYPES[(Math.random() * ITEM_TYPES.length) | 0];
    list.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, type, taken: false });
  }
  return list;
}

// アイテムのアイコン（中心 x,y / 半径 s）。token=外枠の輪も描く。
function drawItemGlyph(ctx, x, y, type, s, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, s * 0.16);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (type === 'glove') {
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

  let game;
  let endDrag = null; // リザルトでの orbit/タップ判定

  // 右下のビュー切替ボタン（拡大/縮小アイコンを切替）
  const viewBtn = document.getElementById('viewbtn');
  const ICON_EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4"/></svg>';
  const ICON_CONTRACT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h4V4M20 8h-4V4M4 16h4v4M20 16h-4v4"/></svg>';
  function setFar(v) {
    game.far = v;
    if (viewBtn) {
      viewBtn.classList.toggle('far', v);
      viewBtn.innerHTML = v ? ICON_CONTRACT : ICON_EXPAND;
    }
  }
  if (viewBtn) {
    viewBtn.innerHTML = ICON_EXPAND;
    viewBtn.addEventListener('click', () => {
      if (game.state === 'ready' || game.state === 'play') setFar(!game.far);
    });
  }

  function newGame() {
    const seed = (Math.random() * 1e9) >>> 0;
    const terrain = makeTerrain(seed);
    game = {
      terrain,
      field: { r: CFG.FIELD_R, max: findFieldMax(terrain, CFG.FIELD_R) },
      state: 'ready',
      time: 0,
      far: false,                   // ビュー段階: false=通常 / true=最大引き
      viewR: CFG.VIEW_RADIUS_WORLD, // 現在の視界半径(段階へ向けて補間)
      px: 0, py: 0,
      items: { glove: false, goggle: false, zip: false },
      zipCharges: 0,        // ジップラインの残り使用回数(取得ごとに+1)
      pickups: spawnItems(CFG.FIELD_R),
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
    endDrag = null;
    if (viewBtn) { viewBtn.classList.remove('far'); viewBtn.innerHTML = ICON_EXPAND; viewBtn.style.display = ''; }
  }
  newGame();

  // 画面座標→ワールド座標（プレイ中ビュー）
  function screenToWorld(sx, sy) {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const R = Math.min(window.innerWidth, window.innerHeight) * 0.46;
    const ppu = R / game.viewR;
    return { x: game.px + (sx - cx) / ppu, y: game.py + (sy - cy) / ppu };
  }

  // リザルト=ドラッグでorbit/タップで再挑戦。プレイ=タップでジップライン（所持時）
  let tapInfo = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (game.state === 'end') endDrag = { x: e.clientX, y: e.clientY, moved: false };
    else tapInfo = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (game.state === 'end' && endDrag) {
      const dx = e.clientX - endDrag.x;
      const dy = e.clientY - endDrag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) endDrag.moved = true;
      const cam = game.end.cam;
      const dyaw = -dx * 0.006; // 左右反転
      cam.yaw += dyaw;
      endDrag.vyaw = dyaw;      // 慣性用に直近の回転量を保持
      cam.tiltOff = clamp(cam.tiltOff - dy * 0.004, -0.45, 0.5);
      cam.yawVel = 0;
      cam.touched = true;
      endDrag.x = e.clientX;
      endDrag.y = e.clientY;
    } else if (tapInfo) {
      if (Math.hypot(e.clientX - tapInfo.x, e.clientY - tapInfo.y) > 8) tapInfo.moved = true;
    }
  });
  window.addEventListener('pointerup', () => {
    if (game.state === 'end' && endDrag) {
      if (!endDrag.moved && game.end.t > 2.2) newGame();
      else if (endDrag.moved) game.end.cam.yawVel = (endDrag.vyaw || 0) * 16; // 慣性
      endDrag = null;
    } else if (tapInfo) {
      // 動かさない短いタップ＝ジップライン展開（残回数があり、円の視界内のみ）
      if (game.state === 'play' && game.zipCharges > 0 && !game.riding && !tapInfo.moved &&
          performance.now() - tapInfo.t < 350) {
        const r = canvas.getBoundingClientRect();
        const sx = tapInfo.x - r.left, sy = tapInfo.y - r.top;
        const R = Math.min(r.width, r.height) * 0.46;
        const inCircle = Math.hypot(sx - r.width / 2, sy - r.height / 2) <= R;
        if (inCircle) {
          const w = screenToWorld(sx, sy);
          let tx = w.x, ty = w.y;
          const td = Math.hypot(tx, ty);
          if (td > game.field.r) { tx *= game.field.r / td; ty *= game.field.r / td; }
          game.riding = { tx, ty };
          game.zipCharges -= 1;
        }
      }
      tapInfo = null;
    }
  });

  // ---- 更新 ----------------------------------------------------------------
  function update(dt) {
    const g = game;
    if (g.state === 'ready' || g.state === 'play') {
      const zr = input.consumeZoomReq();
      if (zr > 0) setFar(false);
      else if (zr < 0) setFar(true);
      const target = g.far ? CFG.ZOOM_MAX_R : CFG.VIEW_RADIUS_WORLD;
      g.viewR += (target - g.viewR) * Math.min(1, dt * 10); // 段階間を素早く補間
    }
    if (g.state === 'ready') {
      g.readyPulse += dt;
      if (input.read().mag > 0) g.state = 'play';
      return;
    }
    if (g.state === 'play') {
      g.time += dt;
      if (g.grace > 0) g.grace -= dt;
      let moved = false;
      g.curSpeed = 0;
      if (g.riding) {
        // ジップライン：等速で目標へ（地形を無視）
        const dx = g.riding.tx - g.px, dy = g.riding.ty - g.py;
        const d = Math.hypot(dx, dy);
        const step = CFG.ZIP_SPEED * dt;
        if (d > 0) { g.moveDir.x = dx / d; g.moveDir.y = dy / d; }
        if (d <= CFG.ZIP_ARRIVE || d <= step) { g.px = g.riding.tx; g.py = g.riding.ty; g.riding = null; }
        else { g.px += (dx / d) * step; g.py += (dy / d) * step; }
        g.curSpeed = CFG.ZIP_SPEED / CFG.BASE_SPEED; // 速い＝最長
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
        const mul = g.items.glove ? CFG.GLOVE_FALL_MUL : 1;
        const fallS = CFG.FALL_SLOPE * mul, climbMax = CFG.CLIMB_MAX * mul;
        const climbing = mv.mag > 0.25 && (grad.x * mv.x + grad.y * mv.y) > 0; // 上りへ踏ん張る
        if (steep > climbMax || (steep > fallS && !climbing)) {
          g.fall = { vx: 0, vy: 0, t: 0 };
          moved = true;
        } else if (mv.mag > 0) {
          // 進行方向の±一定距離の平均勾配（瞬間の凹凸でガタつかせない）
          const D = CFG.SLOPE_AVG_DIST;
          const hA = g.terrain.height(g.px + mv.x * D, g.py + mv.y * D);
          const hB = g.terrain.height(g.px - mv.x * D, g.py - mv.y * D);
          const along = (hA - hB) / (2 * D); // +で登り
          const k = g.items.glove ? CFG.UPHILL_K * CFG.GLOVE_K_MUL : CFG.UPHILL_K;
          const minF = g.items.glove ? CFG.GLOVE_MIN : CFG.SPEED_MIN;
          const maxF = g.items.glove ? CFG.GLOVE_MAX : CFG.SPEED_MAX; // 装備時は下りが軽快でない
          const f = clamp(1 - along * k, minF, maxF);
          const sp = CFG.BASE_SPEED * f * mv.mag * dt;
          g.px += mv.x * sp;
          g.py += mv.y * sp;
          g.moveDir.x = mv.x; g.moveDir.y = mv.y;
          g.curSpeed = f * mv.mag; // 実際の速度係数
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
        // アイテム取得
        for (const it of g.pickups) {
          if (!it.taken && Math.hypot(g.px - it.x, g.py - it.y) < CFG.PICKUP_R) {
            it.taken = true;
            g.items[it.type] = true;
            if (it.type === 'zip') g.zipCharges += 1; // 取得ごとに1回ぶん
          }
        }
      }
      // NPC：広い範囲で高い所へ登る／プレイヤーが見えて近いと追跡し突き落とす
      let anyPush = false;
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
        // 視線：自分より3等高線以上高い地形に遮られると見えない（満足中は追わない）
        let sees = false;
        if (n.satT <= 0 && dp < CFG.NPC_AGGRO && dp > 1e-3) {
          const thr = g.terrain.height(n.x, n.y) + CFG.NPC_VISION_CONTOURS * CFG.CONTOUR_STEP;
          const ux = dpx / dp, uy = dpy / dp, lim = dp * 0.85;
          sees = true;
          for (let s = 1; s <= 12; s++) {
            if (g.terrain.height(n.x + ux * (lim * s / 12), n.y + uy * (lim * s / 12)) > thr) { sees = false; break; }
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
            n.x -= ux * 30; n.y -= uy * 30;
            anyPush = true;
          }
        }
      }
      if (anyPush) for (const n of g.npcs) { n.satT = CFG.NPC_SATISFIED; n.chaseT = 0; } // 全員満足
      if (g.time >= CFG.DURATION) beginEnd();
      return;
    }
    if (g.state === 'end') {
      g.end.t += dt;
      const cam = g.end.cam;
      // ピンチ/ホイールで少し拡大
      const zr = input.consumeZoomReq();
      if (zr !== 0) cam.zoom = clamp(cam.zoom * (zr > 0 ? 1.15 : 1 / 1.15), 0.7, 1.9);
      // 慣性（フリックで回り続けて減衰）
      if (!endDrag) {
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

    g.end = {
      t: 0,
      region: { cx, cy, half },
      gmin, gmax,
      seg: {
        x0: Float32Array.from(sx0), y0: Float32Array.from(sy0),
        x1: Float32Array.from(sx1), y1: Float32Array.from(sy1),
        h: Float32Array.from(sh), n: sh.length,
      },
      cam: { yaw: 0, yawVel: 0, zoom: 1, tiltOff: 0, touched: false },
    };
    g.state = 'end';
    endDrag = null;
    if (viewBtn) viewBtn.style.display = 'none';
  }

  // 高度の数値表示（▲=フィールド最高 / ●=現在地）。常時表示。
  function drawHud(playerH, maxH) {
    const top = 26;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 16px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillStyle = COL.peak;
    ctx.fillText('▲ ' + altOf(maxH), W / 2, top);
    ctx.fillStyle = '#26251f';
    ctx.fillText('● ' + altOf(playerH), W / 2, top + 24);
  }

  function drawTriangle(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.9, y + s * 0.7);
    ctx.lineTo(x - s * 0.9, y + s * 0.7);
    ctx.closePath();
  }

  // ---- 描画: トップダウン（円窓） -----------------------------------------
  function renderPlay() {
    const g = game;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.46;
    const VR = g.viewR;                       // 現在の視界半径(ピンチで変化)
    const ALWAYS = CFG.VIEW_RADIUS_WORLD;      // 常に見える近距離バブル
    const N = CFG.GRID_N;
    const CELL = (2 * VR) / (N - 1);           // ズームに応じて格子幅を変える(負荷一定)
    const ppu = R / VR;

    ctx.fillStyle = COL.out;
    ctx.fillRect(0, 0, W, H);

    // ワールドに整列した格子をサンプリング（パン中もうねらない）
    const ox0 = Math.floor((g.px - VR) / CELL) * CELL;
    const oy0 = Math.floor((g.py - VR) / CELL) * CELL;
    const nx = Math.ceil((2 * VR) / CELL) + 2;
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
    const sxOf = (gx) => cx + (ox0 + gx * CELL - g.px) * ppu;
    const syOf = (gy) => cy + (oy0 + gy * CELL - g.py) * ppu;

    // 色なし。尾根谷度を5段階の明暗で塗る（谷=暗／尾根=明）。
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
          const rv = (gridRV[j * nx + i] * (1 - fi) + gridRV[j * nx + i2] * fi) * (1 - fj)
                   + (gridRV[j2 * nx + i] * (1 - fi) + gridRV[j2 * nx + i2] * fi) * fj;
          let b = (clamp(0.5 + rv * scale, 0, 1) * 5) | 0;
          if (b > 4) b = 4;
          const c = GRAY5[b];
          const idx = (v * M + u) * 4;
          d[idx] = c[0]; d[idx + 1] = c[1]; d[idx + 2] = c[2]; d[idx + 3] = 255;
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
    const occlude = VR > ALWAYS + 1;
    let poly = null;
    if (occlude) {
      const thresh = g.terrain.height(g.px, g.py) + CFG.LOS_CONTOURS * CFG.CONTOUR_STEP;
      const RAYS = CFG.VIEWSHED_RAYS, STEPS = CFG.VIEWSHED_STEPS;
      poly = [];
      for (let a = 0; a < RAYS; a++) {
        const th = (a / RAYS) * TAU;
        const dc = Math.cos(th), ds = Math.sin(th);
        let rb = VR;
        for (let k = 1; k <= STEPS; k++) {
          const r = ALWAYS + (VR - ALWAYS) * (k / STEPS);
          if (g.terrain.height(g.px + dc * r, g.py + ds * r) > thresh) { rb = r; break; }
        }
        poly.push([cx + dc * rb * ppu, cy + ds * rb * ppu]);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = COL.lens;
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
      drawContours();
      ctx.restore();

      // 遮蔽された側はもやで埋める（多角形を穴にした even-odd 塗り）
      ctx.beginPath();
      ctx.rect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(150,146,135,0.28)';
      ctx.fill('evenodd');

      // 地平線（尾根の稜線）を淡く
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(40,39,35,0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      drawTint();
      drawContours();
    }

    // ある地点が今の視界で見えているか（視界半径内＋視線が通る）
    const pThresh = g.terrain.height(g.px, g.py) + CFG.LOS_CONTOURS * CFG.CONTOUR_STEP;
    const visibleAt = (wx, wy) => {
      const dx = wx - g.px, dy = wy - g.py;
      const d = Math.hypot(dx, dy);
      if (d >= VR) return false;
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

    // アイテム（未取得・視界内のみ表示）
    for (const it of g.pickups) {
      if (it.taken || !visibleAt(it.x, it.y)) continue;
      const sx = cx + (it.x - g.px) * ppu, sy = cy + (it.y - g.py) * ppu;
      ctx.strokeStyle = `rgba(31,138,138,${0.5 * (1 - itemPulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 12 + itemPulse * 10, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(247,246,242,0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy, 13, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = COL.item;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, 13, 0, TAU);
      ctx.stroke();
      drawItemGlyph(ctx, sx, sy, it.type, 9, COL.item);
    }

    // NPC（視界内）。プレイヤーを追っている個体はアクセントで警告
    for (const n of g.npcs) {
      const ddx = n.x - g.px, ddy = n.y - g.py;
      if (Math.hypot(ddx, ddy) >= VR) continue;
      const sx = cx + ddx * ppu, sy = cy + ddy * ppu;
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
      const tx = cx + (g.riding.tx - g.px) * ppu, ty = cy + (g.riding.ty - g.py) * ppu;
      ctx.strokeStyle = COL.item;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.item;
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, TAU);
      ctx.fill();
    }

    // 最高地点：ゴーグル所持時のみ、視界に入っていればマーク
    const pk = g.field.max;
    if (g.items.goggle && visibleAt(pk.x, pk.y)) {
      const sxp = cx + (pk.x - g.px) * ppu, syp = cy + (pk.y - g.py) * ppu;
      ctx.strokeStyle = `rgba(200,146,10,${0.7 * (1 - itemPulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sxp, syp, 5 + itemPulse * 16, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = COL.peak;
      drawTriangle(sxp, syp - 3, 7);
      ctx.fill();
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

    // 最高地点の方角をリング上に表示（ゴーグル所持時のみ＝コンパス）
    if (g.items.goggle) {
      const ddx = pk.x - g.px, ddy = pk.y - g.py;
      if (Math.hypot(ddx, ddy) > 1) {
        const bearing = Math.atan2(ddy, ddx);
        ctx.save();
        ctx.translate(cx + Math.cos(bearing) * R, cy + Math.sin(bearing) * R);
        ctx.rotate(bearing + Math.PI / 2);
        ctx.fillStyle = COL.peak;
        drawTriangle(0, 0, 8);
        ctx.fill();
        ctx.restore();
      }
    }

    // 残り時間リング
    if (g.state === 'play') {
      const remain = clamp(1 - g.time / CFG.DURATION, 0, 1);
      const warm = g.time / CFG.DURATION > 0.8;
      ctx.lineWidth = 3;
      ctx.strokeStyle = warm ? COL.accent : 'rgba(40,39,35,0.45)';
      ctx.beginPath();
      ctx.arc(cx, cy, R + 7, -Math.PI / 2, -Math.PI / 2 + remain * TAU);
      ctx.stroke();
    }

    // プレイヤー（中央固定）。転落中は操作不能を表すアクセント色＆回転
    const mv = input.read();
    const falling = !!g.fall;
    const stunned = g.stun > 0;
    const pulse = g.state === 'ready' ? 1 + 0.12 * Math.sin(g.readyPulse * 4) : 1;
    ctx.fillStyle = (falling || stunned) ? COL.accent : '#26251f';
    ctx.beginPath();
    ctx.arc(cx, cy, 7 * pulse, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = (falling || stunned) ? 'rgba(224,81,46,0.4)' : 'rgba(38,37,31,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 13 * pulse, 0, TAU);
    ctx.stroke();
    if (stunned) {
      // 放心：回復までの減っていくリング（操作不能の合図）
      const frac = clamp(g.stun / (g.stunMax || 1), 0, 1);
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 17, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      ctx.stroke();
    } else if (falling) {
      // ぐるぐる回る短い棒＝制御不能の合図
      const ang = g.time * 16;
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(ang) * 12, cy - Math.sin(ang) * 12);
      ctx.lineTo(cx + Math.cos(ang) * 12, cy + Math.sin(ang) * 12);
      ctx.stroke();
    } else if (g.curSpeed > 0.001) {
      // 進行方向の線。長さ＝実速度（急登でゆっくり=短い／下りで加速=長い）
      const len = lerp(10, 44, clamp(g.curSpeed / CFG.SPEED_MAX, 0, 1));
      ctx.strokeStyle = '#26251f';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + g.moveDir.x * (7 + len), cy + g.moveDir.y * (7 + len));
      ctx.stroke();
    }

    if (g.state === 'ready') {
      const pr = (g.readyPulse % 1.6) / 1.6;
      ctx.strokeStyle = `rgba(38,37,31,${0.45 * (1 - pr)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 13 + pr * 40, 0, TAU);
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

    drawHud(g.terrain.height(g.px, g.py), g.field.max.h);

    // 所持アビリティを左下に小さく（ジップは残回数があるときだけ）
    {
      let n = 0;
      const bx = 26, by = H - 28;
      for (const t of ITEM_TYPES) {
        const have = t === 'zip' ? g.zipCharges > 0 : g.items[t];
        if (!have) continue;
        const x = bx + n * 32;
        drawItemGlyph(ctx, x, by, t, 9, COL.item);
        if (t === 'zip' && g.zipCharges > 1) {
          ctx.fillStyle = COL.item;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '600 11px ui-monospace, Menlo, monospace';
          ctx.fillText('×' + g.zipCharges, x + 14, by + 8);
        }
        n++;
      }
    }

    // タイトル（ready のときだけ）
    if (g.state === 'ready') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = Math.min(W, H) * 0.085;
      ctx.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.28em';
      ctx.fillStyle = 'rgba(38,37,31,0.88)';
      ctx.fillText('TOPOPO', cx + size * 0.14, Math.max(size, cy - R - size * 0.7));
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
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

    // 等高線を奥行きで濃淡分け（multiplyで前後の見え方を出す）
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
      const gray = Math.round(lerp(210, 55, (band + 0.5) / BANDS)); // 奥=薄 手前=濃
      ctx.strokeStyle = `rgb(${gray},${gray},${gray})`;
      ctx.stroke(paths[band]);
    }
    ctx.globalCompositeOperation = 'source-over';

    // 軌跡
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
    const pulse = 1 + 0.22 * Math.sin(e.t * 5);
    ctx.fillStyle = COL.accent;
    ctx.beginPath();
    ctx.arc(epr.sx, epr.sy, 7 * pulse, 0, TAU);
    ctx.fill();

    // フィールド最高地点を強調（金色のビーコン）
    const pk = g.field.max;
    const pkr = project(pk.x, pk.y, pk.h);
    const pkBase = project(pk.x, pk.y, e.gmin);
    ctx.strokeStyle = 'rgba(200,146,10,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pkBase.sx, pkBase.sy);
    ctx.lineTo(pkr.sx, pkr.sy);
    ctx.stroke();
    const pp = (e.t % 1.4) / 1.4;
    ctx.strokeStyle = `rgba(200,146,10,${0.6 * (1 - pp)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pkr.sx, pkr.sy, 6 + pp * 22, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = COL.peak;
    drawTriangle(pkr.sx, pkr.sy - 4, 8);
    ctx.fill();

    if (masking) ctx.restore();

    drawHud(ep.h, g.field.max.h);

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
