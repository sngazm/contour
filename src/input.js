// フローティング仮想スティック（タッチした場所を中心に引っ張る）。
// デスクトップはドラッグ + WASD/矢印にも対応。座標は CSS ピクセル。
import { clamp } from './util.js';

export function createInput(target) {
  const MAXR = 64; // スティックの最大引っ張り半径(px)
  const s = {
    active: false,
    ox: 0, oy: 0, // 中心
    px: 0, py: 0, // 現在の指/カーソル位置（描画用にクランプ前）
    dx: 0, dy: 0, // 正規化方向
    mag: 0,       // 0..1
    keys: new Set(),
    everPressed: false,
  };

  function setFrom(cx, cy) {
    let vx = cx - s.ox;
    let vy = cy - s.oy;
    const len = Math.hypot(vx, vy);
    if (len > 0.0001) {
      s.dx = vx / len;
      s.dy = vy / len;
      s.mag = clamp(len / MAXR, 0, 1);
      const cl = Math.min(len, MAXR);
      s.px = s.ox + s.dx * cl;
      s.py = s.oy + s.dy * cl;
    } else {
      s.dx = s.dy = s.mag = 0;
      s.px = s.ox;
      s.py = s.oy;
    }
  }

  const pos = (e) => {
    const r = target.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return [p.clientX - r.left, p.clientY - r.top];
  };

  function down(e) {
    e.preventDefault();
    const [x, y] = pos(e);
    s.active = true;
    s.everPressed = true;
    s.ox = x; s.oy = y;
    setFrom(x, y);
  }
  function move(e) {
    if (!s.active) return;
    e.preventDefault();
    const [x, y] = pos(e);
    setFrom(x, y);
  }
  function up(e) {
    s.active = false;
    s.dx = s.dy = s.mag = 0;
  }

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  target.style.touchAction = 'none';

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      s.keys.add(k);
      s.everPressed = true;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => s.keys.delete(e.key.toLowerCase()));

  // 移動ベクトルを返す。{x,y,mag,active(描画用),ox,oy,px,py}
  function read() {
    if (s.active && s.mag > 0) {
      return { x: s.dx, y: s.dy, mag: s.mag, active: true, ox: s.ox, oy: s.oy, px: s.px, py: s.py };
    }
    // キーボード
    let kx = 0, ky = 0;
    if (s.keys.has('arrowleft') || s.keys.has('a')) kx -= 1;
    if (s.keys.has('arrowright') || s.keys.has('d')) kx += 1;
    if (s.keys.has('arrowup') || s.keys.has('w')) ky -= 1;
    if (s.keys.has('arrowdown') || s.keys.has('s')) ky += 1;
    const l = Math.hypot(kx, ky);
    if (l > 0) return { x: kx / l, y: ky / l, mag: 1, active: false };
    return { x: 0, y: 0, mag: 0, active: false };
  }

  return { read, state: s };
}
