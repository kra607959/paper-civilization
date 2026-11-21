// 地图：同一个种子出同一张图。一条河从北往南，营地在河东岸；树林、石堆、浆果丛、鹿群由近到远撒开，
// 远处的要派人探路才看得见（见 sim.js 的 fog）。
import { MAP, K } from './config.js';
import { makeRng, hashSeed } from '../recog/rng.js';
import { curve, distToPolyline } from '../recog/geom.js';

const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const RIVER_HALF = 28; // 河宽的一半
const G = 25;                 // 河距网格的格子

export function genMap(seed) {
  const r = makeRng(hashSeed('map', seed));
  const { w, h } = MAP;

  // 河：控制点自北往南，左右随机摆，再用平滑曲线穿起来
  const ctrl = [];
  let x = w * r.range(0.28, 0.38), v = 0;
  for (let y = -80; y <= h + 80; y += 170) {
    ctrl.push([x, y]);
    v = v * 0.5 + r.range(-120, 120);
    x = Math.max(w * 0.15, Math.min(w * 0.46, x + v));
  }
  const river = curve(ctrl, { step: 16 });
  const gc = Math.ceil(w / G), gr = Math.ceil(h / G), rd = new Float32Array(gc * gr);
  for (let j = 0; j < gr; j++) for (let i = 0; i < gc; i++) rd[j * gc + i] = distToPolyline({ x: (i + 0.5) * G, y: (j + 0.5) * G }, river);
  const riverDist = (px, py) => {
    const i = Math.max(0, Math.min(gc - 1, Math.floor(px / G))), j = Math.max(0, Math.min(gr - 1, Math.floor(py / G)));
    return rd[j * gc + i];
  };

  // 营地：河东岸，离河 150–260
  const cy = h * r.range(0.42, 0.58);
  const near = river.reduce((b, p) => (Math.abs(p.y - cy) < Math.abs(b.y - cy) ? p : b));
  const camp = { x: near.x + r.range(200, 250), y: cy, r: K.campR };
  while (riverDist(camp.x, camp.y) < 160) camp.x += 20;

  const taken = [{ x: camp.x, y: camp.y, r: 170 }];
  const inMap = (p, rad) => p.x > rad + 30 && p.x < w - rad - 30 && p.y > rad + 30 && p.y < h - rad - 30;
  const fits = (p, rad, pad) => inMap(p, rad) && riverDist(p.x, p.y) > rad + RIVER_HALF + 30 && taken.every(o => D(p, o) > rad + o.r + pad);
  const place = (d0, d1, rad, pad = 50, keep = true) => {
    for (let k = 0; k < 800; k++) {
      const a = r.range(0, 2 * Math.PI), d = r.range(d0, d1);
      const p = { x: camp.x + Math.cos(a) * d, y: camp.y + Math.sin(a) * d };
      if (fits(p, rad, pad)) { if (keep) taken.push({ ...p, r: rad }); return p; }
    }
    return null;
  };
  let uid = 0;

  // 树林：第一片就在营地边上
  const forests = [];
  for (const [d0, d1] of [[300, 420], [420, 650], [550, 900], [650, 1200], [750, 1500], [850, 1800], [950, 2000]]) {
    const rad = r.range(80, 130), c = place(d0, d1, rad);
    if (!c) continue;
    const f = { id: `f${forests.length}`, x: c.x, y: c.y, r: rad, trees: [], nuts: 0, burnt: 0 };
    const n = Math.round(rad * rad / 520);
    for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) {
      const a = r.range(0, 2 * Math.PI), d = Math.sqrt(r()) * rad;
      const p = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
      if (f.trees.some(o => D(o, p) < 20)) continue;
      f.trees.push({ id: `t${uid++}`, x: p.x, y: p.y, wood: K.tree.wood, alive: true, regrow: 0, size: r.range(26, 40), seed: r.int(1e9), forest: f.id });
      k++;
    }
    forests.push(f);
  }

  // 石堆
  const rocks = [];
  for (const [d0, d1] of [[380, 600], [600, 1100], [800, 1600], [1000, 2000]]) {
    const rad = r.range(36, 56), c = place(d0, d1, rad);
    if (!c) continue;
    const stone = Math.round(rad * 1.3);
    rocks.push({ id: `r${rocks.length}`, x: c.x, y: c.y, r: rad, stone, max: stone, seed: r.int(1e9) });
  }

  // 浆果丛：一簇一簇
  const bushes = [], patches = [];
  for (const [d0, d1] of [[170, 280], [260, 450], [350, 650], [450, 900], [500, 1100], [600, 1400], [700, 1700], [800, 1900], [900, 2000]]) {
    const c = place(d0, d1, 45, 20);
    if (!c) continue;
    const pt = { id: `bp${patches.length}`, x: c.x, y: c.y, r: 45 };
    patches.push(pt);
    const nb = 3 + r.int(4);
    for (let k = 0, tries = 0; k < nb && tries < 60; tries++) {
      const a = r.range(0, 2 * Math.PI), d = Math.sqrt(r()) * 45;
      const p = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
      if (bushes.some(o => D(o, p) < 16)) continue;
      bushes.push({ id: `b${bushes.length}`, x: p.x, y: p.y, food: K.bush.max * r.range(0.4, 0.8), max: K.bush.max, seed: r.int(1e9), patch: pt.id });
      k++;
    }
  }

  // 鹿群：家在远近不等的草地上（不占地方，会走动）
  const herds = [];
  for (const [d0, d1] of [[450, 750], [600, 1000], [700, 1300], [800, 1400], [900, 1700], [1000, 2000]]) {
    const c = place(d0, d1, 40, 0, false);
    if (!c) continue;
    herds.push({ id: `h${herds.length}`, kind: 'herd', x: c.x, y: c.y, hx: c.x, hy: c.y, n: 6 + r.int(4), range: 240, flee: 0, fx: 0, fy: 0, wx: c.x, wy: c.y });
  }

  // 虎的窝：远处的一片林子
  const far = forests.filter(f => D(f, camp) > 900 && D(f, camp) < 1800);
  const lairF = far.length ? far[r.int(far.length)] : null;
  const lair = lairF ? { x: lairF.x, y: lairF.y } : place(1000, 1700, 30, 0, false) || { x: w - 200, y: 200 };

  // 远山（只是画）
  const hills = [];
  for (let k = 0; k < 7; k++) {
    const p = { x: r.range(80, w - 80), y: r.range(80, h - 80) };
    const edge = Math.min(p.x, p.y, w - p.x, h - p.y);
    if (edge > 260 || D(p, camp) < 700 || riverDist(p.x, p.y) < 120 || taken.some(o => D(p, o) < o.r + 60)) continue;
    hills.push({ x: p.x, y: p.y, size: r.range(110, 180), seed: r.int(1e9) });
  }

  // ---- 第一代后半：新河谷（迁徙的去处）和河那边的游群。用另一条随机流，前面的地图不变 ----
  const r2 = makeRng(hashSeed('valley', seed));
  let valley = null;
  for (const [d0, d1] of [[1150, 1750], [950, 1750], [800, 1900]]) {
    for (let k = 0; k < 600 && !valley; k++) {
      const a = r2.range(0, 2 * Math.PI), d = r2.range(d0, d1);
      const p = { x: camp.x + Math.cos(a) * d, y: camp.y + Math.sin(a) * d };
      if (p.x < 170 || p.y < 170 || p.x > w - 170 || p.y > h - 170) continue;
      if (riverDist(p.x, p.y) < 300 || D(p, lair) < 600) continue;
      const rp = river.reduce((b, q) => (Math.abs(q.y - p.y) < Math.abs(b.y - p.y) ? q : b));
      if (p.x < rp.x) continue;                       // 和营地同在河东岸，不用蹚水
      if (taken.some(o => D(p, o) < o.r + 110)) continue;
      valley = { x: p.x, y: p.y, r: 170 };
    }
    if (valley) break;
  }
  if (!valley) valley = { x: w - 220, y: camp.y < h / 2 ? h - 220 : 220, r: 170 };
  taken.push({ x: valley.x, y: valley.y, r: 120 });
  const spring = { id: 'spring0', x: valley.x + r2.range(-30, 30), y: valley.y + r2.range(-30, 30) };
  const fits2 = (p, rad) => p.x > rad + 30 && p.x < w - rad - 30 && p.y > rad + 30 && p.y < h - rad - 30 && riverDist(p.x, p.y) > rad + RIVER_HALF + 30 && taken.every(o => D(p, o) > rad + o.r + 20);
  const nearV = (d0, d1, rad) => { for (let k = 0; k < 300; k++) { const a = r2.range(0, 2 * Math.PI), d = r2.range(d0, d1), p = { x: valley.x + Math.cos(a) * d, y: valley.y + Math.sin(a) * d }; if (fits2(p, rad)) { taken.push({ ...p, r: rad }); return p; } } return null; };
  { // 河谷边上一片林子、一堆石头、一簇浆果
    const rad = r2.range(80, 105), c = nearV(200, 300, rad);
    if (c) {
      const f = { id: `f${forests.length}`, x: c.x, y: c.y, r: rad, trees: [], nuts: 0, burnt: 0, valley: true };
      const n = Math.round(rad * rad / 520);
      for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) {
        const a = r2.range(0, 2 * Math.PI), d = Math.sqrt(r2()) * rad, p = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
        if (f.trees.some(o => D(o, p) < 20)) continue;
        f.trees.push({ id: `t${uid++}`, x: p.x, y: p.y, wood: K.tree.wood, alive: true, regrow: 0, size: r2.range(26, 40), seed: r2.int(1e9), forest: f.id });
        k++;
      }
      forests.push(f);
    }
    const rr = r2.range(38, 50), rc = nearV(170, 260, rr);
    if (rc) rocks.push({ id: `r${rocks.length}`, x: rc.x, y: rc.y, r: rr, stone: Math.round(rr * 1.3), max: Math.round(rr * 1.3), seed: r2.int(1e9) });
    const pc = nearV(120, 220, 45);
    if (pc) {
      const pt = { id: `bp${patches.length}`, x: pc.x, y: pc.y, r: 45 };
      patches.push(pt);
      for (let k = 0, tries = 0; k < 5 && tries < 60; tries++) {
        const a = r2.range(0, 2 * Math.PI), d = Math.sqrt(r2()) * 45, p = { x: pc.x + Math.cos(a) * d, y: pc.y + Math.sin(a) * d };
        if (bushes.some(o => D(o, p) < 16)) continue;
        bushes.push({ id: `b${bushes.length}`, x: p.x, y: p.y, food: K.bush.max * 0.7, max: K.bush.max, seed: r2.int(1e9), patch: pt.id });
        k++;
      }
    }
  }
  // 游群：多半在河西岸，和营地隔着河
  let band = null;
  for (let k = 0; k < 200 && !band; k++) {
    const dy = r2.range(260, 560) * (r2() < 0.5 ? -1 : 1), y = Math.max(160, Math.min(h - 160, camp.y + dy));
    const rp = river.reduce((b, p) => (Math.abs(p.y - y) < Math.abs(b.y - y) ? p : b));
    const p = { x: rp.x - r2.range(220, 360), y };
    if (p.x < 110 || riverDist(p.x, p.y) < 170 || taken.some(o => D(p, o) < o.r + 40)) continue;
    band = p;
  }
  if (!band) band = { x: Math.min(w - 160, camp.x + 800), y: camp.y < h / 2 ? camp.y + 420 : camp.y - 420 };

  return { seed, w, h, river, riverDist, camp, forests, rocks, bushes, patches, herds, lair, hills, valley, springs: [spring], band };
}

// 河上离 p 最近的一点
export function nearestRiverPoint(map, p) {
  let best = null, bd = Infinity;
  for (const q of map.river) {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
