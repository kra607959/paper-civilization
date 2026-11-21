// 模拟里到处要用的小工具：距离、日志、迷雾、库存、火。
import { MAP, K, DAY } from './config.js';
import { seasonOf } from './calendar.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// ---------------- 日志 ----------------
// kind：birth 生 / death 死 / god 神迹号令 / build 建造 / danger 险情 / season 时令 / work 劳作 / refuse 不从 / waste 浪费
export function log(sim, text, kind = 'info', extra = {}) {
  const e = { t: sim.t, text, kind, ...extra };
  sim.log.push(e);
  if (sim.log.length > 600) sim.log.splice(0, sim.log.length - 600);
  sim.onLog?.(e);
  return e;
}

// ---------------- 迷雾（白纸） ----------------
export const FOG = { cols: Math.ceil(MAP.w / MAP.cell), rows: Math.ceil(MAP.h / MAP.cell) };
export function reveal(sim, x, y, r) {
  const c = MAP.cell, i0 = Math.max(0, Math.floor((x - r) / c)), i1 = Math.min(FOG.cols - 1, Math.floor((x + r) / c));
  const j0 = Math.max(0, Math.floor((y - r) / c)), j1 = Math.min(FOG.rows - 1, Math.floor((y + r) / c));
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * FOG.cols + i;
    if (sim.fog[k]) continue;
    const cx = (i + 0.5) * c, cy = (j + 0.5) * c;
    if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) { sim.fog[k] = 1; n++; }
  }
  if (n) { sim.revealed += n; sim.dirty.fog = true; }
  return n;
}
export function known(sim, x, y) {
  const i = Math.floor(x / MAP.cell), j = Math.floor(y / MAP.cell);
  if (i < 0 || j < 0 || i >= FOG.cols || j >= FOG.rows) return false;
  return sim.fog[j * FOG.cols + i] === 1;
}

// ---------------- 食物与本地营地范围 ----------------
export const isLocalBuilding = (sim, b, r = K.campActiveR) => !!b && dist(b, sim.camp) <= r;
export const localBuildings = (sim, type, r = K.campActiveR) => sim.buildings.filter(b => b.type === type && isLocalBuilding(sim, b, r));

export function recalcLocalBonuses(sim) {
  const benches = localBuildings(sim, 'bench');
  sim.benchTool = benches.length ? Math.max(...benches.map(x => x.tool || 0)) : 0;
  sim.granaryCap = localBuildings(sim, 'granary').reduce((s, x) => s + (x.cap || 0), 0);
  sim.kilnCount = localBuildings(sim, 'kiln').length;
  sim.penCount = localBuildings(sim, 'pen').length;
}

export const FOOD = {
  berry: { name: '浆果', val: 0.34, keep: 4 },
  nut: { name: '坚果', val: 0.42, keep: 20 },
  meat: { name: '鲜肉', val: 0.4, cooked: 0.55, keep: 3 },
  fish: { name: '鱼', val: 0.36, cooked: 0.5, keep: 2 },
  dried: { name: '干肉', val: 0.5, keep: 40 },
  root: { name: '块根', val: 0.32, keep: 14 },
  grain: { name: '谷物', val: 0.44, cooked: 0.56, keep: 18 },
};
export function foodKeepDays(sim, kind) {
  let keep = FOOD[kind].keep;
  const granary = sim.granaryCap || 0;
  const jars = sim.stock?.pottery || 0;
  if (kind === 'grain') {
    if (granary > 0) keep += Math.min(57, 15 + granary * 0.25); // 本地公共粮仓最高延至 75 天
    if (jars > 0) keep += Math.min(40, jars * 6);                // 陶罐保鲜最高再延 40 天（至 115 天）
  } else if (kind === 'dried' && jars > 0) {
    keep += Math.min(20, jars * 3);
  }
  return keep;
}
export function addFood(sim, kind, n) {
  if (n <= 0) return;
  const exp = sim.t + foodKeepDays(sim, kind) * DAY;
  const last = sim.stock.food.find(b => b.kind === kind && Math.abs(b.exp - exp) < 240);
  if (last) last.n += n;
  else sim.stock.food.push({ kind, n, exp });
  sim.stats.food[kind] = (sim.stats.food[kind] || 0) + n;
}
export const rackLoad = sim => localBuildings(sim, 'rack').reduce((s, b) => s + b.load.reduce((a, x) => a + x.n, 0), 0);
export const foodTotal = sim => sim.stock.food.reduce((s, b) => s + b.n, 0) + rackLoad(sim);
// 吃一份：先吃最快坏的；库里没了才去本地架子上取
export function takeFood(sim, cookedOk) {
  let best = null;
  for (const b of sim.stock.food) if (b.n > 0 && (!best || b.exp < best.exp)) best = b;
  let kind;
  if (best) {
    kind = best.kind;
    best.n -= 1;
    if (best.n <= 0.001) sim.stock.food.splice(sim.stock.food.indexOf(best), 1);
  } else {
    const rack = localBuildings(sim, 'rack').find(b => b.load.length);
    if (!rack) return null;
    const it = rack.load[0];
    kind = it.kind;
    it.n -= 1;
    if (it.n <= 0.001) rack.load.shift();
  }
  const F = FOOD[kind];
  sim.stats.eaten += 1;
  let val = cookedOk && F.cooked ? F.cooked : F.val;
  if (kind === 'grain' && sim.known?.mill > 0) val *= 1.35; // 石磨磨面：一份顶一份半
  return { kind, val, cooked: !!(cookedOk && F.cooked) };
}

// ---------------- 火 ----------------
export const litFires = sim => sim.fires.filter(f => f.lit);
export function nearestFire(sim, p, litOnly = true) {
  let best = null, bd = Infinity;
  for (const f of sim.fires) {
    if (litOnly && !f.lit) continue;
    const d = dist(f, p);
    if (d < bd) { bd = d; best = f; }
  }
  return best ? { fire: best, d: bd } : null;
}
// 营地的主火：离营地中心最近的那一堆（灭了的也算）
export function mainFire(sim) {
  let best = null, bd = Infinity;
  for (const f of sim.fires) { const d = dist(f, sim.camp); if (d < bd) { bd = d; best = f; } }
  return best && bd < sim.camp.r + 60 ? best : null;
}
export function fireHeatAt(sim, p) {
  let heat = 0;
  for (const f of sim.fires) {
    if (!f.lit) continue;
    const d = dist(f, p);
    if (d < f.radius) heat = Math.max(heat, f.heat * (1 - 0.5 * d / f.radius));
  }
  return heat;
}
export const burnRate = (sim, f, dark) => (dark ? K.fire.burnNight : K.fire.burnDay) * (seasonOf(sim.t) === 3 ? K.fire.winterMul : 1) * f.burnMul * (sim.weather.wet && !f.roof ? 1.5 : 1) * (sim.known?.keepfire ? 0.8 : 1);

// 放下东西的地方：营地或最近的营旗
export function dropPoint(sim, p) {
  let best = sim.camp, bd = dist(p, sim.camp);
  for (const b of sim.buildings) if (b.type === 'outpost') { const d = dist(p, b); if (d < bd) { bd = d; best = b; } }
  return best;
}

export const adults = sim => sim.alive.filter(p => p.age >= 14);
export const isAdult = p => p.age >= 14;
export const isElder = p => p.age >= 50;

// ---------------- 大水 ----------------
export function floodRainLocked(sim) {
  return !!((sim.era?.floodSoon && !sim.era.flooded) ||
    (sim.era2?.floodSoon && !sim.era2.floodActive && !sim.era2.done));
}

// 水线以内（离河中心 RIVER_HALF + w）都淹；小山洪挡得住的地方：河堤后面
export function inFlood(sim, x, y) {
  const f = sim.flood;
  if (!f || sim.map.riverDist(x, y) >= 28 + f.w) return false;
  const V = sim.map.valley;
  if (f.great && V && Math.hypot(x - V.x, y - V.y) < V.r + 60) return false; // 新河谷地势高，淹不到
  if (f.era2 && sim.era2?.diverted && sim.map.riverDist(x, y) > 85) return false; // 大渠分洪泄入下游，保住河谷田村
  if (!f.great) for (const L of sim.levees) if (!L.broken && Math.hypot(x - L.x, y - L.y) < L.guard && sim.map.riverDist(x, y) > 40) return false;
  return true;
}
// 离 p 最近的、水淹不到的地方（顺着离河的方向往外走）
export function dryPoint(sim, p, pad = 50) {
  const f = sim.flood, w = (f ? f.w : 0) + 28 + pad;
  let best = null;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2;
    for (let d = 40; d < 900; d += 40) {
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x < 30 || y < 30 || x > sim.map.w - 30 || y > sim.map.h - 30) break;
      if (sim.map.riverDist(x, y) > w) { if (!best || d < best.d) best = { x, y, d }; break; }
    }
  }
  return best || { x: p.x, y: p.y, d: 0 };
}
