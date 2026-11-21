// 建造：工地（要料、要工时）→ 建成后的房子、火塘、晾肉架、篱笆、井、石墙、树苗、营旗、篝火；还有路。
import { K, BUILD, DAY } from './config.js';
import { dist, log, reveal, addFood, FOOD, localBuildings, recalcLocalBonuses } from './util.js';
import { addBarrier } from './beasts.js';
import { roadKey } from './people.js';
import { altarBuilt } from './era.js';
import { cityBuilt } from './era3.js';

const RANK = { fire: 0, hearth: 0, shack: 1, timberhouse: 1, rack: 2, granary: 2, kiln: 2, pen: 2, levee: 2, bench: 3, well: 3, outpost: 3, trap: 3, bridge: 3, altar1: 4, altar2: 4, altar3: 4, cairn: 4, fenceSeg: 5, sapling: 6 };

export function addFire(sim, x, y, o = {}) {
  const n = sim.nextId++;
  const f = { id: `x${n}`, n, x, y, lit: true, fuel: 8, heat: K.fire.heat, radius: K.fire.radius, burnMul: 1, roof: false, kind: 'camp', name: '营火', cook: 0, outSince: 0, ...o };
  sim.fires.push(f); sim.idx[f.id] = f;
  return f;
}
export function removeFire(sim, f) { sim.fires = sim.fires.filter(x => x !== f); delete sim.idx[f.id]; }

export function addSite(sim, type, params = {}, x, y, extra = {}) {
  const n = sim.nextId++, B = BUILD[type];
  const s = {
    id: `s${n}`, n, type, name: B.name, x, y, params, need: { ...(params.need || B.need || {}) }, have: {}, progress: 0,
    work: params.work ?? B.work, built: false, queue: n, rank: (RANK[type] ?? 5) * 1e6 + n, created: sim.t, waiting: null, ...extra,
  };
  sim.sites.push(s); sim.idx[s.id] = s; sim.dirty.buildings = true;
  return s;
}
export function removeSite(sim, s) {
  if (!sim.sites.includes(s)) return false;
  sim.sites = sim.sites.filter(x => x !== s); delete sim.idx[s.id];
  for (const [k, n] of Object.entries(s.have)) sim.stock[k] = (sim.stock[k] || 0) + n; // 料退回去
  sim.dirty.buildings = true;
  return true;
}

function addBuilding(sim, s, extra) {
  const b = { id: s.id, n: s.n, type: s.type, name: s.name, x: s.x, y: s.y, built: true, strokes: s.strokes || null, t: sim.t, ...extra };
  sim.buildings.push(b); sim.idx[b.id] = b;
  return b;
}
// 冲毁、拆掉一座房子（火塘连火一起没了，营地留一堆没点着的营火）
export function destroyBuilding(sim, b) {
  sim.buildings = sim.buildings.filter(x => x !== b);
  delete sim.idx[b.id];
  if (b.type === 'hearth') {
    const f = sim.fires.find(x => x.building === b.id);
    if (f) removeFire(sim, f);
    if (!sim.fires.some(x => dist(x, sim.camp) < sim.camp.r + 60)) addFire(sim, sim.camp.x, sim.camp.y, { lit: false, fuel: 0 });
  }
  if (b.type === 'shack' || b.type === 'timberhouse') sim.assignBeds?.();
  if (b.type === 'bench' || b.type === 'granary' || b.type === 'kiln' || b.type === 'pen') recalcLocalBonuses(sim);
  if (b.type === 'bridge') { sim.bridgeCells = new Set(); for (const x of sim.buildings) if (x.type === 'bridge') markBridge(sim, x); }
  if (b.type === 'levee') sim.levees = sim.levees.filter(L => L.id !== b.id);
  sim.dirty.buildings = true;
}

export function completeSite(sim, s, by) {
  s.built = true;
  sim.sites = sim.sites.filter(x => x !== s);
  delete sim.idx[s.id]; // 建筑沿用此 ID；火、树苗和屏障则各有自己的 ID
  sim.dirty.buildings = true;
  const who = by ? `${by.name}他们` : '族人';
  const P = s.params || {};
  sim.stats.built[s.type] = (sim.stats.built[s.type] || 0) + 1;
  switch (s.type) {
    case 'shack':
      addBuilding(sim, s, { cap: P.cap, warmth: P.warmth, rainproof: P.rainproof, sturdy: P.sturdy });
      log(sim, `${who}照神的图纸搭起一座窝棚，能住 ${P.cap} 人`, 'build');
      sim.assignBeds();
      break;
    case 'hearth': {
      addBuilding(sim, s, { heat: P.heat, radius: P.radius });
      const old = sim.fires.find(f => f.kind === 'camp' && dist(f, s) < sim.camp.r + 60);
      addFire(sim, s.x, s.y, { kind: 'hearth', name: '火塘', heat: P.heat, radius: P.radius, burnMul: P.burnMul, roof: P.roof, cook: P.cook, lit: old ? old.lit : true, fuel: old ? Math.max(old.fuel, 4) : 6, building: s.id });
      if (old) removeFire(sim, old);
      log(sim, `${who}照图垒好了火塘，营火挪进了火塘里（暖 ${P.heat}°，省柴 ${Math.round((1 - P.burnMul) * 100)}%）`, 'build');
      break;
    }
    case 'rack':
      addBuilding(sim, s, { cap: P.cap, dryH: P.dryH, sturdy: P.sturdy, load: [] });
      log(sim, `${who}立起晾肉架：一次晾 ${P.cap} 份肉，约 ${Math.round(P.dryH / 2)} 个时辰晾干`, 'build');
      break;
    case 'fenceSeg': {
      s.seg.built = true; s.seg.broken = false;
      addBarrier(sim, { kind: 'fence', pts: [s.seg.a, s.seg.b], hp: P.hp, height: P.height, sharp: P.sharp || 0, seg: s.seg, fence: s.fence });
      const fence = sim.idx[s.fence];
      if (fence && !fence.done && fence.segs.every(g => g.built)) { fence.done = true; log(sim, `篱笆合拢了：${fence.segs.length} 段，每段承受 ${P.hp}`, 'build'); }
      sim.dirty.barriers = true;
      break;
    }
    case 'well':
      addBuilding(sim, s, {});
      log(sim, `${who}挖出一口井`, 'build');
      break;
    case 'cairn':
      addBuilding(sim, s, { wall: s.wall });
      addBarrier(sim, { kind: 'wall', pts: s.wall, hp: 260, site: s.id });
      sim.dirty.barriers = true;
      log(sim, `${who}垒起一道石墙`, 'build');
      break;
    case 'sapling': {
      const g = s.grove;
      for (const t of g.trees) { t.regrow = sim.t + 14 * DAY; }
      sim.map.forests.push(g); sim.idx[g.id] = g;
      for (const t of g.trees) sim.idx[t.id] = t;
      sim.dirty.trees = true;
      log(sim, `${who}栽下一片树苗，半年后成林`, 'build');
      break;
    }
    case 'outpost':
      addBuilding(sim, s, {});
      reveal(sim, s.x, s.y, 240);
      log(sim, `${who}立起营旗，打的东西可以就近放下`, 'build');
      break;
    case 'fire':
      addFire(sim, s.x, s.y, { kind: 'field', name: '篝火', fuel: 9 });
      log(sim, `${who}在野地里生起一堆篝火`, 'build');
      break;
    case 'bench':
      addBuilding(sim, s, { tool: P.tool, research: P.research });
      recalcLocalBonuses(sim);
      log(sim, `${who}照图搭起石器台：会打石器的人干活再快 ${Math.round(P.tool * 100)}%，琢磨手艺快 ${Math.round(P.research * 100)}%`, 'build');
      break;
    case 'granary':
      addBuilding(sim, s, { cap: P.cap, dampProof: P.dampProof, sturdy: P.sturdy });
      recalcLocalBonuses(sim);
      log(sim, `${who}照图立起公共粮仓：可护住 ${P.cap} 份谷物，防潮防鼠`, 'build');
      break;
    case 'kiln':
      addBuilding(sim, s, { cap: P.cap, heat: P.heat, sturdy: P.sturdy });
      recalcLocalBonuses(sim);
      log(sim, `${who}照图砌好一座陶窑：日后烧出的陶罐能久存谷物`, 'build');
      break;
    case 'timberhouse':
      addBuilding(sim, s, { cap: P.cap, warmth: P.warmth, rainproof: P.rainproof, sturdy: P.sturdy });
      sim.assignBeds();
      log(sim, `${who}照图盖起宽敞木构房，一户可住 ${P.cap} 人`, 'build');
      break;
    case 'pen':
      addBuilding(sim, s, { yield: P.yield, sturdy: P.sturdy, neat: P.neat });
      recalcLocalBonuses(sim);
      log(sim, `${who}围好畜栏：每天能产肉，旁边的农田也更肥`, 'build');
      break;
    case 'bridge': {
      const b = addBuilding(sim, s, { speedMul: P.speedMul, sturdy: P.sturdy, span: P.span, angle: s.angle || 0 });
      markBridge(sim, b);
      log(sim, `${who}在河上架起木桥：两岸挑粮过河再不涉水减速`, 'build');
      break;
    }
    case 'trap':
      addBuilding(sim, s, { catch: P.catch, deadly: P.deadly, meat: 0, hides: 0, sprung: false, caught: 0 });
      log(sim, `${who}挖好一个陷阱：一天约 ${Math.round(P.catch * 100)}% 的机会逮到野物`, 'build');
      break;
    case 'citywall': case 'palace': case 'workshop': case 'furnace': case 'market': case 'temple': case 'cartway': case 'bell': {
      const b = addBuilding(sim, s, { params: P, pts: s.pts, integrity: 1 });
      if (b.type === 'cartway') for (let i = 1; i < b.pts.length; i++) markRoad(sim, { a: b.pts[i - 1], b: b.pts[i] });
      log(sim, `${who}照图修好了${b.name}`, 'build');
      cityBuilt(sim, b);
      break;
    }
    case 'altar1': case 'altar2': case 'altar3':
      altarBuilt(sim, s, who);
      break;
    case 'levee': {
      for (const L of sim.levees.filter(L => L.broken && dist(L, s) < 160)) destroyBuilding(sim, sim.idx[L.id]);
      const b = addBuilding(sim, s, { pts: s.pts });
      sim.levees.push({ id: b.id, x: s.x, y: s.y, guard: 230, pts: s.pts });
      log(sim, `${who}在河边垒起一道堤：小的山洪漫不过来了`, 'build');
      break;
    }
  }
}

// 每天：陷阱逮野物；离林子、鹿群近的逮得多
export function trapsDaily(sim) {
  for (const b of sim.buildings) {
    if (b.type !== 'trap' || b.sprung) continue;
    const forest = sim.map.forests.some(f => dist(f, b) < f.r + 120), herd = sim.herds.some(h => h.n > 0 && dist(h, b) < 400);
    const ch = b.catch * (forest ? 1.25 : 1) * (herd ? 1.2 : 1) * (dist(b, sim.camp) < 200 ? 0.5 : 1) * (sim.now.season === 3 ? 0.6 : 1);
    if (sim.rng() < ch) {
      const big = sim.rng() < 0.15;
      b.meat = (b.meat || 0) + (big ? 8 : 3); if (big) b.hides = (b.hides || 0) + 1;
      b.caught++; sim.stats.trapped = (sim.stats.trapped || 0) + 1;
      if (b.meat >= 6 && sim.rng() < 0.5) b.sprung = true;
    }
  }
}

// 篱笆：按图纸量出的数值，沿铅笔画的走向每 40 一段开工
export function placeFence(sim, params, pts, strokes) {
  const segs = [];
  let acc = 0, a = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let p0 = pts[i - 1];
    const p1 = pts[i];
    let L = dist(p0, p1);
    while (acc + L >= 40) {
      const k = (40 - acc) / L, q = { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k };
      segs.push({ a, b: q, built: false });
      a = q; p0 = q; L = dist(p0, p1); acc = 0;
    }
    acc += L;
  }
  if (acc > 12) segs.push({ a, b: pts[pts.length - 1], built: false });
  const n = sim.nextId++;
  const fence = { id: `F${n}`, n, segs, params, pts, strokes, done: false, t: sim.t };
  sim.fences.push(fence); sim.idx[fence.id] = fence;
  for (const seg of segs) {
    const len = dist(seg.a, seg.b) / 40;
    addSite(sim, 'fenceSeg', { need: { wood: Math.max(1, Math.round(params.woodPer40 * len)) }, work: params.workPer40 * len, hp: params.hp, height: params.height, sharp: params.sharp || 0 },
      (seg.a.x + seg.b.x) / 2, (seg.a.y + seg.b.y) / 2, { fence: fence.id, seg });
  }
  return fence;
}
// 撞破的一段：再开一个工地
export function repairFence(sim, w) {
  const fence = sim.idx[w.fence];
  if (!fence) return;
  w.seg.built = false; w.seg.broken = true;
  const P = fence.params;
  addSite(sim, 'fenceSeg', { need: { wood: Math.max(1, Math.round(P.woodPer40 * 0.6)) }, work: P.workPer40 * 0.6, hp: P.hp, height: P.height, sharp: P.sharp || 0 },
    (w.seg.a.x + w.seg.b.x) / 2, (w.seg.a.y + w.seg.b.y) / 2, { fence: fence.id, seg: w.seg, repair: true });
}

// 路：每 60 一段，一段约一个时辰
export function addRoad(sim, pts) {
  const segs = [];
  let a = pts[0], acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += dist(pts[i - 1], pts[i]);
    if (acc >= 60 || i === pts.length - 1) {
      const b = pts[i];
      segs.push({ a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, need: Math.max(0.4, acc / 60), work: 0, built: false });
      a = b; acc = 0;
    }
  }
  const n = sim.nextId++;
  const road = { id: `R${n}`, n, pts, segs, t: sim.t };
  sim.roads.push(road); sim.idx[road.id] = road;
  return road;
}
export function markBridge(sim, b) {
  if (!sim.bridgeCells) sim.bridgeCells = new Set();
  const half = (b.span || 100) * 0.6, a = b.angle || 0;
  const ca = Math.cos(a), sa = Math.sin(a);
  for (let u = -half; u <= half; u += 15) {
    for (let v = -24; v <= 24; v += 12) {
      sim.bridgeCells.add(roadKey(b.x + ca * u - sa * v, b.y + sa * u + ca * v));
    }
  }
}

export function markRoad(sim, seg) {
  const L = dist(seg.a, seg.b), k = Math.max(1, Math.ceil(L / 8));
  for (let i = 0; i <= k; i++) {
    const x = seg.a.x + (seg.b.x - seg.a.x) * i / k, y = seg.a.y + (seg.b.y - seg.a.y) * i / k;
    for (const [ox, oy] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) sim.roadCells.add(roadKey(x + ox, y + oy));
  }
  sim.dirty.roads = true;
}

// 每小时：晾肉架收鲜肉、晾干（仅统计当前营地范围内的本地晾肉架）
export function racksHourly(sim) {
  for (const r of localBuildings(sim, 'rack')) {
    let free = r.cap - r.load.reduce((s, x) => s + x.n, 0);
    if (free >= 1) {
      for (const b of [...sim.stock.food]) {
        if (free < 1) break;
        if (b.kind !== 'meat' && b.kind !== 'fish') continue;
        const n = Math.min(b.n, free);
        b.n -= n; free -= n;
        r.load.push({ kind: b.kind, n, h: 0 });
        if (b.n <= 0.001) sim.stock.food.splice(sim.stock.food.indexOf(b), 1);
      }
    }
    const smoke = sim.known?.smoke > 0;
    if (sim.weather.wet) {
      const load = r.load.reduce((s, x) => s + x.n, 0);
      if (load >= 2 && sim.rng() < Math.max(0, 0.55 - (r.sturdy ?? 1)) * 0.08) {
        let lost = 0;
        for (const it of r.load) { const k = Math.ceil(it.n * 0.5); it.n -= k; lost += k; }
        r.load = r.load.filter(it => it.n > 0);
        sim.stats.rackLost = (sim.stats.rackLost || 0) + lost;
        log(sim, `风雨把晾肉架刮歪了，掉进泥里 ${lost} 份肉`, 'waste');
      }
      if (!smoke) continue;             // 会熏肉的，下雨天架下烧烟接着熏
    }
    for (const it of [...r.load]) {
      it.h += smoke ? 1.6 : 1;
      if (it.h >= r.dryH) { addFood(sim, 'dried', it.n); sim.stats.dried += it.n; r.load.splice(r.load.indexOf(it), 1); }
    }
  }
}
export const FOOD_KINDS = Object.keys(FOOD);
