// 农耕与水利系统（第二代 · 彩陶）：
// 铅笔画闭合田界 → 开垦 → 播种 → 生长 → 收割 → 入仓；
// 铅笔画水渠分段施工 → 连河/泉/已通水渠自动引水，连下游自动排涝，旱涝有明显对照。
import { K, DAY, SEASON_DAYS } from './config.js';
import { dist, clamp, log, known, inFlood, addFood, localBuildings } from './util.js';
import { seasonOf, dayInSeason } from './calendar.js';
import { RIVER_HALF } from './mapgen.js';
import { tribeKnows } from './tech.js';
import { area, pointInPolygon, distToPolyline, segIntersect, length, bbox } from '../recog/geom.js';

export function initFarming(sim) {
  sim.fields = [];
  sim.canals = [];
  sim.bridgeCells = new Set();
}

// 抽稀多边形顶点（保留轮廓形状且避免点数过多）
function simplifyPoly(raw, step = 18) {
  if (!raw || raw.length < 3) return [];
  const out = [{ x: raw[0].x, y: raw[0].y }];
  for (let i = 1; i < raw.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(raw[i].x - last.x, raw[i].y - last.y) >= step) out.push({ x: raw[i].x, y: raw[i].y });
  }
  if (out.length >= 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < step * 0.7) out.pop();
  return out;
}

function polyEdgesIntersect(a, b) {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j], b1 = b[(j + 1) % b.length];
      if (segIntersect(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function polyMinDistTo(pts, p) {
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = distToPolyline(p, [a, b]);
    if (d < bd) bd = d;
  }
  return bd;
}

// 校验闭合田界是否合法（不扣任何料和墨）
export function validateFieldPoly(sim, rawPts) {
  if (!Array.isArray(rawPts) || rawPts.length < 4) return { ok: false, msg: '田界笔画太少，画成一个闭合圈' };
  const perim = length(rawPts) + Math.hypot(rawPts[0].x - rawPts[rawPts.length - 1].x, rawPts[0].y - rawPts[rawPts.length - 1].y);
  const gap = Math.hypot(rawPts[0].x - rawPts[rawPts.length - 1].x, rawPts[0].y - rawPts[rawPts.length - 1].y);
  if (perim < K.farm.minPerim || gap > Math.min(85, Math.max(36, 0.18 * perim))) {
    return { ok: false, msg: '田界没有闭合：画一个首尾相接的圈来划田' };
  }
  const pts = simplifyPoly(rawPts, 16);
  if (pts.length < 3) return { ok: false, msg: '田界太窄了，画开一点' };
  for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
    if (i === 0 && j === pts.length - 1) continue; // 相邻两边可以共用端点
    if (segIntersect(pts[i], pts[i + 1], pts[j], pts[(j + 1) % pts.length])) return { ok: false, msg: '田界不能交叉，请沿同一方向圈一整块地' };
  }
  const A = area(pts);
  if (A < K.farm.minArea) return { ok: false, msg: '这块田太小了，画大一点好耕种' };
  if (A > K.farm.maxArea) return { ok: false, msg: '这块田画得太大了，分几块划' };
  const bx = bbox([pts]);
  if (bx.w < 34 || bx.h < 34) return { ok: false, msg: '田太窄了，拉宽一点' };
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const checkPts = [...pts, { x: cx, y: cy }];
  for (const p of checkPts) {
    if (p.x < 30 || p.y < 30 || p.x > sim.map.w - 30 || p.y > sim.map.h - 30) return { ok: false, msg: '田界超出纸边了' };
    if (!known(sim, p.x, p.y)) return { ok: false, msg: '田不能划进白纸里，先探路' };
    if (sim.map.riverDist(p.x, p.y) < RIVER_HALF + 16) return { ok: false, msg: '离河太近，田会被水冲' };
    if (inFlood(sim, p.x, p.y)) return { ok: false, msg: '水正淹着这里，没法划田' };
  }
  for (const f of sim.map.forests) if (dist(f, { x: cx, y: cy }) < f.r - 10 || pts.some(p => dist(f, p) < f.r - 14)) return { ok: false, msg: '田界压到树林了' };
  for (const r of sim.map.rocks) if (dist(r, { x: cx, y: cy }) < r.r + 12 || pts.some(p => dist(r, p) < r.r + 6)) return { ok: false, msg: '田界压到石堆了' };
  for (const b of [...sim.buildings, ...sim.sites]) {
    if (b.type === 'fenceSeg' || b.type === 'levee' || b.type === 'bridge') continue;
    if (pointInPolygon(b, pts) || polyMinDistTo(pts, b) < 22) return { ok: false, msg: `田界压到${b.name}了` };
  }
  for (const f of sim.fires) {
    if (pointInPolygon(f, pts) || polyMinDistTo(pts, f) < 20) return { ok: false, msg: '田界离火堆太近' };
  }
  for (const other of sim.fields || []) {
    if (pointInPolygon({ x: cx, y: cy }, other.pts) || pointInPolygon({ x: other.cx, y: other.cy }, pts)) return { ok: false, msg: '和已有的农田叠在一起了' };
    if (pts.some(p => pointInPolygon(p, other.pts)) || other.pts.some(p => pointInPolygon(p, pts)) || polyEdgesIntersect(pts, other.pts)) {
      return { ok: false, msg: '和已有的农田重叠了' };
    }
  }
  return { ok: true, pts, cx, cy, area: A, box: bx, perim };
}

export function addField(sim, rawPts) {
  const v = validateFieldPoly(sim, rawPts);
  if (!v.ok) return v;
  const n = sim.nextId++;
  const size = clamp(v.area / 14000, 0.45, 2.2);
  const clearBase = (tribeKnows(sim, 'plow') ? 0.7 : 1) * (2.4 + 1.8 * size);
  const f = {
    id: `fld${n}`, n, name: `农田 ${sim.fields.length + 1}`,
    pts: v.pts, x: v.cx, y: v.cy, cx: v.cx, cy: v.cy, area: v.area, box: v.box, size,
    state: 'clearing', // clearing -> fallow -> sowing -> growing -> ripe
    clearWork: +clearBase.toFixed(2), clearDone: 0,
    sowWork: +(1.5 + 1.1 * size).toFixed(2), sowDone: 0,
    harvestWork: +(2.0 + 1.4 * size).toFixed(2), harvestDone: 0,
    growth: 0, moisture: 0.65, fertility: 1.0,
    irrigated: false, drained: false,
    pest: 0, waterlog: 0, droughtHit: 0,
    harvested: false, blessed: false,
    harvests: 0, lastYield: 0, missReason: null,
    created: sim.t,
  };
  sim.fields.push(f);
  sim.idx[f.id] = f;
  updateCanalNetwork(sim);
  sim.dirty.fields = true;
  log(sim, `划定一块新农田（约 ${Math.round(v.area / 100)} 分地）：先等族人开垦整地`, 'god', { field: f.id });
  return { ok: true, field: f };
}

// 农时检查：春天与夏初（第1-5天）适合下种
export function sowSeasonOk(sim) {
  const s = seasonOf(sim.t);
  if (s === 0) return true;
  if (s === 1 && dayInSeason(sim.t) <= 5) return true;
  return false;
}

export function canSowNow(sim, f) {
  if (!f) return { ok: false, reason: '没找到这块田' };
  if (f.state === 'clearing') return { ok: false, reason: '这块田还没开垦好' };
  if (f.state === 'sowing' || f.state === 'growing') return { ok: false, reason: '田里已经种上禾苗了' };
  if (f.state === 'ripe') return { ok: false, reason: '谷子已经熟了，快去收割' };
  if (!f.blessed && !sowSeasonOk(sim)) {
    const s = seasonOf(sim.t);
    const reason = s === 3
      ? '入冬地冻，错过农时，等开春再种（或用「不季之穗」）'
      : s === 2
        ? '入秋太晚，种下去赶不及冬霜前成熟（等开春，或写「光」降不季之穗）'
        : '夏末已近秋，赶不及霜前成熟（等开春，或用「不季之穗」）';
    f.missReason = reason;
    return { ok: false, reason };
  }
  f.missReason = null;
  return { ok: true };
}

export function startSowField(sim, f) {
  const chk = canSowNow(sim, f);
  if (!chk.ok) return chk;
  f.state = 'sowing';
  f.sowDone = 0;
  f.growth = 0;
  f.harvested = false;
  f.droughtHit = 0;
  f.waterlog = 0;
  f.pest = 0;
  f.missReason = null;
  sim.dirty.fields = true;
  return { ok: true };
}

export function canHarvestNow(sim, f) {
  if (!f) return { ok: false, reason: '没找到这块田' };
  if (f.state === 'ripe' && !f.harvested) return { ok: true };
  if (f.state === 'growing') return { ok: false, reason: `禾苗还没成熟（长了 ${Math.round(f.growth * 100)}%），收不了` };
  if (f.state === 'sowing') return { ok: false, reason: '刚刚下种，还没出苗' };
  if (f.state === 'clearing') return { ok: false, reason: '地还没开垦完' };
  return { ok: false, reason: f.harvested ? '这季谷子已经入仓了' : '地里还空着，先播种' };
}

export function harvestField(sim, f, by = null) {
  if (!f || f.state !== 'ripe' || f.harvested) return 0;
  f.harvested = true;
  const sowMul = tribeKnows(sim, 'sow') ? 1.2 : 1;
  const canalMul = (sim.era2?.canal?.stage || 0) >= 2 ? 1.2 : 1;
  const festMul = (sim.buffs?.seasonFest || 0) > sim.t ? 1.15 : 1;
  const fertMul = 0.55 + 0.45 * f.fertility;
  const droughtMul = f.blessed ? Math.max(0.88, clamp(1 - f.droughtHit * 0.45, 0.35, 1)) : clamp(1 - f.droughtHit * 0.45, 0.35, 1);
  const logMul = clamp(1 - f.waterlog * 0.42, 0.4, 1);
  const pestMul = clamp(1 - f.pest * 0.35, 0.45, 1);
  const raw = K.farm.baseYield * f.size * sowMul * canalMul * festMul * fertMul * droughtMul * logMul * pestMul;
  const amt = Math.max(4, Math.round(raw));
  const report = f.irrigated ? '（渠水润田）' : f.droughtHit > 0.25 ? '（旱损减产）' : '';
  addFood(sim, 'grain', amt);
  sim.stats.grainHarvested = (sim.stats.grainHarvested || 0) + amt;
  sim.stats.harvests = (sim.stats.harvests || 0) + 1;
  const dep = tribeKnows(sim, 'rotation') ? 0.14 : 0.28;
  f.fertility = clamp(f.fertility - dep, 0.35, 1);
  f.state = 'fallow';
  f.growth = 0;
  f.sowDone = 0;
  f.harvestDone = 0;
  f.blessed = false;
  f.pest = 0;
  f.droughtHit = 0;
  f.waterlog = 0;
  f.harvests++;
  f.lastYield = amt;
  f.missReason = null;
  sim.dirty.fields = true;
  log(sim, `${by ? by.name : '族人'}收割${f.name}，打了 ${amt} 份谷物入仓${report}`, 'work', { who: by?.id, field: f.id });
  return amt;
}

export function fieldStateText(sim, f) {
  if (!f) return '';
  const tags = [];
  if (f.irrigated) tags.push('通水渠');
  if (f.drained) tags.push('可排涝');
  if (f.blessed) tags.push('不季之穗');
  if (f.pest > 0.1) tags.push('生虫');
  if (f.moisture < 0.36) tags.push('缺水');
  else if (f.moisture > 0.96 && !f.drained) tags.push('积涝');
  const tagStr = tags.length ? ` · ${tags.join(' / ')}` : '';
  if (f.state === 'clearing') return `开垦中 ${Math.round(100 * f.clearDone / f.clearWork)}%${tagStr}`;
  if (f.state === 'fallow') return `${f.missReason ? `待播（${f.missReason}）` : '已整地，待播种'} · 地力 ${Math.round(f.fertility * 100)}%${tagStr}`;
  if (f.state === 'sowing') return `播种中 ${Math.round(100 * f.sowDone / f.sowWork)}%${tagStr}`;
  if (f.state === 'growing') return `生长中 ${Math.round(f.growth * 100)}% · 墒情 ${Math.round(f.moisture * 100)}%${tagStr}`;
  if (f.state === 'ripe') return `已成熟！可收割（约 ${Math.round(K.farm.baseYield * f.size * (0.55 + 0.45 * f.fertility))} 份）${tagStr}`;
  return f.state;
}

function densifyLine(rawPts, step = K.farm.canalSeg) {
  if (!Array.isArray(rawPts) || rawPts.length < 2) return rawPts || [];
  const out = [{ x: rawPts[0].x, y: rawPts[0].y }];
  for (let i = 1; i < rawPts.length; i++) {
    const a = rawPts[i - 1], b = rawPts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) {
      out.push({ x: a.x + (b.x - a.x) * (k / n), y: a.y + (b.y - a.y) * (k / n) });
    }
  }
  return out;
}

// ---------------- 水渠：分段施工、连水、排涝 ----------------
export function validateCanalLine(sim, rawPts) {
  if (!Array.isArray(rawPts) || rawPts.length < 2) return { ok: false, msg: '水渠画太短了' };
  const L = length(rawPts);
  if (L < 70) return { ok: false, msg: '水渠太短了（至少拉 70 步）' };
  const pts = densifyLine(rawPts, K.farm.canalSeg);
  for (const p of pts) {
    if (p.x < 24 || p.y < 24 || p.x > sim.map.w - 24 || p.y > sim.map.h - 24) return { ok: false, msg: '水渠超出纸外了' };
    if (!known(sim, p.x, p.y)) return { ok: false, msg: '水渠不能挖进白纸里，先探路' };
  }
  for (const r of sim.map.rocks) {
    for (let i = 1; i < pts.length; i++) {
      if (distToPolyline(r, [pts[i - 1], pts[i]]) < r.r - 4) {
        return { ok: false, msg: '石堆挡路：水渠要绕开山石挖' };
      }
    }
  }
  return { ok: true, pts };
}

export function addCanal(sim, rawPts, opts = {}) {
  const v = validateCanalLine(sim, rawPts);
  if (!v.ok) return v;
  const segs = [];
  let a = v.pts[0], acc = 0;
  for (let i = 1; i < v.pts.length; i++) {
    acc += dist(v.pts[i - 1], v.pts[i]);
    if (acc >= K.farm.canalSeg || i === v.pts.length - 1) {
      const b = v.pts[i];
      segs.push({
        a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y },
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        need: Math.max(0.7, (acc / K.farm.canalSeg) * K.farm.canalWork),
        work: 0, built: false, wet: false, drains: false,
      });
      a = b; acc = 0;
    }
  }
  const n = sim.nextId++;
  const canal = {
    id: `cn${n}`, n,
    name: opts.name || (opts.grandStage ? `大渠·第${opts.grandStage}段` : `水渠 ${sim.canals.length + 1}`),
    pts: v.pts.map(p => ({ x: p.x, y: p.y })),
    segs,
    built: false, wet: false, drains: false,
    grandStage: opts.grandStage || 0,
    bless: opts.bless || 0,
    blessed: 0,
    waiting: null,
    t: sim.t,
  };
  sim.canals.push(canal);
  sim.idx[canal.id] = canal;
  sim.dirty.canals = true;
  log(sim, `划定${canal.name}（共 ${segs.length} 段）：族人会去挖渠引水`, 'god', { canal: canal.id });
  return { ok: true, canal };
}

function segDist(s1, s2) {
  return Math.min(
    dist(s1, s2),
    dist(s1.a, s2.a), dist(s1.a, s2.b),
    dist(s1.b, s2.a), dist(s1.b, s2.b)
  );
}

export function updateCanalNetwork(sim) {
  const builtSegs = [];
  for (const c of sim.canals) {
    for (const s of c.segs) {
      s.wet = false;
      s.drains = false;
      if (s.built) builtSegs.push({ c, s });
    }
  }
  const nodes = sim.era2?.canal?.nodes;
  // 1. 水源 BFS（贴近河、泉或大渠引水口）
  const qWet = [];
  for (const it of builtSegs) {
    const s = it.s;
    const nearRiver = sim.map.riverDist(s.x, s.y) <= RIVER_HALF + K.farm.canalWaterSnap
      || sim.map.riverDist(s.a.x, s.a.y) <= RIVER_HALF + K.farm.canalWaterSnap
      || sim.map.riverDist(s.b.x, s.b.y) <= RIVER_HALF + K.farm.canalWaterSnap;
    const nearSpring = (sim.map.springs || []).some(sp => dist(sp, s) <= 75 || dist(sp, s.a) <= 75 || dist(sp, s.b) <= 75);
    const nearIntake = nodes?.intake && (dist(nodes.intake, s) <= 85 || dist(nodes.intake, s.a) <= 85 || dist(nodes.intake, s.b) <= 85);
    if (nearRiver || nearSpring || nearIntake) { s.wet = true; qWet.push(s); }
  }
  while (qWet.length) {
    const cur = qWet.shift();
    for (const it of builtSegs) {
      if (it.s.wet) continue;
      if (segDist(cur, it.s) <= 72) { it.s.wet = true; qWet.push(it.s); }
    }
  }

  // 2. 排涝/分洪 BFS（连向下游分洪口、或大渠第3段已通）
  const qDrain = [];
  for (const it of builtSegs) {
    const s = it.s;
    const nearOutfall = nodes?.outfall && (dist(nodes.outfall, s) <= 115 || dist(nodes.outfall, s.a) <= 115 || dist(nodes.outfall, s.b) <= 115);
    const nearDownstream = sim.map.riverDist(s.x, s.y) <= RIVER_HALF + K.farm.canalWaterSnap && s.y > sim.camp.y + 120;
    if (nearOutfall || (it.c.grandStage === 3 && it.c.built) || nearDownstream) { s.drains = true; qDrain.push(s); }
  }
  while (qDrain.length) {
    const cur = qDrain.shift();
    for (const it of builtSegs) {
      if (it.s.drains) continue;
      if (segDist(cur, it.s) <= 72) { it.s.drains = true; qDrain.push(it.s); }
    }
  }

  for (const c of sim.canals) {
    c.built = c.segs.every(s => s.built);
    c.wet = c.segs.some(s => s.wet);
    c.drains = c.segs.some(s => s.drains);
  }

  // 3. 农田灌溉与排涝状态
  for (const f of sim.fields) {
    let irr = false, drn = false;
    for (const it of builtSegs) {
      const s = it.s;
      const d = Math.min(polyMinDistTo(f.pts, s), polyMinDistTo(f.pts, s.a), polyMinDistTo(f.pts, s.b), dist({ x: f.cx, y: f.cy }, s));
      if (s.wet && d <= K.farm.irrigateRange) irr = true;
      if (s.drains && d <= K.farm.drainRange) drn = true;
      if (irr && drn) break;
    }
    f.irrigated = irr;
    f.drained = drn;
  }
}

export function onCanalSegBuilt(sim, canal, seg, by = null) {
  seg.built = true;
  sim.dirty.canals = true;
  const allBuilt = canal.segs.every(s => s.built);
  if (allBuilt) {
    canal.built = true;
    log(sim, `${by ? by.name : '族人'}挖通了${canal.name}`, 'build', { canal: canal.id });
    sim.onCanalBuilt?.(canal, by);
  }
  updateCanalNetwork(sim);
}

// ---------------- 每小时 / 每日农事结算 ----------------
export function farmingHourly(sim) {
  if (!sim.fields.length && !sim.canals.length) return;
  const s = seasonOf(sim.t), N = sim.now;
  const drought = !!(sim.weather.drought || sim.era2?.drought);
  const wet = sim.weather.wet;
  const damPenalty = sim.village?.damming ? 0.55 : 1;

  for (const f of sim.fields) {
    // 墒情演变
    let target = 0.54;
    if (wet) target += 0.28;
    if (drought) target -= 0.34;
    if (sim.era2?.waterlog || inFlood(sim, f.cx, f.cy)) target += 0.44;
    if (f.irrigated) {
      const irrFloor = drought ? 0.78 * damPenalty : 0.86 * damPenalty;
      target = Math.max(target, irrFloor);
    }
    if (f.drained) target = Math.min(target, 0.86);
    target = clamp(target, 0.08, 1.22);
    f.moisture = clamp(f.moisture + (target - f.moisture) * 0.22, 0.05, 1.25);

    if (f.state !== 'growing') continue;
    // 旱损、涝损与虫害
    if (f.moisture < 0.35) f.droughtHit = clamp(f.droughtHit + (0.35 - f.moisture) * 0.055, 0, 1);
    if (f.moisture > 0.96 && !f.drained) f.waterlog = clamp(f.waterlog + (f.moisture - 0.92) * 0.075, 0, 1);
    if (f.pest > 0 && wet) f.pest = Math.max(0, f.pest - 0.04);

    // 生长速度（白天或受祝福成长；水太缺或太涝减慢）
    if (!N.dark || f.blessed) {
      const mFactor = f.moisture < 0.3 ? 0.45 : f.moisture > 0.98 && !f.drained ? 0.65 : (0.85 + 0.3 * clamp(f.moisture, 0, 1));
      const seasonMul = s === 3 ? (f.blessed ? 1.1 : 0.15) : s === 2 ? 0.85 : 1.05;
      const pestMul = 1 - 0.35 * f.pest;
      const fertMul = 0.8 + 0.2 * f.fertility;
      const blessMul = f.blessed ? 1.85 : 1;
      const rate = (1 / (K.farm.growDays * 13)) * mFactor * seasonMul * pestMul * fertMul * blessMul;
      f.growth = Math.min(1, f.growth + rate);
      if (f.growth >= 1) {
        f.state = 'ripe';
        f.harvested = false;
        sim.dirty.fields = true;
        log(sim, `${f.name}的谷穗黄了，可以收割`, 'season', { field: f.id });
      }
    }
  }
}

export function farmingDaily(sim, newSeason) {
  updateCanalNetwork(sim);
  const s = seasonOf(sim.t);
  // 入冬霜冻：未熟的常规禾苗冻枯
  if (newSeason && s === 3) {
    for (const f of sim.fields) {
      if ((f.state === 'growing' || f.state === 'sowing') && !f.blessed) {
        f.state = 'fallow';
        f.growth = 0;
        f.sowDone = 0;
        f.missReason = '入冬下霜，未成熟的禾苗冻枯了';
        sim.dirty.fields = true;
        log(sim, `入冬下霜，${f.name}还没熟的禾苗枯萎了`, 'danger', { field: f.id });
      }
    }
  }
  // 休耕田恢复地力（有轮作或附近有本地畜栏恢复更快）
  const pens = localBuildings(sim, 'pen');
  for (const f of sim.fields) {
    if (f.state === 'fallow') {
      const nearPen = pens.some(p => dist(p, { x: f.cx, y: f.cy }) < 280);
      const rec = 0.06 * (tribeKnows(sim, 'rotation') ? 2 : 1) * (nearPen ? 1.8 : 1);
      f.fertility = clamp(f.fertility + rec, 0.35, 1);
    }
    if (f.state === 'fallow' && f.missReason && sowSeasonOk(sim)) f.missReason = null;
  }
  // 本地陶窑每日烧陶罐，本地畜栏每日产鲜肉
  if (sim.era2?.active) {
    const kilns = localBuildings(sim, 'kiln');
    if (kilns.length && sim.stock.wood >= 2) {
      for (const k of kilns) {
        if ((sim.stock.pottery || 0) >= 24) break;
        const cap = k.cap || 1;
        if (sim.rng() < 0.32 * cap) {
          sim.stock.wood = Math.max(0, sim.stock.wood - 1);
          sim.stock.pottery = (sim.stock.pottery || 0) + 1;
          sim.stats.pottery = (sim.stats.pottery || 0) + 1;
        }
      }
    }
    for (const p of pens) {
      const prod = p.yield || 2;
      if (sim.rng() < 0.45) addFood(sim, 'meat', prod);
    }
  }
}
