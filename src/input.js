// フローティング仮想スティック（タッチした場所を中心に引っ張る）＋
// 2本指ピンチ / ホイールでのズーム。座標は CSS ピクセル。
import { clamp } from './util.js';

export function createInput(target) {
  const MAXR = 64; // スティックの最大引っ張り半径(px)
  const s = {
    active: false,
    ox: 0, oy: 0,
    px: 0, py: 0,
    dx: 0, dy: 0,
    mag: 0,
    keys: new Set(),
    everPressed: false,
    pinch: 1, // 前回 consume 以降のズーム倍率(>1で拡大=遠くが見える)
  };

  const pointers = new Map(); // pointerId -> {x,y}
  let joyId = null;
  let pinchLast = 0;

  const rel = (e) => {
    const r = target.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function setFrom(cx, cy) {
    const vx = cx - s.ox;
    const vy = cy - s.oy;
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
      s.px = s.ox; s.py = s.oy;
    }
  }

  function pinchDist() {
    const v = [...pointers.values()];
    if (v.length < 2) return 0;
    return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
  }

  function down(e) {
    e.preventDefault();
    const [x, y] = rel(e);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size >= 2) {
      // ピンチ開始：スティックは止める
      s.active = false; s.dx = s.dy = s.mag = 0; joyId = null;
      pinchLast = pinchDist();
    } else {
      joyId = e.pointerId;
      s.active = true;
      s.everPressed = true;
      s.ox = x; s.oy = y;
      setFrom(x, y);
    }
  }

  function move(e) {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    const [x, y] = rel(e);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size >= 2) {
      const d = pinchDist();
      if (pinchLast > 0 && d > 0) s.pinch *= d / pinchLast;
      pinchLast = d;
    } else if (s.active && e.pointerId === joyId) {
      setFrom(x, y);
    }
  }

  function up(e) {
    pointers.delete(e.pointerId);
    if (e.pointerId === joyId) {
      s.active = false; s.dx = s.dy = s.mag = 0; joyId = null;
    }
    if (pointers.size < 2) pinchLast = 0;
  }

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  target.style.touchAction = 'none';

  // ホイールでズーム（PC）。下方向スクロールで縮小=近づく。
  target.addEventListener('wheel', (e) => {
    e.preventDefault();
    s.pinch *= Math.exp(e.deltaY * 0.0015);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      s.keys.add(k); s.everPressed = true; e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => s.keys.delete(e.key.toLowerCase()));

  function read() {
    if (s.active && s.mag > 0) {
      return { x: s.dx, y: s.dy, mag: s.mag, active: true, ox: s.ox, oy: s.oy, px: s.px, py: s.py };
    }
    let kx = 0, ky = 0;
    if (s.keys.has('arrowleft') || s.keys.has('a')) kx -= 1;
    if (s.keys.has('arrowright') || s.keys.has('d')) kx += 1;
    if (s.keys.has('arrowup') || s.keys.has('w')) ky -= 1;
    if (s.keys.has('arrowdown') || s.keys.has('s')) ky += 1;
    const l = Math.hypot(kx, ky);
    if (l > 0) return { x: kx / l, y: ky / l, mag: 1, active: false };
    return { x: 0, y: 0, mag: 0, active: false };
  }

  // ズーム倍率を取り出してリセット（1.0=変化なし）
  function consumePinch() {
    const p = s.pinch;
    s.pinch = 1;
    return p;
  }

  return { read, consumePinch, state: s };
}
