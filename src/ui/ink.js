// 纸面绘制的小工具：画布适配高清屏、宣纸底、墨笔（随速度变粗细）、铅笔、朱笔、符圈。

export const COLORS = {
  paper: '#f3ebd8', paperDeep: '#e8dcc0', ink: '#1f1b17', inkSoft: 'rgba(31,27,23,0.35)',
  pencil: '#5d5850', red: '#b3322a', redSoft: 'rgba(179,50,42,0.25)', blue: '#1d4c8a', gold: '#c99a2e',
};

// 让画布按 CSS 尺寸 × 设备像素比出图；返回 { ctx, w, h }（CSS 像素）
export function fitCanvas(canvas) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

// 宣纸：底色、纤维、几处淡淡的水渍。seed 固定，每次画出来一样。
export function paper(ctx, w, h, seed = 7) {
  let a = seed;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = rnd() * w, y = rnd() * h, r = 60 + rnd() * 220;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(214,196,160,0.18)');
    g.addColorStop(1, 'rgba(214,196,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.strokeStyle = 'rgba(160,140,110,0.10)';
  ctx.lineWidth = 0.6;
  const n = Math.round(w * h / 9000);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, l = 4 + rnd() * 14, t = rnd() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(t) * l * 0.5 + rnd() * 3, y + Math.sin(t) * l * 0.5 + rnd() * 3, x + Math.cos(t) * l, y + Math.sin(t) * l);
    ctx.stroke();
  }
}

// 墨笔：越快越细，起收笔略尖。pts 带 t（毫秒）时按速度算粗细；没有 t 时等粗。
export function inkStroke(ctx, pts, { width = 4, color = COLORS.ink, alpha = 1 } = {}) {
  if (!pts.length) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  let prevW = width * 0.7;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = a.t != null && b.t != null ? Math.max(1, b.t - a.t) : 16;
    const v = d / dt;
    let w = width * Math.max(0.55, Math.min(1.3, 1.3 - v * 0.28));
    const edge = Math.min(i, pts.length - i);
    if (edge < 4) w *= 0.7 + edge * 0.075;
    w = prevW + (w - prevW) * 0.35;
    prevW = w;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

// 铅笔：细、灰、略带颗粒
export function pencilStroke(ctx, pts, { width = 1.6, color = COLORS.pencil, alpha = 0.9, dash = null } = {}) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  for (const [ox, oy, a, w] of [[0, 0, alpha, width], [0.6, 0.4, alpha * 0.35, width * 0.8]]) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0].x + ox, pts[0].y + oy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + ox, pts[i].y + oy);
    ctx.stroke();
  }
  ctx.restore();
}

export function polyline(ctx, pts, { width = 3, color = COLORS.red, alpha = 1, dash = null, close = false } = {}) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// 符圈：淡淡的虚线圈；progress 为收笔倒计时（0..1），label 为圈下的小字
export function ring(ctx, { cx, cy, r }, { progress = 0, label = '', color = COLORS.ink } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (progress > 0) {
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
  }
  if (label) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = color;
    ctx.font = '12px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r + 16);
  }
  ctx.restore();
}

// 虚影：符名的大字，淡淡浮在符圈上
export function ghostText(ctx, text, x, y, { size = 42, alpha = 0.3, color = COLORS.ink } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${size}px "Noto Serif SC", "Source Han Serif SC", "Songti SC", STSong, SimSun, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// 一组笔画（单位框里的）画进一个小方块：手册里的标准写法、样本缩略图
export function thumb(ctx, strokes, x, y, size, { pad = 0.14, width = 2, color = COLORS.ink } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (x0 === Infinity) return;
  const span = Math.max(x1 - x0, y1 - y0) || 1, k = size * (1 - 2 * pad) / span;
  const ox = x + size / 2 - (x0 + x1) / 2 * k, oy = y + size / 2 - (y0 + y1) / 2 * k;
  for (const s of strokes) inkStroke(ctx, s.map(p => ({ x: p.x * k + ox, y: p.y * k + oy })), { width, color });
}
