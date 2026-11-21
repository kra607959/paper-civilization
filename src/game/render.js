// 把部落画到纸上。没探过的地方是白纸（边缘淡淡化开）；景物用神符同一套笔法：
// 林子里每棵树是一个手写的「树」，营火是一个「火」，房子就是你照着画的那张图纸。
import { symbolById } from '../recog/symbols.js';
import { makeRng, hashSeed } from '../recog/rng.js';
import { augment } from '../recog/synth.js';
import { bbox } from '../recog/geom.js';
import { inkStroke, polyline, COLORS } from '../ui/ink.js';
import { FOG, known, localBuildings } from '../sim/util.js';
import { RIVER_HALF } from '../sim/mapgen.js';
import { MAP, K, ERA3_DESIGNS } from '../sim/config.js';
import { LABEL } from '../sim/people.js';
import { titleOf } from '../sim/tech.js';
import { bandMood } from '../sim/band.js';
import { fieldStateText } from '../sim/farming.js';
import { villageMood, isDiversionReady } from '../sim/era2.js';
import { citySeat } from '../sim/era3.js';
import { BRONZE_GLYPHS } from '../recog/bronze.js';

// ---------------- 相机 ----------------
// x、y 是屏幕中心对着的纸面坐标；z 是 1 纸面单位合多少屏幕像素
export function createCamera() { return { x: 0, y: 0, z: 0.6, vw: 1, vh: 1 }; }
export const toScreen = (c, p) => ({ x: (p.x - c.x) * c.z + c.vw / 2, y: (p.y - c.y) * c.z + c.vh / 2 });
export const toWorld = (c, p) => ({ x: (p.x - c.vw / 2) / c.z + c.x, y: (p.y - c.vh / 2) / c.z + c.y });
export function clampCamera(c) {
  c.z = Math.max(0.22, Math.min(2.6, c.z));
  const hw = c.vw / 2 / c.z, hh = c.vh / 2 / c.z, m = 200;
  c.x = MAP.w < 2 * hw - 2 * m ? MAP.w / 2 : Math.max(hw - m, Math.min(MAP.w - hw + m, c.x));
  c.y = MAP.h < 2 * hh - 2 * m ? MAP.h / 2 : Math.max(hh - m, Math.min(MAP.h - hh + m, c.y));
}
export function zoomAt(c, sp, k) {
  const before = toWorld(c, sp);
  c.z *= k;
  clampCamera(c);
  const after = toWorld(c, sp);
  c.x += before.x - after.x; c.y += before.y - after.y;
  clampCamera(c);
}

// ---------------- 笔画素材（算一次存起来） ----------------
export function place(strokes, x, y, size) {
  const b = bbox(strokes), span = Math.max(b.w, b.h) || 1;
  return strokes.map(s => s.map(p => ({ x: x + (p.x - b.cx) / span * size, y: y + (p.y - b.cy) / span * size })));
}
// 点太密的笔画抽稀（地图上一个符几十个单位大，合成时的点距是按边长 1 定的）
function thin(strokes, d = 1.6) {
  return strokes.map(s => {
    const out = [s[0]];
    for (const p of s) { const q = out[out.length - 1]; if (Math.hypot(p.x - q.x, p.y - q.y) >= d) out.push(p); }
    if (out[out.length - 1] !== s[s.length - 1]) out.push(s[s.length - 1]);
    return out;
  });
}
const cache = new Map();
export function glyph(id, seed, x, y, size, L = 0.4) {
  const key = `${id}|${seed}|${x | 0}|${y | 0}|${size | 0}`;
  let g = cache.get(key);
  if (!g) {
    const r = makeRng(hashSeed('art', id, seed));
    g = thin(place(augment(symbolById(id).make(r), r, L), x, y, size), Math.max(1, size / 40));
    cache.set(key, g);
  }
  return g;
}
// 图纸（宽 1、高 0.7 的纸）上的笔画 → 地图上：按种类定大小和落地点
const SHEET = {
  shack: [84, 0.5, 0.6], rack: [70, 0.5, 0.62], hearth: [62, 0.5, 0.53], bench: [76, 0.5, 0.55], trap: [56, 0.5, 0.6],
  altar1: [150, 0.5, 0.58], altar2: [150, 0.5, 0.58], altar3: [150, 0.5, 0.58],
  granary: [84, 0.5, 0.52], kiln: [76, 0.5, 0.52], timberhouse: [96, 0.5, 0.52], pen: [92, 0.5, 0.48], bridge: [110, 0.5, 0.48],
  palace: [131, .5, .55], workshop: [91, .5, .59], furnace: [92, .5, .55], market: [105, .5, .59], temple: [110, .5, .57], bell: [100, .5, .55],
};
export function sheetToMap(type, strokes, x, y, id = null, angle = 0) {
  const key = id && `sheet|${id}|${x | 0}|${y | 0}|${(angle * 100) | 0}`;
  if (key && cache.has(key)) return cache.get(key);
  const [k, ax, ay] = SHEET[type] || [70, 0.5, 0.6];
  const ca = angle ? Math.cos(angle) : 1, sa = angle ? Math.sin(angle) : 0;
  const out = thin(Object.values(strokes).flat().filter(s => s.length > 1).map(s => s.map(p => {
    const dx = (p.x - ax) * k, dy = (p.y - ay) * k;
    return angle ? { x: x + dx * ca - dy * sa, y: y + dx * sa + dy * ca } : { x: x + dx, y: y + dy };
  })), 1.2);
  if (key) cache.set(key, out);
  return out;
}
function rockShape(rk) {
  const key = `rock|${rk.id}`;
  let g = cache.get(key);
  if (!g) {
    const r = makeRng(hashSeed('rock', rk.id)), out = [];
    const n = 4 + r.int(3);
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2), d = i ? r.range(rk.r * 0.25, rk.r * 0.7) : 0, k = r.range(10, 18) * (i ? 0.8 : 1.2);
      const cx = rk.x + Math.cos(a) * d, cy = rk.y + Math.sin(a) * d * 0.7, P = [];
      for (let j = 0; j <= 7; j++) { const t = j / 7 * Math.PI * 2; P.push({ x: cx + Math.cos(t) * k * r.range(0.75, 1.15), y: cy + Math.sin(t) * k * 0.68 * r.range(0.75, 1.15) }); }
      P[P.length - 1] = P[0];
      out.push(P);
    }
    cache.set(key, (g = out));
  }
  return g;
}
function riverBanks(river) {
  const key = 'banks';
  let g = cache.get(key);
  if (g && g.river === river) return g;
  const L = [], R = [];
  for (let i = 0; i < river.length; i += 2) {
    const a = river[Math.max(0, i - 2)], b = river[Math.min(river.length - 1, i + 2)], p = river[i];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, w = RIVER_HALF * (0.9 + 0.2 * Math.sin(i * 0.07));
    L.push({ x: p.x + nx * w, y: p.y + ny * w }); R.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  g = { river, L, R };
  cache.set(key, g);
  return g;
}

// ---------------- 迷雾：没探过的地方盖一层纸 ----------------
let fogMask = null, fogStamp = -1;
function fogCanvas(sim) {
  if (!fogMask) { fogMask = document.createElement('canvas'); fogMask.width = FOG.cols; fogMask.height = FOG.rows; }
  if (fogStamp !== sim.revealed) {
    fogStamp = sim.revealed;
    const g = fogMask.getContext('2d'), img = g.createImageData(FOG.cols, FOG.rows);
    for (let i = 0; i < sim.fog.length; i++) { img.data[i * 4 + 3] = sim.fog[i] ? 0 : 255; }
    g.putImageData(img, 0, 0);
  }
  return fogMask;
}
let layer = null, layer2 = null;
function scratch(w, h, dpr, which = 1) {
  let c = which === 1 ? layer : layer2;
  if (!c) { c = document.createElement('canvas'); if (which === 1) layer = c; else layer2 = c; }
  const s = Math.min(1.5, dpr || 1);
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  return { c, g };
}
export function drawFog(ctx, sim, cam, paperCanvas, w, h, dpr) {
  const { c, g } = scratch(w, h, dpr);
  g.fillStyle = '#000';
  // 纸外头也盖上
  const o = toScreen(cam, { x: 0, y: 0 }), W = MAP.w * cam.z, H = MAP.h * cam.z;
  g.fillRect(0, 0, w, Math.max(0, o.y)); g.fillRect(0, o.y + H, w, h); g.fillRect(0, 0, Math.max(0, o.x), h); g.fillRect(o.x + W, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // 一格 50 单位：放大时双线性插值，边缘自然化开半格
  g.drawImage(fogCanvas(sim), o.x - cam.z * MAP.cell * 0.5, o.y - cam.z * MAP.cell * 0.5, W + cam.z * MAP.cell, H + cam.z * MAP.cell);
  g.globalCompositeOperation = 'source-in';
  g.drawImage(paperCanvas, 0, 0, w, h);
  ctx.drawImage(c, 0, 0, w, h);
}

// 夜：整张纸暗下来，火堆周围亮着
export function drawNight(ctx, sim, cam, w, h, dpr) {
  const L = sim.now.light ?? 1;
  const a = 0.5 * Math.max(0, Math.min(1, (1 - L) / 0.7));
  if (a < 0.01) return;
  const { c, g } = scratch(w, h, dpr, 2);
  g.fillStyle = `rgba(16,20,38,${a})`;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  for (const f of sim.fires) {
    if (!f.lit) continue;
    const s = toScreen(cam, f), r = (f.radius || 90) * 1.5 * cam.z * (0.9 + 0.1 * Math.min(1, f.fuel / 6));
    if (s.x < -r || s.y < -r || s.x > w + r || s.y > h + r) continue;
    const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(s.x - r, s.y - r, 2 * r, 2 * r);
  }
  ctx.drawImage(c, 0, 0, w, h);
}

// ---------------- 景物 ----------------
function batch(ctx, strokes, { width = 1.6, color = COLORS.ink, alpha = 1, dash = null } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  for (const s of strokes) { if (s.length < 2) continue; ctx.moveTo(s[0].x, s[0].y); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y); }
  ctx.stroke();
  ctx.restore();
}
const inView = (v, x, y, m = 80) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

export function drawWorld(ctx, sim, cam, ui) {
  const tl = toWorld(cam, { x: 0, y: 0 }), br = toWorld(cam, { x: cam.vw, y: cam.vh });
  const v = { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  const z = cam.z, px = 1 / z; // 一个屏幕像素合多少纸面单位
  const M = sim.map;
  // 远山
  const hills = [];
  for (const h of M.hills || []) if (inView(v, h.x, h.y, 200) && known(sim, h.x, h.y)) hills.push(...glyph('shan', h.seed, h.x, h.y, h.size, 0.3));
  batch(ctx, hills, { width: 1.3, color: COLORS.pencil, alpha: 0.45 });
  // 爱戴水彩小花 & 敬畏朱砂点（世界随信仰和情绪染色）
  if (sim.alive.length) {
    const avgLove = sim.alive.reduce((s, p) => s + p.love, 0) / sim.alive.length;
    const avgFear = sim.alive.reduce((s, p) => s + p.fear, 0) / sim.alive.length;
    if (avgLove > 0.48) {
      ctx.save(); ctx.fillStyle = '#d49a4a'; ctx.globalAlpha = Math.min(0.45, (avgLove - 0.45) * 1.1);
      for (let i = 0; i < 14; i++) {
        const a = i * 2.39996, r = 45 + (i % 5) * 32, fx = sim.camp.x + Math.cos(a) * r, fy = sim.camp.y + Math.sin(a) * r * 0.72;
        if (!inView(v, fx, fy)) continue;
        ctx.beginPath(); ctx.arc(fx, fy, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (avgFear > 0.4) {
      ctx.save(); ctx.fillStyle = COLORS.red; ctx.globalAlpha = Math.min(0.32, (avgFear - 0.38) * 0.8);
      for (let i = 0; i < 10; i++) {
        const a = i * 1.9 + 0.5, r = 90 + (i % 4) * 38, fx = sim.camp.x + Math.cos(a) * r, fy = sim.camp.y + Math.sin(a) * r * 0.7;
        if (!inView(v, fx, fy)) continue;
        ctx.beginPath(); ctx.arc(fx, fy, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
  // 河：一道淡水痕 + 两岸
  const B = riverBanks(M.river);
  ctx.save();
  ctx.globalAlpha = 0.24; ctx.strokeStyle = '#6f8aa6'; ctx.lineWidth = RIVER_HALF * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); M.river.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
  ctx.restore();
  if (sim.flood) drawFlood(ctx, sim, v, ui);
  batch(ctx, [B.L, B.R], { width: 1.8, color: '#3c4f63', alpha: 0.7 });
  // 堤
  for (const L of sim.levees || []) {
    if (!L.pts || !inView(v, L.x, L.y, 300)) continue;
    polyline(ctx, L.pts, { width: 7, color: L.broken ? '#9a8a78' : '#6f6658', alpha: L.broken ? 0.45 : 0.8, dash: L.broken ? [6, 8] : null });
    if (z > 0.5) ui.labels.push({ x: L.x, y: L.y - 14, text: L.broken ? '堤（冲垮了）' : '堤', color: '#5a5248' });
  }
  // 新河谷：水彩沃土底晕 + 虚线圈
  const E = sim.era, E2 = sim.era2, V = M.valley;
  if (V && E?.valleyKnown && inView(v, V.x, V.y, V.r + 120)) {
    ctx.save();
    const gv = ctx.createRadialGradient(V.x, V.y, 20, V.x, V.y, V.r + 40);
    gv.addColorStop(0, E2?.active ? 'rgba(130,165,98,0.16)' : 'rgba(95,148,125,0.12)');
    gv.addColorStop(1, 'rgba(95,148,125,0)');
    ctx.fillStyle = gv; ctx.fillRect(V.x - V.r - 40, V.y - V.r - 40, (V.r + 40) * 2, (V.r + 40) * 2);
    ctx.strokeStyle = E2?.active ? '#7a5230' : '#2f6a5a'; ctx.globalAlpha = E2?.active ? 0.28 : 0.6;
    ctx.lineWidth = 2.0 * Math.max(1, px * 0.8); ctx.setLineDash([9, 8]);
    ctx.beginPath(); ctx.arc(V.x, V.y, V.r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (!E2?.active) ui.labels.push({ x: V.x, y: V.y - V.r - 12, text: E.done ? '新河谷 · 新营地' : E.flooded ? '新河谷：用铅笔画路过来' : '新河谷（墨池里看见的）', color: '#2f6a5a', strong: !!(E.flooded && !E.done) });
  }
  // 泉水（新河谷旁）
  for (const sp of M.springs || []) {
    if (!inView(v, sp.x, sp.y) || !known(sim, sp.x, sp.y)) continue;
    ctx.save();
    ctx.fillStyle = 'rgba(72,132,175,0.35)'; ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3c5f7c'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
    if (z > 0.6) ui.labels.push({ x: sp.x, y: sp.y + 15, text: '清泉', color: '#3c5f7c' });
  }
  // 第二代：水渠与大渠三节点、农田
  drawCanals(ctx, sim, v, ui, z);
  drawFields(ctx, sim, v, ui, z);
  // 路
  for (const r of sim.roads) for (const s of r.segs) polyline(ctx, [s.a, s.b], { width: s.built ? 5 : 2, color: s.built ? '#8a7f6c' : COLORS.pencil, alpha: s.built ? 0.45 : 0.5, dash: s.built ? null : [3, 6] });
  // 浆果丛
  ctx.save();
  for (const b of M.bushes) {
    if (!inView(v, b.x, b.y) || !known(sim, b.x, b.y)) continue;
    ctx.globalAlpha = 0.75; ctx.strokeStyle = '#3f5a32'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.stroke();
    const n = Math.round(b.food);
    ctx.fillStyle = COLORS.red; ctx.globalAlpha = 0.85;
    for (let i = 0; i < n; i++) { const a = i * 2.4; ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * 5, b.y + Math.sin(a) * 5, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  // 石堆
  const rocks = [];
  for (const r of M.rocks) if (inView(v, r.x, r.y) && known(sim, r.x, r.y) && r.stone > 0) rocks.push(...rockShape(r));
  batch(ctx, rocks, { width: 1.6, color: '#4a443c', alpha: 0.85 });
  // 树：活的墨色，烧过的焦，砍了的剩桩，树苗小
  const live = [], burnt = [], stumps = [];
  for (const f of M.forests) {
    if (!inView(v, f.x, f.y, f.r + 60)) continue;
    for (const t of f.trees) {
      if (!known(sim, t.x, t.y)) continue;
      if (t.alive) live.push(...glyph('shu', t.seed, t.x, t.y, t.size));
      else if (t.burnt) burnt.push(...glyph('shu', t.seed, t.x, t.y, t.size * 0.8, 0.6));
      else if (t.young && t.regrow !== Infinity) stumps.push(...glyph('shu', t.seed, t.x, t.y + 6, t.size * 0.4));
      else stumps.push([{ x: t.x - 3, y: t.y + 8 }, { x: t.x - 2, y: t.y + 2 }, { x: t.x + 3, y: t.y + 2 }, { x: t.x + 3, y: t.y + 8 }]);
    }
    if (f.nuts >= 1 && known(sim, f.x, f.y) && z > 0.45) ui.labels.push({ x: f.x, y: f.y + f.r * 0.7, text: `坚果 ${Math.floor(f.nuts)}`, color: '#7a5a20' });
  }
  batch(ctx, live, { width: Math.max(1.4, 1.1 * px), color: '#2c3a26', alpha: 0.9 });
  batch(ctx, burnt, { width: 1.4, color: '#6b4a32', alpha: 0.55 });
  batch(ctx, stumps, { width: 1.5, color: '#6b5a44', alpha: 0.75 });
  // 朱笔：禁区、封锁线、护圈；石墙；篱笆
  for (const w of sim.barriers) {
    const k = w.max ? 0.35 + 0.65 * Math.max(0, w.hp) / w.max : 1;
    if (w.kind === 'zone') {
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = COLORS.red; ctx.beginPath(); w.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.restore();
      polyline(ctx, w.pts, { width: 3, color: COLORS.red, alpha: 0.85 * k, dash: [10, 6], close: true });
    } else if (w.kind === 'red') polyline(ctx, w.pts, { width: 4, color: COLORS.red, alpha: 0.9 * k });
    else if (w.kind === 'guard') { ctx.save(); ctx.globalAlpha = 0.7 * k; ctx.strokeStyle = COLORS.red; ctx.lineWidth = 2.5; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    else if (w.kind === 'wall') polyline(ctx, w.pts, { width: 9, color: '#6f6658', alpha: 0.75 * k });
    if (w.max && (w.kind === 'red' || w.kind === 'zone') && z > 0.4) { const m = w.pts[w.pts.length >> 1]; ui.labels.push({ x: m.x, y: m.y - 14, text: `承受 ${Math.ceil(Math.max(0, w.hp))}/${w.max}`, color: COLORS.red }); }
  }
  for (const b of sim.bans) {
    ctx.save(); ctx.strokeStyle = COLORS.red; ctx.lineWidth = 3.4; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(b.x - 14, b.y - 14); ctx.lineTo(b.x + 14, b.y + 14); ctx.moveTo(b.x + 14, b.y - 14); ctx.lineTo(b.x - 14, b.y + 14); ctx.stroke(); ctx.restore();
  }
  for (const F of sim.fences) for (const s of F.segs) {
    if (!inView(v, s.a.x, s.a.y)) continue;
    if (!s.built) { polyline(ctx, [s.a, s.b], { width: 1.4, color: s.broken ? COLORS.red : COLORS.pencil, alpha: 0.6, dash: [4, 5] }); continue; }
    const st = [], L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), n = Math.max(2, Math.round(L / 9)), hgt = 8 + 8 * (F.params.height || 0.6);
    for (let i = 0; i <= n; i++) { const x = s.a.x + (s.b.x - s.a.x) * i / n, y = s.a.y + (s.b.y - s.a.y) * i / n; st.push([{ x, y }, { x, y: y - hgt }]); }
    st.push([{ x: s.a.x, y: s.a.y - hgt * 0.45 }, { x: s.b.x, y: s.b.y - hgt * 0.45 }], [{ x: s.a.x, y: s.a.y - hgt * 0.8 }, { x: s.b.x, y: s.b.y - hgt * 0.8 }]);
    batch(ctx, st, { width: 1.5, color: '#4b3a26', alpha: 0.85 });
  }
  // 工地：铅笔虚线 + 进度
  for (const s of sim.sites) {
    if (s.type === 'fenceSeg' || !inView(v, s.x, s.y)) continue;
    if (s.pts && (s.type === 'citywall' || s.type === 'cartway')) batch(ctx, [s.pts], { width: 3, color: '#486460', alpha: .65, dash: [5, 5] });
    else if (s.strokes) batch(ctx, sheetToMap(s.type, s.strokes, s.x, s.y, s.id), { width: 1.3, color: COLORS.pencil, alpha: 0.6, dash: [3, 4] });
    else if (s.pts) batch(ctx, [s.pts], { width: 4, color: COLORS.pencil, alpha: 0.6, dash: [5, 5] });
    else batch(ctx, siteGlyph(s), { width: 1.3, color: COLORS.pencil, alpha: 0.6, dash: [3, 4] });
    const k = Math.min(1, s.progress / (s.work || 1));
    ctx.save(); ctx.fillStyle = 'rgba(31,27,23,0.15)'; ctx.fillRect(s.x - 18, s.y + 10, 36, 4); ctx.fillStyle = COLORS.ink; ctx.fillRect(s.x - 18, s.y + 10, 36 * k, 4); ctx.restore();
    if (z > 0.5) {
      const miss = Object.entries(s.need).map(([m, n]) => [m, n - (s.have[m] || 0)]).filter(([, n]) => n > 0.01);
      const bless = s.bless ? ` · 开光 ${Math.floor(s.blessed || 0)}/${s.bless} 墨${(s.blessed || 0) < s.bless - 0.01 && sim.ink - K.era.blessFloor * sim.inkMax < 1 ? '（等墨）' : ''}` : '';
      ui.labels.push({ x: s.x, y: s.y + (s.bless ? 34 : 26), text: miss.length ? `${s.name} · 缺${miss.map(([m, n]) => `${{ wood: '木', stone: '石', grass: '草', hide: '皮', bronze: '青铜' }[m]}${Math.ceil(n)}`).join(' ')}${bless}` : `${s.name} · 在盖${bless}`, color: COLORS.pencil });
    }
  }
  // 房子：就是你画的那张图纸（第一代用炭墨，第二代用彩陶赭褐色）
  for (const b of sim.buildings) {
    if (b.type === 'levee' || !inView(v, b.x, b.y, 140)) continue; // 堤在上面画过了
    if (b.type === 'altar') { drawAltar(ctx, b, ui, z); continue; }
    const isEra2 = ERA2_BUILDINGS.has(b.type);
    const col = ERA3_DESIGNS.includes(b.type) ? '#345b51' : isEra2 ? '#8b3e22' : COLORS.ink;
    if (b.type === 'citywall' || b.type === 'cartway') {
      const wall = b.type === 'citywall';
      batch(ctx, [b.pts], { width: wall ? 13 : 8, color: wall ? '#3d655b' : '#a08652', alpha: .27 + (wall ? b.integrity * .2 : .04), dash: wall && b.integrity < .55 ? [19, 8] : null });
      batch(ctx, [b.pts], { width: 2, color: col, alpha: .76 });
      continue;
    }
    if (b.type === 'bridge') {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,76,40,0.28)'; ctx.lineWidth = 14; ctx.lineCap = 'round';
      const dx = Math.cos(b.angle || 0) * 42, dy = Math.sin(b.angle || 0) * 42;
      ctx.beginPath(); ctx.moveTo(b.x - dx, b.y - dy); ctx.lineTo(b.x + dx, b.y + dy); ctx.stroke();
      ctx.restore();
    }
    if (b.strokes) batch(ctx, sheetToMap(b.type, b.strokes, b.x, b.y, b.id, b.angle || 0), { width: 2.1, color: col, alpha: 0.92 });
    else batch(ctx, siteGlyph(b), { width: 2, color: col, alpha: 0.85 });
    if (b.type === 'kiln') {
      const glow = 0.25 + 0.1 * Math.sin(ui.t / 300);
      ctx.save(); ctx.fillStyle = `rgba(220,96,35,${glow})`; ctx.beginPath(); ctx.arc(b.x, b.y + 5, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9e4728'; for (let k = 0; k < Math.min(3, Math.floor((sim.stock.pottery || 0) / 2)); k++) { ctx.beginPath(); ctx.arc(b.x + 22 + k * 7, b.y + 8, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (b.type === 'pen') {
      ctx.save(); ctx.fillStyle = '#6b4f2a'; ctx.globalAlpha = 0.78;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(b.x - 10 + k * 10, b.y + (k % 2 ? -3 : 4), 4, 2.5, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (b.type === 'rack' && b.load?.length) {
      const n = Math.min(8, Math.ceil(b.load.reduce((s, x) => s + x.n, 0) / 4));
      ctx.save(); ctx.strokeStyle = '#8a3a22'; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.85;
      for (let i = 0; i < n; i++) { const x = b.x - 14 + i * 4; ctx.beginPath(); ctx.moveTo(x, b.y - 26); ctx.lineTo(x + 1, b.y - 16); ctx.stroke(); }
      ctx.restore();
    }
    if (b.type === 'trap' && b.meat >= 1) { ctx.save(); ctx.fillStyle = '#8a3a22'; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(b.x, b.y - 6, 3 + Math.min(4, b.meat / 3), 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (z > 0.75) {
      const lbl = b.type === 'shack' || b.type === 'timberhouse' ? `${b.name} · ${b.cap} 人`
        : b.type === 'rack' ? `晾肉架 ${Math.round(b.load.reduce((s, x) => s + x.n, 0))}/${b.cap}`
        : b.type === 'granary' ? `公共粮仓 · 护 ${b.cap} 份`
        : b.type === 'trap' ? (b.sprung ? '陷阱 · 塌了' : b.meat >= 1 ? `陷阱 · 逮着了 ${Math.round(b.meat)}` : '陷阱')
        : b.name;
      ui.labels.push({ x: b.x, y: b.y + 18, text: lbl, color: isEra2 ? '#7d391e' : (COLORS.ink3 || '#7c7468') });
    }
  }
  // 壁画：石壁上一小片赭红的画
  const painted = Object.keys(sim.murals || {}), MA = sim.muralAt;
  if (painted.length && MA && inView(v, MA.x, MA.y) && known(sim, MA.x, MA.y)) {
    const marks = [];
    painted.slice(0, 12).forEach((id, i) => marks.push(...glyph(MURAL_SY[(id.charCodeAt(0) + id.length * 3 + i) % MURAL_SY.length], i + 31, MA.x - 25 + (i % 6) * 10, MA.y - 16 - Math.floor(i / 6) * 11, 9, 0.3)));
    batch(ctx, marks, { width: 1.3, color: '#9a4a22', alpha: 0.85 });
    if (z > 0.55) ui.labels.push({ x: MA.x, y: MA.y + 8, text: `壁画 ${painted.length} 幅`, color: '#9a4a22' });
  }
  // 苇族：河那边三顶窝棚一堆火；来咱们这边的人
  const Bd = sim.band;
  if (Bd && Bd.met && !Bd.merged && !Bd.gone && known(sim, Bd.x, Bd.y) && inView(v, Bd.x, Bd.y, 120)) {
    const huts = [];
    for (let i = 0; i < 3; i++) { const hx = Bd.x - 38 + i * 38, hy = Bd.y + (i % 2) * 10; huts.push([{ x: hx - 13, y: hy }, { x: hx, y: hy - 22 }, { x: hx + 13, y: hy }], [{ x: hx - 4, y: hy }, { x: hx, y: hy - 8 }, { x: hx + 4, y: hy }]); }
    batch(ctx, huts, { width: 1.8, color: BAND_INK, alpha: 0.85 });
    batch(ctx, glyph('huo', 77, Bd.x, Bd.y + 22, 18, 0.35), { width: 2, color: Bd.fire ? '#b3401f' : '#8a8378', alpha: Bd.fire ? 0.9 : 0.6 });
    if (z > 0.3) ui.labels.push({ x: Bd.x, y: Bd.y + 44, text: `${Bd.name} · ${bandMood(Bd)} · ${Bd.members.length} 口${Bd.fire ? '' : ' · 火灭了'}`, color: BAND_INK, strong: z > 0.8 });
  }
  for (const zz of sim.strangers || []) {
    if (!inView(v, zz.x, zz.y) || !known(sim, zz.x, zz.y)) continue;
    figure(ctx, zz.x, zz.y, BAND_INK, ui.t, zz.state !== 'wait', zz.i || 0);
    if (z > 0.45) ui.labels.push({ x: zz.x, y: zz.y - 44, text: `${Bd?.name || '外人'}的${zz.name} · ${zz.state === 'flee' ? '逃回去' : zz.state === 'home' ? '回去了' : STRANGER[zz.task] || ''}`, color: BAND_INK });
  }
  drawVillage(ctx, sim, v, ui, z);
  drawRaiders(ctx, sim, v, ui, z);
  // 火
  for (const f of sim.fires) {
    if (!inView(v, f.x, f.y)) continue;
    if (f.lit) {
      const r = 34 + 10 * Math.min(1, f.fuel / 10), g = ctx.createRadialGradient(f.x, f.y - 6, 0, f.x, f.y - 6, r);
      g.addColorStop(0, 'rgba(230,120,40,0.45)'); g.addColorStop(1, 'rgba(230,120,40,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - 6 - r, 2 * r, 2 * r);
    }
    const flicker = f.lit ? Math.floor(ui.t / 260) % 3 : 0;
    batch(ctx, glyph('huo', f.id.length * 7 + flicker, f.x, f.y - 8, f.kind === 'hearth' ? 22 : 24, 0.35), { width: 2.2, color: f.lit ? '#b3401f' : '#8a8378', alpha: f.lit ? 0.95 : 0.6 });
    if (z > 0.6) ui.labels.push({ x: f.x, y: f.y + 16, text: f.lit ? `${f.name} · 柴 ${f.fuel.toFixed(0)}` : `${f.name}（灭了）`, color: f.lit ? '#9a3a1a' : COLORS.pencil });
  }
  // 鹿群、野兽：在白纸上的看不见
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const h of sim.herds) {
    if (h.n <= 0 || !inView(v, h.x, h.y) || !known(sim, h.x, h.y)) continue;
    ctx.fillStyle = '#6b4f2a'; ctx.globalAlpha = 0.8;
    for (let i = 0; i < h.n; i++) { const a = i * 2.39996, d = 6 + 5 * Math.sqrt(i); ctx.beginPath(); ctx.ellipse(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d * 0.6, 4.2, 2.6, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.9; ctx.font = `600 16px ${SERIF}`; ctx.fillText('鹿', h.x, h.y - 22);
    if (z > 0.55) ui.labels.push({ x: h.x, y: h.y + 20, text: `鹿群 ${h.n}`, color: '#6b4f2a' });
  }
  for (const b of sim.beasts) {
    if (b.dead || b.gone || !inView(v, b.x, b.y, 160) || !known(sim, b.x, b.y)) continue;
    if (b.kind === 'swarm') { drawSwarm(ctx, b, ui, z); continue; }
    const tiger = b.kind === 'tiger', size = tiger ? 34 : 24;
    if (b.state === 'stalk' && sim.idx[b.target]?.name) {
      const t = sim.idx[b.target];
      polyline(ctx, [b, t], { width: 1.6, color: COLORS.red, alpha: 0.6, dash: [4, 6] });
    }
    ctx.font = `700 ${size}px ${SERIF}`;
    ctx.globalAlpha = b.state === 'rest' ? 0.6 : 0.95;
    ctx.fillStyle = tiger ? '#9b4a12' : '#4d4a44';
    ctx.fillText(tiger ? '虎' : '狼', b.x, b.y);
    if (b.state === 'stalk' && z > 0.3) ui.labels.push({ x: b.x, y: b.y + size * 0.8, text: tiger ? '虎在潜近' : '狼在潜近', color: COLORS.red });
  }
  ctx.restore();
  // 迁徙：铅笔画的路，走过的一段描成墨线
  const Mh = sim.march;
  if (Mh) {
    polyline(ctx, Mh.route, { width: 2.4, color: COLORS.pencil, alpha: 0.75, dash: [7, 6] });
    polyline(ctx, Mh.route.slice(0, Mh.minI + 1), { width: 3.2, color: COLORS.ink, alpha: 0.55 });
    const end = Mh.route[Mh.route.length - 1], blocked = Mh.blocked && sim.t - Mh.blocked < 60;
    ui.labels.push({ x: end.x, y: end.y - 20, text: Mh.trial ? '新河谷' : '新营地', color: COLORS.ink, strong: true });
    ui.labels.push({ x: Mh.c.x, y: Mh.c.y - 60, text: blocked ? '前面是水：停在水边等水退' : `迁徙中 · 走了 ${Math.round(100 * Mh.minI / Math.max(1, Mh.route.length - 1))}%`, color: blocked ? COLORS.red : COLORS.ink, strong: true });
  }
  if (sim.era3?.active) drawBronzeCity(ctx, sim, ui, v);
  drawPeople(ctx, sim, cam, ui);
}
function drawBronzeCity(ctx, sim, ui, view) {
  const E = sim.era3;
  const bell = sim.idx[E.bell], c = localBuildings(sim, 'palace')[0] || citySeat(sim);
  const show = (p, col, txt, glyph) => {
    if (!inView(view, p.x, p.y, 110)) return;
    ctx.save(); ctx.fillStyle = '#ede4cc'; ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    batch(ctx, place(BRONZE_GLYPHS[glyph].strokes, p.x, p.y, 31), { width: 2.5, color: col, alpha: .94 });
    ui.labels.push({ x: p.x, y: p.y - 38, text: txt, color: col, strong: true });
  };
  if (bell && E.bellUntil > sim.t) {
    ctx.save(); ctx.strokeStyle = 'rgba(110,104,43,.3)'; ctx.lineWidth = 2; ctx.setLineDash([12, 12]);
    ctx.beginPath(); ctx.arc(bell.x, bell.y, bell.params.reach, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  show(c, '#315b4f', '城务台', 'ritual');
  for (const w of E.villages) show(w, '#61744e', `${w.name} · ${w.pop} 人`, 'patrol');
  for (const [i, p] of E.rivals.entries()) {
    show(p, p.color, `${p.name} · ${p.allied ? '亲善' : '城邦'}`, ['guard', 'trade', 'recruit'][i % 3]);
    if (E.trial?.names.includes(p.name)) polyline(ctx, [p, c], { width: 2, color: p.color, alpha: .5, dash: [8, 18] });
  }
  for (const q of E.convoys) {
    const p = sim.idx[q.ref];
    if (!p) continue;
    const u = 1 - Math.abs(2 * Math.max(0, Math.min(1, (sim.t - q.depart) / (q.due - q.depart))) - 1);
    const x = c.x + (p.x - c.x) * u, y = c.y + (p.y - c.y) * u;
    if (inView(view, x, y)) {
      ctx.save(); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ui.labels.push({ x, y: y - 12, text: '商队', color: p.color });
    }
  }
}
const ERA2_BUILDINGS = new Set(['granary', 'kiln', 'timberhouse', 'pen', 'bridge']);
const BAND_INK = '#3d5a34';
const STRANGER = { ask: '来讨火种', fire: '来偷火', food: '来偷吃的', gift: '来送东西' };
const MURAL_SY = ['shu', 'shan', 'huo', 'jian', 'qi', 'yue', 'ri', 'shui', 'yu', 'guang'];

// ---------------- 农田：裁剪在手绘闭合圈里画各阶段田相 ----------------
function drawFields(ctx, sim, v, ui, z) {
  for (const f of sim.fields || []) {
    const bx = f.box;
    if (!bx || !inView(v, f.cx, f.cy, Math.max(bx.w, bx.h))) continue;
    ctx.save();
    ctx.beginPath();
    f.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();

    // 1. 填充农田土色 / 水润 / 成熟色调
    if (f.state === 'clearing') ctx.fillStyle = 'rgba(175, 160, 134, 0.28)';
    else if (f.state === 'ripe') ctx.fillStyle = 'rgba(224, 178, 66, 0.36)';
    else if (f.moisture > 0.96 && !f.drained) ctx.fillStyle = 'rgba(85, 128, 165, 0.32)';
    else if (f.irrigated) ctx.fillStyle = 'rgba(116, 102, 74, 0.32)';
    else if (f.moisture < 0.35) ctx.fillStyle = 'rgba(182, 152, 106, 0.32)';
    else ctx.fillStyle = `rgba(125, 96, 62, ${(0.18 + 0.16 * f.fertility).toFixed(2)})`;
    ctx.fill();

    // 2. 边界描线（熟田金色、待开垦铅笔虚线、水润偏青、正常褐墨）
    ctx.strokeStyle = f.state === 'ripe' ? '#b88228' : f.state === 'clearing' ? COLORS.pencil : f.irrigated ? '#356a8a' : '#6c4d2e';
    ctx.lineWidth = f.state === 'ripe' ? 2.4 : 1.8;
    if (f.state === 'clearing') ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. 裁剪进田里绘制垄沟、青苗或金穗
    ctx.clip();
    const step = 12;
    if (f.state !== 'clearing') {
      ctx.strokeStyle = f.irrigated ? 'rgba(60, 110, 135, 0.32)' : 'rgba(92, 68, 44, 0.25)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let y = bx.y0 + 7; y < bx.y1; y += step) { ctx.moveTo(bx.x0, y); ctx.lineTo(bx.x1, y); }
      ctx.stroke();
    }
    if (f.state === 'sowing') {
      ctx.fillStyle = '#5c4428';
      for (let y = bx.y0 + 7; y < bx.y1; y += step) for (let x = bx.x0 + 8; x < bx.x1; x += 12) {
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    } else if (f.state === 'growing' || f.state === 'ripe') {
      const ripe = f.state === 'ripe', h = ripe ? 11 : 4 + 7 * f.growth;
      const sway = Math.sin(ui.t / 460 + f.n) * (ripe ? 2.2 : 1.3);
      ctx.strokeStyle = ripe ? '#c88e1d' : f.blessed ? '#4c9446' : '#4a7a36';
      ctx.lineWidth = ripe ? 2.0 : 1.6;
      ctx.beginPath();
      for (let y = bx.y0 + 10; y < bx.y1; y += step) {
        for (let x = bx.x0 + 8; x < bx.x1; x += 11) {
          ctx.moveTo(x, y); ctx.lineTo(x + sway, y - h);
        }
      }
      ctx.stroke();
      if (ripe) { // 谷穗头金点
        ctx.fillStyle = '#e6b235';
        for (let y = bx.y0 + 10; y < bx.y1; y += step) for (let x = bx.x0 + 8; x < bx.x1; x += 11) {
          ctx.beginPath(); ctx.arc(x + sway, y - h, 1.9, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    if (f.pest > 0.1) { // 生虫黑点
      ctx.fillStyle = '#3c2416';
      for (let i = 0; i < 16; i++) {
        const x = f.cx + Math.sin(i * 2.1 + ui.t / 300) * (bx.w * 0.3), y = f.cy + Math.cos(i * 1.7 + ui.t / 340) * (bx.h * 0.3);
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // 4. 田间标签
    if (z > 0.42 || f.state === 'ripe' || f.pest > 0.1) {
      const col = f.state === 'ripe' ? '#9a6510' : f.pest > 0.1 || f.moisture < 0.35 ? COLORS.red : f.irrigated ? '#2c5b82' : '#58412a';
      ui.labels.push({
        x: f.cx, y: f.cy,
        text: z > 0.72 ? `${f.name} · ${fieldStateText(sim, f)}` : f.state === 'ripe' ? `${f.name} · 可收割` : f.state === 'growing' ? `${f.name} ${Math.round(f.growth * 100)}%` : `${f.name} · ${f.state === 'clearing' ? '开垦中' : '待播'}`,
        color: col,
        strong: f.state === 'ripe' || f.pest > 0.1,
      });
    }
  }
}

// ---------------- 水渠与大渠节点 ----------------
function drawCanals(ctx, sim, v, ui, z) {
  const nodes = sim.era2?.canal?.nodes;
  const E2 = sim.era2;
  if (E2?.active && nodes) {
    const items = [
      { p: nodes.intake, label: '① 上游引水口', done: (E2.canal.stage || 0) >= 1 },
      { p: nodes.hub, label: '② 河谷分水枢纽', done: (E2.canal.stage || 0) >= 2 },
      { p: nodes.outfall, label: '③ 下游分洪口', done: (E2.canal.stage || 0) >= 3 },
    ];
    for (const it of items) {
      if (!inView(v, it.p.x, it.p.y, 120) || !known(sim, it.p.x, it.p.y)) continue;
      ctx.save();
      ctx.strokeStyle = it.done ? '#2c5b82' : '#1d4c8a';
      ctx.fillStyle = it.done ? 'rgba(44,91,130,0.22)' : 'rgba(29,76,138,0.1)';
      ctx.lineWidth = 2;
      if (!it.done) ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(it.p.x, it.p.y, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (z > 0.35) ui.labels.push({ x: it.p.x, y: it.p.y - 26, text: it.label, color: '#1d4c8a', strong: !it.done });
    }
  }

  for (const c of sim.canals || []) {
    for (const s of c.segs) {
      if (!inView(v, s.x, s.y, 120)) continue;
      if (!s.built) {
        polyline(ctx, [s.a, s.b], { width: 3.5, color: COLORS.pencil, alpha: 0.65, dash: [5, 5] });
        continue;
      }
      // 渠壁土埂
      polyline(ctx, [s.a, s.b], { width: c.grandStage ? 11 : 8, color: '#8a765a', alpha: 0.5 });
      if (s.wet) {
        // 通水流动蓝波
        polyline(ctx, [s.a, s.b], { width: c.grandStage ? 7 : 5, color: '#4f85b0', alpha: 0.72 });
        ctx.save();
        ctx.strokeStyle = 'rgba(220,242,255,0.65)'; ctx.lineWidth = 1.6;
        ctx.setLineDash([8, 10]); ctx.lineDashOffset = -(ui.t / 45);
        ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
        ctx.restore();
      } else {
        polyline(ctx, [s.a, s.b], { width: c.grandStage ? 6 : 4, color: '#c4b18e', alpha: 0.75 });
      }
    }
    const mid = c.segs[Math.floor(c.segs.length / 2)];
    if (mid && z > 0.5 && inView(v, mid.x, mid.y, 140)) {
      const doneN = c.segs.filter(x => x.built).length;
      const msg = !c.built
        ? `${c.name} · 挖渠 ${doneN}/${c.segs.length}${c.waiting === 'ink' ? '（等墨开光）' : ''}`
        : c.wet ? `${c.name} · 已通水${c.drains ? '（可排涝）' : ''}` : `${c.name} · 干槽未接水源`;
      ui.labels.push({ x: mid.x, y: mid.y - 14, text: msg, color: c.wet ? '#2c5b82' : '#7a6445', strong: !!c.grandStage });
    }
  }
}

// ---------------- 青陶村与劫掠骑手 ----------------
function drawVillage(ctx, sim, v, ui, z) {
  const V = sim.village;
  if (!sim.era2?.active || !V || !known(sim, V.x, V.y) || !inView(v, V.x, V.y, 160)) return;
  const huts = [];
  for (let i = 0; i < 4; i++) {
    const hx = V.x - 45 + i * 30, hy = V.y + (i % 2 ? 12 : -8);
    huts.push([{ x: hx - 12, y: hy }, { x: hx, y: hy - 20 }, { x: hx + 12, y: hy }], [{ x: hx - 10, y: hy }, { x: hx + 10, y: hy }]);
  }
  batch(ctx, huts, { width: 2.0, color: '#7d391e', alpha: 0.9 });
  // 小陶罐与窑烟
  ctx.save();
  ctx.fillStyle = '#9e4728';
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(V.x - 10 + i * 10, V.y + 24, 3.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  if (z > 0.3) ui.labels.push({
    x: V.x, y: V.y + 42,
    text: `${V.name} · ${villageMood(V)} · ${V.pop} 口${V.damming ? ' · 上游拦水中！' : ''}`,
    color: V.damming ? COLORS.red : '#7d391e',
    strong: V.damming || z > 0.75,
  });
}

function drawRaiders(ctx, sim, v, ui, z) {
  for (const rd of sim.raiders || []) {
    if (rd.dead || rd.gone || !inView(v, rd.x, rd.y) || !known(sim, rd.x, rd.y)) continue;
    figure(ctx, rd.x, rd.y, COLORS.red, ui.t, true, 3);
    if (z > 0.4) ui.labels.push({ x: rd.x, y: rd.y - 44, text: rd.state === 'flee' ? '骑手逃散' : '劫掠骑手', color: COLORS.red, strong: true });
  }
}
// 山洪、大水：沿着河漫开一片。新河谷地势高、堤护着的地方淹不到（一个圈裁一次，裁出来的是交集）
function drawFlood(ctx, sim, v, ui) {
  const f = sim.flood, M = sim.map, V = M.valley, holes = [];
  if (f.great && V) holes.push([V.x, V.y, V.r + 60]);
  if (!f.great) for (const L of sim.levees || []) holes.push([L.x, L.y, L.guard]);
  ctx.save();
  for (const [x, y, r] of holes) {
    ctx.beginPath(); ctx.rect(-2000, -2000, MAP.w + 4000, MAP.h + 4000);
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip('evenodd');
  }
  ctx.strokeStyle = '#4f6f96'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); M.river.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.globalAlpha = 0.16 + 0.04 * Math.sin(ui.t / 600); ctx.lineWidth = (28 + f.w) * 2; ctx.stroke();
  ctx.globalAlpha = 0.1; ctx.lineWidth = (28 + f.w) * 1.4; ctx.stroke();
  ctx.restore();
  // 字标在离屏幕中间最近的河段上
  const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
  let best = null, bd = Infinity;
  for (let i = 0; i < M.river.length; i += 4) { const p = M.river[i], d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = p; } }
  if (best && inView(v, best.x, best.y)) ui.labels.push({ x: best.x, y: best.y, text: `${f.great ? '大水' : '山洪'} · ${Math.max(0, (f.until - sim.t) / 1440).toFixed(1)} 天后退`, color: '#3c5a80', strong: f.great });
}
// 大祭坛：修好的几段叠在一起画；墨池是一汪墨
function drawAltar(ctx, b, ui, z) {
  const A = b.altar;
  if (!A) return;
  for (let k = 1; k <= (A.stage || 0); k++) {
    if (k === 3) {
      ctx.save(); ctx.fillStyle = '#1d2a44'; ctx.globalAlpha = 0.32 + 0.06 * Math.sin(ui.t / 700);
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 7.5, 36, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (A.strokes[k]) batch(ctx, sheetToMap(`altar${k}`, A.strokes[k], b.x, b.y, `${b.id}|${k}`), { width: 2.2, color: COLORS.ink, alpha: 0.9 });
  }
  if (z > 0.4) ui.labels.push({ x: b.x, y: b.y + 28, text: A.stage >= 3 ? '大祭坛与墨池' : `大祭坛 · 修到第 ${A.stage} 段`, color: '#6a5a30' });
}
// 蝗虫群：一团转着的黑点
function drawSwarm(ctx, b, ui, z) {
  const r = b.r || 90;
  ctx.save(); ctx.fillStyle = '#5d5a24'; ctx.globalAlpha = 0.55;
  for (let i = 0; i < 80; i++) { const a = i * 2.39996 + ui.t / 900 * (i % 2 ? 1 : -1), d = r * Math.sqrt((i + 0.5) / 80); ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d * 0.7, 1.7, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  if (z > 0.3) ui.labels.push({ x: b.x, y: b.y + r * 0.7 + 12, text: `${b.name || '蝗虫群'}${b.state === 'flee' ? '（被赶走了）' : ''}`, color: '#5d5a24' });
}
// 一个小人（外人用，墨色换成苇族的绿）
function figure(ctx, x, y, color, t, moving, n) {
  const k = moving ? Math.sin(t / 110 + n) * 5 : 0;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - 30, 5.5, 0, Math.PI * 2);
  ctx.moveTo(x, y - 24.5); ctx.lineTo(x, y - 9);
  ctx.moveTo(x, y - 20); ctx.lineTo(x - 8, y - 13 - k * 0.3);
  ctx.moveTo(x, y - 20); ctx.lineTo(x + 8, y - 13 + k * 0.3);
  ctx.moveTo(x, y - 9); ctx.lineTo(x - 5 - k * 0.4, y);
  ctx.moveTo(x, y - 9); ctx.lineTo(x + 5 + k * 0.4, y);
  ctx.stroke(); ctx.restore();
}
const SERIF = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", STSong, SimSun, serif';
function siteGlyph(s) {
  const seed = s.n || 1;
  if (s.type === 'well') return glyph('shui', seed, s.x, s.y - 10, 26);
  if (s.type === 'outpost') return glyph('qi', seed, s.x, s.y - 16, 34);
  if (s.type === 'cairn') return glyph('shan', seed, s.x, s.y - 10, 30);
  if (s.type === 'sapling') return glyph('shu', seed, s.x, s.y - 8, 22);
  if (s.type === 'fire') return glyph('huo', seed, s.x, s.y - 8, 22);
  return glyph('shan', seed, s.x, s.y - 10, 26);
}

// ---------------- 人 ----------------
const JOB = { ...LABEL, build: '盖房' };
export const jobName = p => (p.lost ? '迷了路' : p.job ? JOB[p.job.kind] || p.job.kind : '发呆');
const last = new Map();
function drawPeople(ctx, sim, cam, ui) {
  const z = cam.z;
  for (const p of sim.alive) {
    if (p.inside) continue; // 在窝棚里
    const prev = last.get(p.id), moving = prev && Math.hypot(prev.x - p.x, prev.y - p.y) > 0.05;
    last.set(p.id, { x: p.x, y: p.y });
    const s = p.age < 14 ? 0.55 + p.age / 30 : 1;
    const sel = ui.selected === p.id;
    ctx.save();
    ctx.strokeStyle = p.health < 0.4 || p.sick > 0 ? '#6a3a2a' : COLORS.ink; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    if (sel) { ctx.save(); ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 2; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 16, 7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    if (p.asleep) {
      ctx.beginPath(); ctx.arc(p.x - 14 * s, p.y - 3, 4.5 * s, 0, Math.PI * 2); ctx.moveTo(p.x - 9 * s, p.y - 3); ctx.lineTo(p.x + 10 * s, p.y - 2); ctx.stroke();
      if (z > 0.5) { ctx.fillStyle = COLORS.pencil; ctx.font = `${10}px sans-serif`; ctx.fillText('z', p.x + 8, p.y - 12 - (ui.t / 400 % 4)); }
    } else {
      const k = moving ? Math.sin(ui.t / 110 + p.n) * 5 : 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 30 * s, 5.5 * s, 0, Math.PI * 2);
      ctx.moveTo(p.x, p.y - 24.5 * s); ctx.lineTo(p.x, p.y - 9 * s);
      ctx.moveTo(p.x, p.y - 20 * s); ctx.lineTo(p.x - 8 * s, p.y - 13 * s - k * 0.3);
      ctx.moveTo(p.x, p.y - 20 * s); ctx.lineTo(p.x + 8 * s, p.y - 13 * s + k * 0.3);
      ctx.moveTo(p.x, p.y - 9 * s); ctx.lineTo(p.x - 5 * s - k * 0.4 * s, p.y);
      ctx.moveTo(p.x, p.y - 9 * s); ctx.lineTo(p.x + 5 * s + k * 0.4 * s, p.y);
      ctx.stroke();
      if (p.carry) { ctx.fillStyle = p.carry.kind === 'meat' ? '#8a3a22' : p.carry.kind === 'wood' ? '#6b4f2a' : '#4a6a3a'; ctx.beginPath(); ctx.arc(p.x + 8 * s, p.y - 16 * s, 3, 0, Math.PI * 2); ctx.fill(); }
      if (p.clothes) { ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 2.6; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(p.x, p.y - 22 * s); ctx.lineTo(p.x, p.y - 11 * s); ctx.stroke(); }
    }
    ctx.restore();
    if (p.lost) ui.labels.push({ x: p.x, y: p.y - 58 * s, text: '？', color: COLORS.red, strong: true });
    if (z > 0.7 || sel) { const tt = z > 1.05 || sel ? titleOf(sim, p)[0] : null; ui.labels.push({ x: p.x, y: p.y - 44 * s, text: z > 1.05 || sel ? `${p.name}${tt ? `（${tt}）` : ''} · ${jobName(p)}` : p.name, color: sel ? '#8a5a10' : COLORS.ink, strong: sel }); }
  }
}

// ---------------- 小字（按屏幕像素画，带矩形防叠与优先保留重要标记） ----------------
export function drawLabels(ctx, cam, labels) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ordered = labels.slice().sort((a, b) => (b.strong ? 1 : 0) - (a.strong ? 1 : 0));
  const placed = [];
  const overlaps = (r, q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0;
  for (const L of ordered) {
    const s0 = toScreen(cam, L);
    if (s0.x < -60 || s0.y < -20 || s0.x > cam.vw + 60 || s0.y > cam.vh + 20) continue;
    ctx.font = `${L.strong ? '600 ' : ''}12px system-ui, "Microsoft YaHei", sans-serif`;
    const w = ctx.measureText(L.text).width;
    const rectAt = dy => ({ x0: s0.x - w / 2 - 5, x1: s0.x + w / 2 + 5, y0: s0.y + dy - 9, y1: s0.y + dy + 9 });
    let dy = 0, box = rectAt(0);
    if (placed.some(q => overlaps(box, q))) {
      if (!L.strong) continue;
      const free = [-18, 18, -36, 36].find(sh => !placed.some(q => overlaps(rectAt(sh), q)));
      if (free === undefined) continue;
      dy = free; box = rectAt(dy);
    }
    placed.push(box);
    const sx = s0.x, sy = s0.y + dy;
    ctx.fillStyle = 'rgba(247, 240, 224, 0.88)';
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(sx - w / 2 - 4, sy - 8, w + 8, 16, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(45, 36, 26, 0.14)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.fillRect(sx - w / 2 - 4, sy - 8, w + 8, 16);
    }
    ctx.fillStyle = L.color || COLORS.ink;
    ctx.fillText(L.text, sx, sy);
  }
  ctx.restore();
}

// ---------------- 天：屏幕顶上一条，写「雨」「火」的地方 ----------------
export function drawSky(ctx, sim, w, top, h, t) {
  const L = sim.now.light ?? 1, hour = sim.now.hour ?? 12, wet = sim.weather.wet;
  ctx.save();
  const g = ctx.createLinearGradient(0, top, 0, top + h);
  const day = wet ? [150, 158, 165] : [176, 196, 214], night = [36, 42, 70];
  const mix = (a, b, k) => a.map((x, i) => Math.round(x * k + b[i] * (1 - k)));
  const kL = Math.max(0, Math.min(1, (L - 0.3) / 0.7));
  const c = mix(day, night, kL);
  g.addColorStop(0, `rgba(${c},0.55)`); g.addColorStop(1, `rgba(${c},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, top, w, h);
  // 日、月按时辰走
  const isDay = hour >= 5 && hour < 19, f = isDay ? (hour - 5) / 14 : ((hour + 24 - 19) % 24) / 10;
  const x = w * (0.08 + 0.84 * f), y = top + h * 0.45 - Math.sin(f * Math.PI) * h * 0.25;
  if (!wet) {
    ctx.globalAlpha = 0.75; ctx.fillStyle = isDay ? '#d9a03a' : '#e8e4d0';
    ctx.beginPath(); ctx.arc(x, y, isDay ? 11 : 8, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#7d8590';
    for (let i = 0; i < 5; i++) { const cx = ((i * 0.23 + t / 90000) % 1) * w; ctx.beginPath(); ctx.ellipse(cx, top + h * 0.35, 46, 12, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 0.85; ctx.fillStyle = kL < 0.48 ? '#f4efe2' : '#2d241a';
  ctx.font = `600 15px ${SERIF}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('天', 12, top + h * 0.45);
  const skyHint = w < 680
    ? '写「雨」降雨 · 「火」降雷火'
    : (sim.era2?.active ? '在这一条上写「雨」降雨、「火」降雷火 · 学会历法在田里写「光」降不季之穗' : '在这一条上写「雨」降雨、「火」降雷火');
  ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif'; ctx.globalAlpha = 0.78;
  ctx.fillText(skyHint, 34, top + h * 0.45);
  ctx.restore();
}

// 雨、雪：屏幕上一层
export function drawWeather(ctx, sim, w, h, t) {
  if (!sim.weather.wet) return;
  ctx.save();
  if (sim.weather.kind === 'snow') {
    // 宣纸是浅色的，白雪看不见：用淡墨点，外加一圈白边
    for (let i = 0; i < 170; i++) {
      const x = ((i * 97.3 + Math.sin(t / 900 + i) * 20) % w + w) % w, y = (i * 211 + t * 0.04) % h, r = 1.4 + (i % 3) * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x, y, r + 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(96,110,135,0.55)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.strokeStyle = 'rgba(60,80,110,0.3)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 180; i++) { const x = (i * 97.3 + t * 0.05) % w, y = (i * 211 + t * 0.6) % h; ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 15); }
    ctx.stroke();
  }
  ctx.restore();
}

// 雷火、圣光、烧荒：按真实时间放一小会儿
export function drawEffects(ctx, fx, now) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], k = (now - f.t0) / f.dur;
    if (k >= 1) { fx.splice(i, 1); continue; }
    ctx.save();
    if (f.kind === 'bolt') {
      polyline(ctx, [{ x: f.x + 40, y: f.y - 600 }, { x: f.x - 14, y: f.y - 260 }, { x: f.x + 24, y: f.y - 140 }, { x: f.x, y: f.y }], { width: 5, color: '#c99a2e', alpha: 1 - k });
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 140);
      g.addColorStop(0, `rgba(255,240,200,${0.6 * (1 - k)})`); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - 140, f.y - 140, 280, 280);
    } else if (f.kind === 'light') {
      for (let j = 0; j < 14; j++) {
        const a = j / 14 * Math.PI * 2 + now / 2000;
        polyline(ctx, [{ x: f.x + Math.cos(a) * 50, y: f.y + Math.sin(a) * 32 }, { x: f.x + Math.cos(a) * 230, y: f.y + Math.sin(a) * 150 }], { width: 3, color: COLORS.gold, alpha: 0.55 * (1 - k) });
      }
    } else if (f.kind === 'burn' || f.kind === 'flare') {
      const r = f.r ? f.r + 60 : 70, g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(200,90,40,${0.5 * (1 - k)})`); g.addColorStop(1, 'rgba(200,90,40,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }
}
