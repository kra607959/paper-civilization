// 沙盘里的纸面世界：天、河、营地、树林、石堆、兽、空地（纸面坐标 1600×1000）。
// 景物都用神符同一套笔法画：林子里每棵树就是一个手写的「树」，营火是一个「火」。
import { symbolById } from '../recog/symbols.js';
import { makeRng, hashSeed } from '../recog/rng.js';
import { augment } from '../recog/synth.js';
import { distToPolyline, curve, arc, line, poly, bbox, pointInPolygon } from '../recog/geom.js';
import { inkStroke, polyline, COLORS } from '../ui/ink.js';

export const W = 1600, H = 1000, SKY = 170;
export const WS = 3; // 地图上景物的点距（纸面单位）：符的默认点距是按边长 1 定的，放到地图上会密出几万个点
export const NAMES = ['阿禾', '小杏', '石头', '阿木', '青禾', '阿岩', '小满', '老柯'];

// 单位框里的笔画 → 放到 (x, y)，边长 size
export function place(strokes, x, y, size) {
  const b = bbox(strokes), span = Math.max(b.w, b.h) || 1;
  return strokes.map(s => s.map(p => ({ x: x + (p.x - b.cx) / span * size, y: y + (p.y - b.cy) / span * size })));
}
export function handDrawn(id, seed, x, y, size, L = 0.45) {
  const r = makeRng(hashSeed('world', id, seed));
  return place(augment(symbolById(id).make(r), r, L), x, y, size);
}

export function figure(x, y, s = 1, pose = 0) {
  const arm = pose ? -10 : 6;
  return [
    arc(x, y - 30 * s, 5.5 * s, 5.5 * s, 0, Math.PI * 2, 0, WS),
    line(x, y - 24 * s, x, y - 8 * s, WS),
    line(x, y - 19 * s, x - 8 * s, y - 13 * s + arm * s, WS), line(x, y - 19 * s, x + 8 * s, y - 13 * s + arm * s, WS),
    line(x, y - 8 * s, x - 6 * s, y + 2 * s, WS), line(x, y - 8 * s, x + 6 * s, y + 2 * s, WS),
  ];
}

function shack(x, y, s = 1) {
  return [line(x - 30 * s, y, x + 2 * s, y - 38 * s, WS), line(x + 30 * s, y, x - 2 * s, y - 38 * s, WS), line(x - 34 * s, y + 1, x + 34 * s, y + 1, WS),
    curve([[x - 7 * s, y], [x - 6 * s, y - 13 * s], [x, y - 16 * s], [x + 6 * s, y - 13 * s], [x + 7 * s, y]], { step: WS })];
}

export function createWorld() {
  const river = curve([[330, SKY], [300, 330], [372, 520], [262, 720], [312, H]], { step: WS });
  const r = makeRng(hashSeed('world-layout'));
  const trees = [];
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4, rad = 30 + 26 * Math.sqrt(i);
    const x = 1130 + Math.cos(a) * rad * 1.5, y = 360 + Math.sin(a) * rad;
    trees.push({ x, y, strokes: handDrawn('shu', i, x, y, 64 + r() * 26), cut: false });
  }
  const rocks = [];
  for (let i = 0; i < 7; i++) {
    const cx = 1250 + (r() - 0.5) * 150, cy = 700 + (r() - 0.5) * 90, k = 14 + r() * 18, P = [];
    for (let j = 0; j < 7; j++) { const a = j / 7 * Math.PI * 2 + r() * 0.4; P.push([cx + Math.cos(a) * k * (0.8 + r() * 0.4), cy + Math.sin(a) * k * 0.7 * (0.8 + r() * 0.4)]); }
    rocks.push(poly(P, true, WS));
  }
  const camp = { x: 640, y: 560, r: 125 };
  const people = NAMES.map((name, i) => {
    const a = i / NAMES.length * Math.PI * 2 + 0.3;
    const x = camp.x + Math.cos(a) * 70, y = camp.y + Math.sin(a) * 42 + 20;
    return { name, x, y, hx: x, hy: y, tx: x, ty: y, path: null, task: '', pose: 0 };
  });
  const clouds = [[250, 70], [690, 50], [1180, 85], [1460, 45]].map(([x, y], i) => {
    const k = 2 + (i % 2), pts = [[x - 60, y + 14]], corners = [0];
    for (let j = 0; j < k; j++) { pts.push([x - 60 + (j + 0.5) * 120 / k, y - 22 - (j % 2) * 8]); pts.push([x - 60 + (j + 1) * 120 / k, y + (j === k - 1 ? 14 : 2)]); corners.push(pts.length - 1); }
    return curve(pts, { corners, step: WS });
  });
  return {
    river, trees, rocks, clouds, camp, people,
    fire: handDrawn('huo', 1, camp.x, camp.y + 4, 40),
    shacks: [shack(camp.x - 92, camp.y - 50), shack(camp.x + 96, camp.y - 46, 0.9)],
    hills: [handDrawn('shan', 3, 1420, 230, 150, 0.3), handDrawn('shan', 8, 760, 240, 120, 0.3)],
    beast: { x: 1440, y: 830, alive: true, flee: 0, press: null },
    marks: [], roads: [], lines: [], zones: [], reds: [],
    sky: 'day', // day | rain | night
  };
}

// 画在什么上面：符圈中心落在哪儿（兽 > 族人 > 树林 > 石堆 > 河 > 天 > 空地）
export function targetAt(world, p) {
  const b = world.beast;
  if (b.alive && Math.hypot(p.x - b.x, p.y - b.y) < 75) return 'beast';
  if (Math.hypot(p.x - world.camp.x, p.y - world.camp.y) < world.camp.r) return 'folk';
  if (world.trees.some(t => !t.cut && Math.hypot(p.x - t.x, p.y - t.y) < 70)) return 'wood';
  if (Math.hypot(p.x - 1250, p.y - 700) < 110) return 'rock';
  if (p.y > SKY && distToPolyline(p, world.river) < 48) return 'river';
  if (p.y < SKY) return 'sky';
  return 'land';
}

export function inZone(world, p) {
  return world.zones.some(z => pointInPolygon(p, z.points));
}

// 景物（每帧画）
export function drawWorld(ctx, world, t) {
  // 天：一抹淡青，夜里压暗
  const g = ctx.createLinearGradient(0, 0, 0, SKY + 40);
  g.addColorStop(0, world.sky === 'rain' ? 'rgba(90,100,110,0.22)' : 'rgba(120,150,170,0.14)');
  g.addColorStop(1, 'rgba(120,150,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, SKY + 40);
  ctx.save();
  ctx.setLineDash([2, 7]);
  polyline(ctx, [{ x: 0, y: SKY }, { x: W, y: SKY }], { width: 1, color: COLORS.ink, alpha: 0.18 });
  ctx.restore();
  ctx.fillStyle = 'rgba(31,27,23,0.35)';
  ctx.font = `${16 * (world.ui || 1)}px "Noto Serif SC", SimSun, serif`;
  ctx.fillText('天', 18, 30);
  world.clouds.forEach((c, i) => { // 整朵云一起慢慢飘
    const dx = Math.sin(t / 4000 + i * 1.7) * 6;
    inkStroke(ctx, c.map(p => ({ x: p.x + dx, y: p.y })), { width: 2.4, alpha: world.sky === 'rain' ? 0.75 : 0.45 });
  });
  for (const h of world.hills) for (const s of h) inkStroke(ctx, s, { width: 2.2, alpha: 0.4 });
  // 河：一道淡墨水带，加几道水纹
  ctx.save();
  polyline(ctx, world.river, { width: 64, color: '#7c95a6', alpha: 0.18 });
  polyline(ctx, world.river, { width: 2, color: COLORS.ink, alpha: 0.25 });
  ctx.restore();
  for (let i = 8; i < world.river.length - 8; i += 22) {
    const p = world.river[i], ph = t / 700 + i;
    inkStroke(ctx, [0, 1, 2, 3, 4].map(k => ({ x: p.x - 14 + k * 7, y: p.y + 10 + Math.sin(ph + k) * 2.5 })), { width: 1.4, alpha: 0.35 });
  }
  // 路（铅笔）
  for (const r of world.roads) polyline(ctx, r.points, { width: 6, color: '#b7a988', alpha: 0.45 });
  // 林子
  for (const tr of world.trees) {
    if (tr.cut) { polyline(ctx, [{ x: tr.x - 8, y: tr.y + 26 }, { x: tr.x + 8, y: tr.y + 26 }], { width: 4, color: COLORS.ink, alpha: 0.6 }); continue; }
    if (tr.burnt) { for (const s of tr.strokes) inkStroke(ctx, s, { width: 2.4, color: '#5a5048', alpha: 0.35 }); continue; }
    for (const s of tr.strokes) inkStroke(ctx, s, { width: 2.6 });
  }
  // 石堆
  for (const s of world.rocks) inkStroke(ctx, s, { width: 2.2, alpha: 0.85 });
  // 营地
  for (const sh of world.shacks) for (const s of sh) inkStroke(ctx, s, { width: 2.4 });
  for (const s of world.fire) inkStroke(ctx, s.map(p => ({ x: p.x + Math.sin(t / 160 + p.y * 0.3) * 1.2, y: p.y })), { width: 2.4, color: '#7a2a1c' });
}

export function drawPeople(ctx, world, t) {
  for (const p of world.people) {
    const bob = Math.sin(t / 300 + p.hx) * 1.2;
    for (const s of figure(p.x, p.y + bob, 1, p.pose)) inkStroke(ctx, s, { width: 2 });
    if (p.task) {
      ctx.fillStyle = 'rgba(31,27,23,0.55)';
      ctx.font = `${11 * (world.ui || 1)}px system-ui, "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.task, p.x, p.y - 42);
    }
  }
  const b = world.beast;
  if (!b.alive) return;
  // 虎：身子、头、尾巴、几道斑纹
  const x = b.x, y = b.y, w = Math.sin(t / 200) * 2;
  const S = [
    curve([[x - 38, y], [x - 20, y - 16], [x + 18, y - 16], [x + 34, y - 6], [x + 30, y + 8], [x - 30, y + 10], [x - 38, y]], { step: WS }),
    arc(x + 42, y - 14, 11, 10, 0, Math.PI * 2, 0, WS),
    curve([[x - 38, y - 2], [x - 56, y - 14 + w], [x - 62, y - 30 + w]], { step: WS }),
    line(x - 24, y + 9, x - 26, y + 24, WS), line(x - 10, y + 10, x - 9, y + 25, WS), line(x + 14, y + 9, x + 15, y + 24, WS), line(x + 26, y + 7, x + 28, y + 22, WS),
    line(x - 16, y - 13, x - 12, y - 2, WS), line(x - 2, y - 15, x + 1, y - 3, WS), line(x + 12, y - 14, x + 14, y - 3, WS),
  ];
  for (const s of S) inkStroke(ctx, s, { width: 2.4, color: '#5b3416' });
  ctx.fillStyle = 'rgba(91,52,22,0.7)';
  ctx.font = `${12 * (world.ui || 1)}px system-ui, "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(b.press ? '虎（顶着封锁线）' : '虎', x, y - 34);
}
