// 栅格化：笔画 → size×size 灰度（0 白，1 墨）。Node 训练和浏览器识别用同一份代码，
// 所以模型看到的图和训练时一模一样；线宽按格子算，和人在屏幕上写多大、笔多粗无关。
// 等比缩放（保留高扁），居中，四周留边。

export const SIZE = 32;

export function rasterize(strokes, size = SIZE, { margin = 2.5, width = 1.0, out } = {}) {
  const img = out || new Float32Array(size * size);
  img.fill(0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return img;
  const w = x1 - x0, h = y1 - y0, span = Math.max(w, h, 1e-9);
  const sc = (size - 2 * margin) / span;
  const ox = (size - w * sc) / 2 - x0 * sc, oy = (size - h * sc) / 2 - y0 * sc;
  const R = width; // 半宽（像素）
  for (const s of strokes) {
    if (!s.length) continue;
    let ax = s[0].x * sc + ox, ay = s[0].y * sc + oy;
    if (s.length === 1) { seg(img, size, ax, ay, ax, ay, R * 1.3); continue; }
    for (let i = 1; i < s.length; i++) {
      const bx = s[i].x * sc + ox, by = s[i].y * sc + oy;
      seg(img, size, ax, ay, bx, by, R);
      ax = bx; ay = by;
    }
  }
  return img;
}

// 一段有宽度的线：像素中心到线段的距离 d，墨色 = clamp(R + 0.5 − d)，与已有墨取大
function seg(img, size, ax, ay, bx, by, R) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - R - 1)), maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + R + 1));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - R - 1)), maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by) + R + 1));
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - ax - dx * t, ey = py - ay - dy * t;
      const v = R + 0.5 - Math.sqrt(ex * ex + ey * ey);
      if (v > 0) {
        const i = y * size + x, c = v > 1 ? 1 : v;
        if (c > img[i]) img[i] = c;
      }
    }
  }
}
