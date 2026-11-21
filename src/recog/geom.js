// 笔画几何。一个笔画是一串点 {x, y}（真人输入还带 t 毫秒），一个符是若干笔画。
// 合成样本、点云、栅格化、图纸拟合、朱笔判定都用这里的小工具。

export const STEP = 0.012; // 合成笔画的点距；符的边长约为 1

export function line(x0, y0, x1, y1, step = STEP) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step) + 1);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    s[i] = { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
  }
  return s;
}

// 折线：pts 为 [[x, y], ...]。step 为点距（默认按边长约 1 的符；画地图上的大景物时传大一些）
export function poly(pts, closed = false, step = STEP) {
  const P = closed ? [...pts, pts[0]] : pts;
  const s = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const seg = line(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], step);
    if (s.length) seg.shift();
    for (const p of seg) s.push(p);
  }
  return s;
}

// 椭圆弧：从角 a0 走到 a1（弧度，可超过一圈），rot 为整体转角
export function arc(cx, cy, rx, ry, a0, a1, rot = 0, step = STEP) {
  const len = Math.abs(a1 - a0) * (Math.abs(rx) + Math.abs(ry)) / 2;
  const n = Math.max(3, Math.ceil(len / step) + 1);
  const c = Math.cos(rot), sn = Math.sin(rot);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * i / (n - 1);
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    s[i] = { x: cx + x * c - y * sn, y: cy + x * sn + y * c };
  }
  return s;
}

// 平滑曲线：Catmull-Rom 穿过各控制点；corners 里的下标处是尖角
export function curve(pts, { closed = false, corners = [], step = STEP } = {}) {
  const P = pts.map(([x, y]) => ({ x, y }));
  if (closed && corners.length) {
    // 从一个尖角起头，改成首尾都是这个尖角的开曲线
    const k = Math.min(...corners), n = P.length;
    const Q = [...P.slice(k), ...P.slice(0, k), P[k]];
    const C = new Set(corners.map(i => (i - k + n) % n));
    C.add(Q.length - 1);
    return spline(Q, C, false, step);
  }
  return spline(P, new Set(corners), closed, step);
}

function spline(P, C, wrap, step = STEP) {
  const n = P.length, out = [];
  if (n < 2) return P.slice();
  const get = i => (wrap ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  const sharp = i => !wrap && (C.has(i) || i <= 0 || i >= n - 1);
  const segs = wrap ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = get(i), p2 = get(i + 1);
    const p0 = sharp(i) ? p1 : get(i - 1);
    const p3 = sharp(i + 1) ? p2 : get(i + 2);
    const m = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step * 1.3) + 1);
    for (let j = i === 0 ? 0 : 1; j < m; j++) {
      const t = j / (m - 1), t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

// 横向波浪线
export function wave(x0, x1, y, amp, periods, phase = 0) {
  const n = Math.max(8, Math.ceil(Math.abs(x1 - x0) * (1 + amp * periods * 6) / STEP) + 1);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    s[i] = { x: x0 + (x1 - x0) * t, y: y + amp * Math.sin(phase + 2 * Math.PI * periods * t) };
  }
  return s;
}

export function bbox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0, cx: 0, cy: 0 };
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export const mapStrokes = (strokes, f) => strokes.map(s => s.map(f));

// x' = a·x + b·y + e，y' = c·x + d·y + f
export const affine = (strokes, a, b, c, d, e = 0, f = 0) =>
  mapStrokes(strokes, p => ({ x: a * p.x + b * p.y + e, y: c * p.x + d * p.y + f }));

export function rotateAbout(strokes, ang, cx, cy) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return mapStrokes(strokes, p => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }));
}

export const mirrorX = strokes => mapStrokes(strokes, p => ({ x: 1 - p.x, y: p.y }));

// 等比缩放并居中放进框里
export function fit(strokes, x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
  const b = bbox(strokes);
  const s = Math.min((x1 - x0) / (b.w || 1e-9), (y1 - y0) / (b.h || 1e-9));
  const ox = (x0 + x1) / 2 - b.cx * s, oy = (y0 + y1) / 2 - b.cy * s;
  return mapStrokes(strokes, p => ({ x: p.x * s + ox, y: p.y * s + oy }));
}

export function length(s) {
  let L = 0;
  for (let i = 1; i < s.length; i++) L += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  return L;
}

// 沿笔画等距取 n 个点
export function resample(s, n) {
  if (s.length === 0) return [];
  if (s.length === 1 || n === 1) return Array.from({ length: n }, () => ({ x: s[0].x, y: s[0].y }));
  const L = length(s);
  if (L === 0) return Array.from({ length: n }, () => ({ x: s[0].x, y: s[0].y }));
  const step = L / (n - 1), out = [{ x: s[0].x, y: s[0].y }];
  let acc = 0, prev = s[0];
  for (let i = 1; i < s.length && out.length < n; i++) {
    let cur = s[i];
    let d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(q);
      prev = q; d = Math.hypot(cur.x - prev.x, cur.y - prev.y); acc = 0;
    }
    acc += d; prev = cur;
  }
  const last = s[s.length - 1];
  while (out.length < n) out.push({ x: last.x, y: last.y });
  return out;
}

export const flat = strokes => strokes.flat();

// 两线段相交：返回交点和两边的参数 t、u（0..1），不相交返回 null
export function segIntersect(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + rx * t, y: a.y + ry * t, t, u };
}

// 两条折线的全部交点（i、j 为线段下标）
export function crossings(A, B) {
  const out = [];
  for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) {
    const q = segIntersect(A[i - 1], A[i], B[j - 1], B[j]);
    if (q) out.push({ ...q, i: i - 1, j: j - 1 });
  }
  return out;
}

// 主方向：返回质心、主轴角（弧度，0 为水平）、主次轴的标准差
export function pca(points) {
  const n = points.length || 1;
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n; syy /= n; sxy /= n;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  return { cx, cy, angle, major: Math.sqrt(Math.max(0, tr / 2 + disc)), minor: Math.sqrt(Math.max(0, tr / 2 - disc)) };
}

// 直不直：首尾距离 / 路径长（1 为笔直）
export function straightness(s) {
  const L = length(s);
  if (L === 0) return 1;
  return Math.hypot(s[s.length - 1].x - s[0].x, s[s.length - 1].y - s[0].y) / L;
}

// 闭不闭：首尾缺口 / 路径长（0 为完全闭合）
export function gapRatio(s) {
  const L = length(s);
  if (L === 0) return 1;
  return Math.hypot(s[s.length - 1].x - s[0].x, s[s.length - 1].y - s[0].y) / L;
}

// 点到线段距离
export function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

export function distToPolyline(p, s) {
  if (s.length === 1) return Math.hypot(p.x - s[0].x, p.y - s[0].y);
  let best = Infinity;
  for (let i = 1; i < s.length; i++) best = Math.min(best, distToSeg(p, s[i - 1], s[i]));
  return best;
}

// 多边形面积（鞋带公式，取绝对值）
export function area(s) {
  let A = 0;
  for (let i = 0, j = s.length - 1; i < s.length; j = i++) A += (s[j].x + s[i].x) * (s[j].y - s[i].y);
  return Math.abs(A) / 2;
}

export function pointInPolygon(p, s) {
  let inside = false;
  for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
    const a = s[i], b = s[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
