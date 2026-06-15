// マーチングスクエア法で等高線セグメントを取り出す。
// grid: Float32Array(nx*ny)、(i,j) は grid[j*nx + i]。
// emit(x0,y0,x1,y1) には格子座標（小数可、0..nx-1 / 0..ny-1）で線分を渡す。

export function contourLevel(grid, nx, ny, level, emit) {
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = grid[j * nx + i];
      const b = grid[j * nx + i + 1];
      const c = grid[(j + 1) * nx + i + 1];
      const d = grid[(j + 1) * nx + i];

      let cs = 0;
      if (a >= level) cs |= 1;
      if (b >= level) cs |= 2;
      if (c >= level) cs |= 4;
      if (d >= level) cs |= 8;
      if (cs === 0 || cs === 15) continue;

      // 各辺の交点（必要なものだけ計算）
      const top = () => [i + (level - a) / (b - a), j];
      const right = () => [i + 1, j + (level - b) / (c - b)];
      const bottom = () => [i + (level - d) / (c - d), j + 1];
      const left = () => [i, j + (level - a) / (d - a)];

      const seg = (p, q) => emit(p[0], p[1], q[0], q[1]);

      switch (cs) {
        case 1: case 14: seg(left(), top()); break;
        case 2: case 13: seg(top(), right()); break;
        case 3: case 12: seg(left(), right()); break;
        case 4: case 11: seg(right(), bottom()); break;
        case 6: case 9: seg(top(), bottom()); break;
        case 7: case 8: seg(left(), bottom()); break;
        case 5: seg(left(), top()); seg(right(), bottom()); break;   // 鞍点
        case 10: seg(top(), right()); seg(bottom(), left()); break;  // 鞍点
      }
    }
  }
}

// 等間隔のレベル一覧（lo..hi を step 刻み、0 を含む位相）
export function levelsFor(lo, hi, step) {
  const out = [];
  const start = Math.ceil(lo / step) * step;
  for (let v = start; v <= hi; v += step) out.push(+v.toFixed(4));
  return out;
}
