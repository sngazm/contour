// プロトタイプ 01 — 等高線 / 円窓 / 斜面の重さ / 30秒後の俯瞰リプレイ
import { clamp, lerp, easeInOut, easeOut, TAU, rgba } from '../../src/util.js';
import { makeTerrain, HEIGHT_SCALE } from '../../src/terrain.js';
import { contourLevel, levelsFor } from '../../src/contours.js';
import { createInput } from '../../src/input.js';

const CFG = {
  DURATION: 30,           // 1ゲームの長さ(秒)
  VIEW_RADIUS_WORLD: 235, // 円窓の中心→縁が示すワールド距離
  CELL: 7,                // ワールド固定格子のセル幅(等高線のうねり防止)
  CONTOUR_STEP: 0.03,     // 等高線の間隔(高さ 0..1)
  BASE_SPEED: 100,        // 平地の移動速度(ワールド単位/秒)
  UPHILL_K: 300,          // 斜面が速度に効く強さ
  SPEED_MIN: 0.16,        // 急登での下限係数
  SPEED_MAX: 1.7,         // 下りでの上限係数
  PATH_MIN_STEP: 5,       // 軌跡を記録する最小移動距離
  FIELD_R: 1500,          // フィールド(ステージ)の半径。これが最高地点の探索範囲
};

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
};

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
  const grad = { x: 0, y: 0 };

  let game;
  let endDrag = null; // リザルトでの orbit/タップ判定

  function newGame() {
    const seed = (Math.random() * 1e9) >>> 0;
    const terrain = makeTerrain(seed);
    game = {
      terrain,
      field: { r: CFG.FIELD_R, max: findFieldMax(terrain, CFG.FIELD_R) },
      state: 'ready',
      time: 0,
      px: 0, py: 0,
      path: [{ x: 0, y: 0, h: terrain.height(0, 0) }],
      readyPulse: 0,
      end: null,
    };
    input.state.everPressed = false;
    endDrag = null;
  }
  newGame();

  // リザルトのカメラ操作（ドラッグでorbit、タップで再挑戦）
  canvas.addEventListener('pointerdown', (e) => {
    if (game.state === 'end') endDrag = { x: e.clientX, y: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (game.state !== 'end' || !endDrag) return;
    const dx = e.clientX - endDrag.x;
    const dy = e.clientY - endDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) endDrag.moved = true;
    const cam = game.end.cam;
    cam.yaw += dx * 0.006;
    cam.tiltOff = clamp(cam.tiltOff - dy * 0.004, -0.45, 0.5);
    cam.touched = true;
    endDrag.x = e.clientX;
    endDrag.y = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    if (game.state === 'end' && endDrag) {
      if (!endDrag.moved && game.end.t > 2.2) newGame();
      endDrag = null;
    }
  });

  // ---- 更新 ----------------------------------------------------------------
  function update(dt) {
    const g = game;
    if (g.state === 'ready') {
      g.readyPulse += dt;
      if (input.read().mag > 0) g.state = 'play';
      return;
    }
    if (g.state === 'play') {
      g.time += dt;
      const mv = input.read();
      if (mv.mag > 0) {
        g.terrain.gradient(g.px, g.py, grad);
        const along = grad.x * mv.x + grad.y * mv.y; // +で登り
        const f = clamp(1 - along * CFG.UPHILL_K, CFG.SPEED_MIN, CFG.SPEED_MAX);
        const sp = CFG.BASE_SPEED * f * mv.mag * dt;
        g.px += mv.x * sp;
        g.py += mv.y * sp;
        const d = Math.hypot(g.px, g.py); // フィールド外には出られない
        if (d > g.field.r) { g.px *= g.field.r / d; g.py *= g.field.r / d; }
        const last = g.path[g.path.length - 1];
        if (Math.hypot(g.px - last.x, g.py - last.y) >= CFG.PATH_MIN_STEP) {
          g.path.push({ x: g.px, y: g.py, h: g.terrain.height(g.px, g.py) });
        }
      }
      if (g.time >= CFG.DURATION) beginEnd();
      return;
    }
    if (g.state === 'end') {
      g.end.t += dt;
      // 未操作なら、イントロ後にゆっくり自動オービット
      if (!g.end.cam.touched && g.end.t > 3.0) g.end.cam.yaw += 0.09 * dt;
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
      cam: { yaw: 0, tiltOff: 0, touched: false },
    };
    g.state = 'end';
    endDrag = null;
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
    const VR = CFG.VIEW_RADIUS_WORLD;
    const CELL = CFG.CELL;
    const ppu = R / VR;

    ctx.fillStyle = COL.out;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = COL.lens;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    // ワールドに固定した格子をサンプリング（視点移動でうねらない）
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

    // プレイヤー（中央固定）
    const mv = input.read();
    const pulse = g.state === 'ready' ? 1 + 0.12 * Math.sin(g.readyPulse * 4) : 1;
    ctx.fillStyle = '#26251f';
    ctx.beginPath();
    ctx.arc(cx, cy, 7 * pulse, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(38,37,31,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 13 * pulse, 0, TAU);
    ctx.stroke();
    if (mv.mag > 0) {
      ctx.strokeStyle = '#26251f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + mv.x * 22, cy + mv.y * 22);
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
    const scale = lerp(startScale, fitScale, k);
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
