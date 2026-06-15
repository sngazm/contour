// プロトタイプ 01 — 等高線 / 円窓 / 斜面の重さ / 30秒後の俯瞰リプレイ
import { clamp, easeInOut, easeOut, TAU, elevColor, rgba } from './util.js';
import { makeTerrain, HEIGHT_SCALE } from './terrain.js';
import { contourLevel, levelsFor } from './contours.js';
import { createInput } from './input.js';

const CFG = {
  DURATION: 30,          // 1ゲームの長さ(秒)
  VIEW_RADIUS_WORLD: 235, // 円窓の中心→縁が示すワールド距離
  GRID_N: 64,            // 等高線サンプルの格子解像度
  CONTOUR_STEP: 0.058,   // 等高線の間隔(高さ -1..1 空間)
  BASE_SPEED: 98,        // 平地の移動速度(ワールド単位/秒)
  UPHILL_K: 115,         // 斜面が速度に効く強さ
  SPEED_MIN: 0.16,       // 急登での下限係数
  SPEED_MAX: 1.7,        // 下りでの上限係数
  PATH_MIN_STEP: 5,      // 軌跡を記録する最小移動距離
};

const BG = '#0a0d13';

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
  const grid = new Float32Array(CFG.GRID_N * CFG.GRID_N);
  const grad = { x: 0, y: 0 };

  let game;
  let wantRestart = false;
  canvas.addEventListener('pointerdown', () => { wantRestart = true; });

  function newGame() {
    const seed = (Math.random() * 1e9) >>> 0;
    const terrain = makeTerrain(seed);
    game = {
      terrain,
      state: 'ready',         // ready -> play -> end
      time: 0,                // 経過(秒)
      px: 0, py: 0,           // プレイヤーのワールド座標（原点開始）
      start: { x: 0, y: 0 },
      path: [{ x: 0, y: 0, h: terrain.height(0, 0) }],
      readyPulse: 0,
      end: null,
    };
    input.state.everPressed = false;
    wantRestart = false;
  }
  newGame();

  // ---- 更新 ----------------------------------------------------------------
  function update(dt) {
    const g = game;
    if (g.state === 'ready') {
      g.readyPulse += dt;
      const mv = input.read();
      if (mv.mag > 0) g.state = 'play';
      return;
    }
    if (g.state === 'play') {
      g.time += dt;
      const mv = input.read();
      if (mv.mag > 0) {
        g.terrain.gradient(g.px, g.py, grad);
        const along = grad.x * mv.x + grad.y * mv.y; // +で登り
        let f = clamp(1 - along * CFG.UPHILL_K, CFG.SPEED_MIN, CFG.SPEED_MAX);
        const sp = CFG.BASE_SPEED * f * mv.mag * dt;
        g.px += mv.x * sp;
        g.py += mv.y * sp;
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
      if (g.end.t > 1.8 && wantRestart) newGame();
    }
  }

  function beginEnd() {
    const g = game;
    const last = g.path[g.path.length - 1];
    if (Math.hypot(g.px - last.x, g.py - last.y) > 0.5) {
      g.path.push({ x: g.px, y: g.py, h: g.terrain.height(g.px, g.py) });
    }
    // 軌跡の範囲を求めて、余白を足した俯瞰領域を作る
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of g.path) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    let span = Math.max(maxX - minX, maxY - minY, 400);
    const pad = span * 0.45;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const half = span / 2 + pad;
    const region = { cx, cy, half };

    // 地形を一度だけサンプリング（以後は投影だけ毎フレーム）
    const CX = 132, RY = 96;
    const heights = new Float32Array(CX * RY);
    let gmin = Infinity, gmax = -Infinity;
    for (let r = 0; r < RY; r++) {
      const wy = cy - half + (2 * half) * (r / (RY - 1));
      for (let c = 0; c < CX; c++) {
        const wx = cx - half + (2 * half) * (c / (CX - 1));
        const hh = g.terrain.height(wx, wy);
        heights[r * CX + c] = hh;
        if (hh < gmin) gmin = hh;
        if (hh > gmax) gmax = hh;
      }
    }
    g.end = { t: 0, region, heights, CX, RY, gmin, gmax };
    g.state = 'end';
    wantRestart = false;
  }

  // ---- 描画: トップダウン（円窓） -----------------------------------------
  function gridIndexToScreen(gx, gy, cell, cx, cy, ppu) {
    return [
      cx + (gx * cell - CFG.VIEW_RADIUS_WORLD) * ppu,
      cy + (gy * cell - CFG.VIEW_RADIUS_WORLD) * ppu,
    ];
  }

  function renderPlay() {
    const g = game;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.46;
    const ppu = R / CFG.VIEW_RADIUS_WORLD;
    const VR = CFG.VIEW_RADIUS_WORLD;
    const N = CFG.GRID_N;
    const cell = (2 * VR) / (N - 1);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // 円窓クリップ
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    // レンズ内の下地
    ctx.fillStyle = '#0f141d';
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    // 高さ格子をサンプリング
    let gmin = Infinity, gmax = -Infinity;
    for (let j = 0; j < N; j++) {
      const wy = g.py - VR + j * cell;
      for (let i = 0; i < N; i++) {
        const wx = g.px - VR + i * cell;
        const h = g.terrain.height(wx, wy);
        grid[j * N + i] = h;
        if (h < gmin) gmin = h;
        if (h > gmax) gmax = h;
      }
    }

    // 見えている範囲のレベルだけ描く
    const levels = levelsFor(gmin, gmax, CFG.CONTOUR_STEP);
    for (const lv of levels) {
      const major = Math.round(lv / CFG.CONTOUR_STEP) % 5 === 0;
      const col = elevColor(lv);
      ctx.strokeStyle = rgba(col, major ? 0.95 : 0.5);
      ctx.lineWidth = major ? 1.7 : 1;
      ctx.beginPath();
      contourLevel(grid, N, N, lv, (x0, y0, x1, y1) => {
        const [sx0, sy0] = gridIndexToScreen(x0, y0, cell, cx, cy, ppu);
        const [sx1, sy1] = gridIndexToScreen(x1, y1, cell, cx, cy, ppu);
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy1);
      });
      ctx.stroke();
    }

    // ふちのビネット
    const vg = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    vg.addColorStop(0, 'rgba(10,13,19,0)');
    vg.addColorStop(1, 'rgba(10,13,19,0.85)');
    ctx.fillStyle = vg;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    ctx.restore();

    // レンズの縁
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(220,228,240,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    // 残り時間リング（上から時計回りに減る）
    if (g.state === 'play') {
      const remain = clamp(1 - g.time / CFG.DURATION, 0, 1);
      const warm = g.time / CFG.DURATION > 0.8;
      ctx.lineWidth = 3;
      ctx.strokeStyle = warm ? 'rgba(235,150,110,0.9)' : 'rgba(225,232,245,0.65)';
      ctx.beginPath();
      ctx.arc(cx, cy, R + 7, -Math.PI / 2, -Math.PI / 2 + remain * TAU);
      ctx.stroke();
    }

    // プレイヤー（常に中央）
    const mv = input.read();
    let pulse = 1;
    if (g.state === 'ready') pulse = 1 + 0.12 * Math.sin(g.readyPulse * 4);
    ctx.fillStyle = 'rgba(245,248,255,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 7 * pulse, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,248,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 13 * pulse, 0, TAU);
    ctx.stroke();
    if (mv.mag > 0) {
      ctx.strokeStyle = 'rgba(245,248,255,0.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + mv.x * 22, cy + mv.y * 22);
      ctx.stroke();
    }

    // ready: 始動を促すパルス（言葉なし）
    if (g.state === 'ready') {
      const pr = (g.readyPulse % 1.6) / 1.6;
      ctx.strokeStyle = `rgba(245,248,255,${0.5 * (1 - pr)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 13 + pr * 40, 0, TAU);
      ctx.stroke();
    }

    // フローティングスティックの表示
    if (mv.active) {
      ctx.strokeStyle = 'rgba(245,248,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mv.ox, mv.oy, 64, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(245,248,255,0.55)';
      ctx.beginPath();
      ctx.arc(mv.px, mv.py, 18, 0, TAU);
      ctx.fill();
    }
  }

  // ---- 描画: 斜め俯瞰のリプレイ ------------------------------------------
  function renderEnd() {
    const g = game;
    const e = g.end;
    const { cx, cy, half } = e.region;

    // 背景（上ほど暗く）
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#070a10');
    bgGrad.addColorStop(1, '#0e131c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const intro = clamp(e.t / 2.6, 0, 1);
    const tilt = easeInOut(intro) * 1.02;        // 0(真上)→約58度
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const zoom = 0.84 + 0.16 * easeOut(intro);
    const scale = (Math.min(W, H) * 0.78) / (2 * half) * zoom;
    const ox = W / 2;
    const oy = H * 0.52 + half * scale * st * 0.5; // 持ち上がる分を中央寄せ
    const EXAG = 1.25;

    const project = (wx, wy, h) => {
      const X = wx - cx;
      const Y = wy - cy;
      const hz = h * HEIGHT_SCALE * EXAG;
      return [ox + X * scale, oy + Y * scale * ct - hz * scale * st];
    };

    // 地形を尾根線で描く（奥→手前、隠面消去のため下を塗りつぶす）
    const { heights, CX, RY } = e;
    const baseY = H + 40;
    for (let r = 0; r < RY; r++) {
      const wy = cy - half + (2 * half) * (r / (RY - 1));
      let sumH = 0;
      ctx.beginPath();
      for (let c = 0; c < CX; c++) {
        const wx = cx - half + (2 * half) * (c / (CX - 1));
        const h = heights[r * CX + c];
        sumH += h;
        const [sx, sy] = project(wx, wy, h);
        if (c === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      // 下端まで閉じて背景色で塗り、奥の線を隠す
      const lastX = project(cx + half, wy, 0)[0];
      const firstX = project(cx - half, wy, 0)[0];
      ctx.lineTo(lastX, baseY);
      ctx.lineTo(firstX, baseY);
      ctx.closePath();
      ctx.fillStyle = '#0b0f17';
      ctx.fill();

      const col = elevColor(sumH / CX);
      ctx.strokeStyle = rgba(col, 0.9 * intro + 0.1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c < CX; c++) {
        const wx = cx - half + (2 * half) * (c / (CX - 1));
        const h = heights[r * CX + c];
        const [sx, sy] = project(wx, wy, h);
        if (c === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // 軌跡（地形の上に発光線で）
    ctx.save();
    ctx.shadowColor = 'rgba(120,200,255,0.9)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(150,210,255,0.95)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < g.path.length; i++) {
      const p = g.path[i];
      const [sx, sy] = project(p.x, p.y, p.h);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();

    // スタート地点（小さな輪）
    const sp = g.path[0];
    const [ssx, ssy] = project(sp.x, sp.y, sp.h);
    ctx.strokeStyle = 'rgba(245,248,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ssx, ssy, 7, 0, TAU);
    ctx.stroke();

    // 到達地点：高さを示す縦線 + 脈打つ点
    const ep = g.path[g.path.length - 1];
    const [esx, esy] = project(ep.x, ep.y, ep.h);
    const [bx, by] = project(ep.x, ep.y, e.gmin); // 最低標高まで落とした基準線
    ctx.strokeStyle = 'rgba(255,210,140,0.5)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(esx, esy);
    ctx.stroke();
    ctx.setLineDash([]);

    const pr = 1 + 0.25 * Math.sin(e.t * 5);
    ctx.fillStyle = 'rgba(255,222,160,0.95)';
    ctx.shadowColor = 'rgba(255,200,120,0.9)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(esx, esy, 7 * pr, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    // リスタートを促す微かなパルス（イントロ後・言葉なし）
    if (e.t > 1.8) {
      const rp = (e.t % 1.8) / 1.8;
      ctx.strokeStyle = `rgba(245,248,255,${0.4 * (1 - rp)})`;
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
    if (dt > 0.05) dt = 0.05; // タブ復帰などの大ジャンプを抑制
    update(dt);
    if (game.state === 'end') renderEnd();
    else renderPlay();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
