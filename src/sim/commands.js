// 神的三支笔落到模拟里：墨笔号令（要墨）、朱笔（线、禁区、✕ 禁、○ 护）、铅笔（探路、修路、迁徙、图纸落地）。
// 每个号令先查办不办得成，办成了才扣墨；能撤回的返回 undo（界面上 3 秒内可撤）。
import { K, ACTIONS, LOCKED, TECH_LOCKS, TECHS, DAY, BUILD, ERA3_DESIGNS } from './config.js';
import { contextById, symbolById } from '../recog/symbols.js';
import { endurance } from '../recog/redpen.js';
import { length as plen, pointInPolygon, segIntersect } from '../recog/geom.js';
import { dist, clamp, log, known, reveal, inFlood, floodRainLocked } from './util.js';
import { setJob, orderOf } from './people.js';
import { scareBeast, killBeast, addBarrier, removeBarrier, placeName } from './beasts.js';
import { addSite, removeSite, addFire, placeFence, addRoad } from './build.js';
import { RIVER_HALF, nearestRiverPoint } from './mapgen.js';
import { tribeKnows } from './tech.js';
import { bandH } from './band.js';
import { designLock, altarInk, altarBless, startMarch } from './era.js';
import { addField, startSowField, canHarvestNow, addCanal, updateCanalNetwork } from './farming.js';
import { villageH, matchGrandCanalStage, startGrandCanal } from './era2.js';
import { cityTarget, applyCityGlyph, lockCityGlyph } from './era3.js';
import { bronzeIds, BRONZE_GLYPHS } from '../recog/bronze.js';

export const verbOf = (ctx, sym) => {
  const ids = bronzeIds(ctx), g = BRONZE_GLYPHS[sym];
  return ids ? (ids.includes(sym) ? { verb: g.name, ink: g.ink, confirm: ['recruit', 'trade'].includes(sym) } : null) : contextById(ctx).verbs?.[sym] || null;
};
// 还没学会的：下一代才有（LOCKED），或要先研究某项技艺（TECH_LOCKS）
export const lockOf = (sim, ctx, sym) => {
  if (bronzeIds(ctx)?.includes(sym)) return lockCityGlyph(sim, ctx, sym);
  const key = `${ctx}:${sym}`;
  if (LOCKED[key]) return '下一代';
  const t = TECH_LOCKS[key];
  return t && !(sim && tribeKnows(sim, t)) ? `先研究「${TECHS[t].name}」` : null;
};
export const isLocked = (ctx, sym, sim = null) => !!lockOf(sim, ctx, sym);
// 这个语境里眼下能写的符（识别时只比这几个）
export const unlockedCands = (ctx, sim = null) => (bronzeIds(ctx) || Object.keys(contextById(ctx).verbs || {})).filter(s => !isLocked(ctx, s, sim) && (bronzeIds(ctx) || ACTIONS[`${ctx}:${s}`]));

// ---------------- 画在什么上面 ----------------
export function targetAt(sim, x, y) {
  if (x < 0 || y < 0 || x > sim.map.w || y > sim.map.h) return { ctx: null, why: '纸外头' };
  if (!known(sim, x, y)) return { ctx: null, why: '那边还是白纸，先派人去探路' };
  const p = { x, y };
  const city = cityTarget(sim, p);
  if (city) return city;
  let best = null, bd = 70;
  for (const b of sim.beasts) if (!b.dead && !b.gone && known(sim, b.x, b.y)) { const d = dist(b, p); if (d < bd) { bd = d; best = b; } }
  for (const rd of sim.raiders || []) if (!rd.dead && !rd.gone && known(sim, rd.x, rd.y)) { const d = dist(rd, p); if (d < bd) { bd = d; best = rd; } }
  for (const h of sim.herds) if (h.n > 0 && known(sim, h.x, h.y)) { const d = dist(h, p) - 12; if (d < bd) { bd = d; best = h; } }
  if (best) return { ctx: 'beast', ref: best.id, x: best.x, y: best.y, name: best.kind === 'herd' ? `鹿群（${best.n} 头）` : best.name, kind: best.kind };
  const B = sim.band;
  if (B && B.met && !B.merged && !B.gone) {
    for (const z of sim.strangers) if (dist(z, p) < 30) return { ctx: 'band', ref: z.id, x: z.x, y: z.y, name: `${B.name}的${z.name}` };
    if (dist(B, p) < 90 && known(sim, B.x, B.y)) return { ctx: 'band', ref: 'band', x: B.x, y: B.y, name: `${B.name}的营地` };
  }
  const V = sim.village;
  if (sim.era2?.active && V && dist(V, p) < 95 && known(sim, V.x, V.y)) return { ctx: 'village', ref: 'village', x: V.x, y: V.y, name: V.name };
  let person = null, pd = 24;
  for (const q of sim.alive) {
    if (q.inside || !known(sim, q.x, q.y)) continue;
    const d = Math.min(dist(q, p), Math.hypot(q.x - x, q.y - (q.asleep ? 3 : 15) - y));
    if (d < pd) { pd = d; person = q; }
  }
  if (person) return { ctx: 'folk', ref: person.id, x: person.x, y: person.y, name: person.name };
  for (const f of sim.fields || []) if (pointInPolygon(p, f.pts)) return { ctx: 'field', ref: f.id, x: f.cx, y: f.cy, name: f.name };
  if (dist(p, sim.camp) < sim.camp.r) return { ctx: 'folk', ref: 'camp', x: sim.camp.x, y: sim.camp.y, name: '营地' };
  for (const f of sim.map.forests) if (dist(f, p) < f.r + 18 && known(sim, f.x, f.y)) return { ctx: 'wood', ref: f.id, x: f.x, y: f.y, name: f.planted ? '新栽的林子' : '树林' };
  for (const pt of sim.map.patches) if (dist(pt, p) < pt.r + 16) return { ctx: 'wood', ref: pt.id, x: pt.x, y: pt.y, name: '浆果丛', patch: true };
  for (const r of sim.map.rocks) if (dist(r, p) < r.r + 26) return { ctx: 'rock', ref: r.id, x: r.x, y: r.y, name: '石堆' };
  if (sim.map.riverDist(x, y) < RIVER_HALF + 22) return { ctx: 'river', ref: 'river', x, y, name: '河' };
  return { ctx: 'land', ref: null, x, y, name: '空地' };
}

// ---------------- 号令 ----------------
const OBEY = { 勤: 0.1, 懒: -0.05, 勇: 0, 怯: 0.05, 和: 0.05, 倔: -0.18 };
export const obeyOf = (p, rally = false, chief = 0) => clamp(0.55 + 0.45 * p.love + 0.3 * p.fear + (OBEY[p.temper] || 0) - (p.fatigue > 0.85 ? 0.25 : 0) + (rally ? 0.3 : 0) + chief, 0.05, 0.98);
// 首领在、没病：大家更肯听；学会村规也更齐心
const chiefBonus = sim => {
  const c = sim.idx[sim.roles?.chief];
  return (c && c.alive && !c.lost && !(c.sick > 0) ? 0.08 : 0) + (sim.era2?.active && tribeKnows(sim, 'villageRule') ? 0.08 : 0);
};

export function issueOrder(sim, o) {
  const n = sim.nextId++;
  const ord = { id: `o${n}`, n, members: [], done: false, t: sim.t, until: sim.t + o.hours * 60, ...o };
  const rally = o.job === 'rally' || o.job === 'migrate';
  const ok = p => (rally ? p.age >= 5 : p.age >= 14) && !(p.sick > 0) && !p.lost && p.health > 0.35 && !((o.job === 'hunt' || o.job === 'fight') && p.age >= 50) && !(sim.march && sim.march.members.includes(p.id));
  const at = { x: o.x ?? sim.camp.x, y: o.y ?? sim.camp.y };
  const skill = { chop: 'chop', gather: 'gather', quarry: 'quarry', fish: 'fish', hunt: 'hunt', fight: 'hunt', build: 'build', road: 'build' }[o.job];
  const pool = sim.alive.filter(ok).sort((a, b) => score(a) - score(b));
  function score(p) { return dist(p, at) + (orderOf(sim, p) ? 900 : 0) - (skill ? p.skills[skill] * 500 : 0) + (p.asleep ? 300 : 0); }
  const refused = [];
  for (const p of pool) {
    if (ord.members.length >= o.n) break;
    if (sim.rng() < obeyOf(p, rally, chiefBonus(sim))) { ord.members.push(p.id); p.order = ord.id; setJob(sim, p, null); }
    else refused.push(p);
  }
  if (refused.length && !rally) {
    const why = p => (p.fatigue > 0.85 ? '累坏了' : p.temper === '倔' ? '嘟囔着不肯去' : '装没看见');
    log(sim, refused.slice(0, 3).map(p => `${p.name}${why(p)}`).join('；'), 'refuse');
    sim.stats.refused += refused.length;
  }
  if (!ord.members.length) return null;
  sim.orders.push(ord);
  return ord;
}
function cancelOrder(sim, ord) {
  sim.orders = sim.orders.filter(o => o !== ord);
  for (const id of ord.members) { const p = sim.idx[id]; if (p && p.order === ord.id) { p.order = null; if (p.alive) setJob(sim, p, null); } }
}

const fail = (msg, extra = {}) => ({ ok: false, msg, ...extra });
const done = (msg, undo = null, extra = {}) => ({ ok: true, msg, undo, ...extra });
function bump(sim, field, d, near = null, r = 0) {
  const prev = sim.alive.map(p => [p, p[field]]);
  // 爱戴越高越难再涨：神迹看惯了
  for (const p of sim.alive) if (!near || dist(p, near) < r) p[field] = clamp(p[field] + (field === 'love' && d > 0 ? d * (1.2 - p[field]) : d));
  return () => { for (const [p, v] of prev) p[field] = v; };
}
const orderUndo = (sim, ord) => () => cancelOrder(sim, ord);
function orderDone(sim, o, verb) {
  const ord = issueOrder(sim, o);
  if (!ord) return fail('没人肯去');
  const names = ord.members.map(id => sim.idx[id].name);
  return done(`${names.slice(0, 4).join('、')}${names.length > 4 ? ` 等 ${names.length} 人` : ''}去${verb}`, orderUndo(sim, ord), { order: ord });
}

const H = {
  rain(sim) {
    const w = sim.weather;
    if (w.wet) return fail('已经在下了');
    const prev = { ...w }, wasDrought = w.drought, dry = w.dry;
    startRain(sim, 6 * 60);
    const undoLove = bump(sim, 'love', wasDrought ? 0.08 : 0.01);
    if (wasDrought) sim.stats.droughtRain++;
    return done(wasDrought ? `旱了 ${dry} 天的地终于湿了，族人跪在雨里` : '下雨了', () => { Object.assign(w, prev); undoLove(); });
  },
  bolt(sim, a) {
    if (a.x == null) return fail('点地图上要劈的地方', { needTarget: true });
    if (!known(sim, a.x, a.y)) return fail('那边还是白纸');
    const p = { x: a.x, y: a.y }, hit = [];
    for (const b of sim.beasts) if (!b.dead && !b.gone && dist(b, p) < 80 + (b.r || 0)) { killBeast(sim, b, b.kind === 'swarm' ? '雷火落进蝗虫群，烧得满天焦翅' : `雷火劈死了${b.name}`); hit.push(b.name); }
    for (const rd of sim.raiders || []) if (!rd.dead && !rd.gone && dist(rd, p) < 80) { rd.dead = true; log(sim, '雷火落进骑手里，劈倒了劫掠者', 'work'); hit.push('劫掠骑手'); }
    for (const f of sim.map.forests) for (const t of f.trees) if (t.alive && dist(t, p) < 45) { t.alive = false; t.wood = 0; t.burnt = true; t.regrow = sim.t + 40 * DAY; sim.dirty.trees = true; hit.push('树'); }
    for (const q of [...sim.alive]) if (dist(q, p) < 34) { (sim.die)(q, '雷'); hit.push(q.name); }
    for (const h of sim.herds) if (h.n > 0 && dist(h, p) < 200) { h.flee = sim.t + 60; h.fx = h.x + (h.x - p.x); h.fy = h.y + (h.y - p.y); }
    for (const q of sim.alive) { q.fear = clamp(q.fear + (dist(q, p) < 900 ? 0.12 : 0.05)); q.love = clamp(q.love - 0.01); q.morale = clamp(q.morale - 0.04); }
    sim.effects.push({ kind: 'bolt', x: p.x, y: p.y, t: sim.t });
    sim.stats.bolts++;
    return done(hit.length ? `劈中了${[...new Set(hit)].join('、')}` : '劈在空地上，族人吓得趴在地上');
  },
  rally(sim, a) {
    const at = a.ref && a.ref !== 'camp' && sim.idx[a.ref] && sim.idx[a.ref].name && sim.idx[a.ref].alive !== undefined ? sim.idx[a.ref] : a;
    return orderDone(sim, { job: 'rally', x: at.x, y: at.y, n: 99, hours: 2.5, label: '集结' }, '集结');
  },
  light(sim, a) {
    const prev = sim.buffs.light;
    // 写在正琢磨手艺的人身上：神光照着他，琢磨快一截
    const R = sim.research, who = R.id && sim.idx[R.by];
    const inspire = who && who.alive && a?.x != null && dist(who, a) < 34;
    const prevIns = sim.buffs.inspire;
    if (inspire) sim.buffs.inspire = sim.t + DAY;
    // 天天降圣光，族人也就不稀奇了：三天里降得越多，爱戴涨得越少
    sim.lightLog = (sim.lightLog || []).filter(t => t > sim.t - 3 * DAY);
    const u1 = bump(sim, 'love', 0.05 / (1 + sim.lightLog.length)), prevFear = sim.alive.map(p => [p, p.fear]);
    sim.lightLog.push(sim.t);
    sim.buffs.light = sim.t + DAY;
    for (const p of sim.alive) p.fear *= 0.5;
    sim.effects.push({ kind: 'light', x: sim.camp.x, y: sim.camp.y, t: sim.t });
    sim.stats.lights++;
    return done(`一天之内：士气 +20%、劳作 +15%、恐惧减半、病好得快${inspire ? `；神光照着${who.name}，琢磨「${TECHS[R.id].name}」快了八成` : ''}`, () => { sim.buffs.light = prev; sim.buffs.inspire = prevIns; u1(); for (const [p, v] of prevFear) p.fear = v; });
  },
  kindle(sim) {
    let fs = sim.fires.filter(f => dist(f, sim.camp) < sim.camp.r + 80);
    let made = null;
    if (!fs.length) { made = addFire(sim, sim.camp.x, sim.camp.y, { fuel: 0, lit: false }); fs = [made]; }
    const out = fs.filter(f => !f.lit), prev = fs.map(f => [f, f.lit, f.fuel]);
    for (const f of fs) { f.lit = true; f.fuel = Math.min(K.fire.maxFuel, f.fuel + 8); f.outSince = 0; }
    const u = bump(sim, 'love', out.length ? 0.06 : 0.01);
    if (out.length) sim.stats.relit++;
    return done(out.length ? '灭了的火又着了' : '火更旺了（添了 8 个时辰的柴）', () => { for (const [f, l, fu] of prev) { f.lit = l; f.fuel = fu; } u(); });
  },
  train(sim) { return orderDone(sim, { job: 'train', x: sim.camp.x, y: sim.camp.y, n: 4, hours: 4 }, '操练'); },
  order(sim, a, act) {
    const t = a.ref && sim.idx[a.ref];
    switch (act.job) {
      case 'chop':
        if (!t || !t.trees) return fail('这里没有能砍的树');
        if (sim.bans.some(b => b.ref === t.id)) return fail('这片林子下了禁令（✕）');
        if (!t.trees.some(x => x.alive)) return fail('树都砍光了');
        return orderDone(sim, { job: 'chop', ref: t.id, x: t.x, y: t.y, n: 3, hours: 10 }, '砍柴');
      case 'gather': {
        if (act.near) return orderDone(sim, { job: 'gather', x: sim.camp.x, y: sim.camp.y, r: 700, n: 3, hours: 8 }, '采集');
        if (t && t.trees) return orderDone(sim, { job: 'gather', x: t.x, y: t.y, r: t.r + 160, forest: t.id, n: 3, hours: 8 }, '采集');
        const pt = sim.map.patches.find(p => p.id === a.ref);
        if (pt) return orderDone(sim, { job: 'gather', x: pt.x, y: pt.y, r: pt.r + 30, n: 3, hours: 8 }, '采浆果');
        return fail('这里没有能采的');
      }
      case 'quarry':
        if (!t || t.stone === undefined) return fail('这里没有石头');
        if (t.stone < 1) return fail('石头采光了');
        return orderDone(sim, { job: 'quarry', ref: t.id, x: t.x, y: t.y, n: 3, hours: 10 }, '采石');
      case 'fish': if (sim.flood) return fail('正发大水，下不了河'); return orderDone(sim, { job: 'fish', x: a.x, y: a.y, n: 3, hours: 8 }, '叉鱼');
      case 'water': if (sim.flood) return fail('正发大水，下不了河'); return orderDone(sim, { job: 'water', x: a.x, y: a.y, n: 2, hours: 4 }, '挑水');
    }
    return fail('这里用不上');
  },
  burn(sim, a) {
    const f = a.ref && sim.idx[a.ref];
    if (!f || !f.trees) return fail('这里没有林子');
    let n = 0;
    for (const t of f.trees) if (t.alive) { t.alive = false; t.wood = 0; t.burnt = true; t.regrow = sim.t + 40 * DAY; n++; }
    f.burnt = sim.t; f.nuts = 0;
    sim.dirty.trees = true;
    sim.later.push({ t: sim.t + 7 * DAY, kind: 'sprout', ref: f.id });
    for (const b of sim.beasts) if (!b.dead && !b.gone && dist(b, f) < 600) scareBeast(sim, b, 2);
    for (const q of sim.alive) { q.fear = clamp(q.fear + 0.08); q.love = clamp(q.love - 0.02); if (dist(q, f) < f.r + 40) setJob(sim, q, null); }
    sim.effects.push({ kind: 'burn', x: f.x, y: f.y, r: f.r, t: sim.t });
    return done(`烧了 ${n} 棵树。七天后灰里会冒出浆果苗`);
  },
  hunt(sim, a) {
    const t = a.ref && sim.idx[a.ref];
    if (!t) return fail('没看见兽');
    if (t.kind === 'swarm') return fail('蝗虫打不完：用火赶，或者用雷火烧');
    if (t.kind === 'herd') {
      if (sim.bans.some(b => b.ref === t.id)) return fail('这群鹿下了禁令（✕）');
      return orderDone(sim, { job: 'hunt', ref: t.id, x: t.x, y: t.y, n: 3, hours: 9 }, '打猎');
    }
    if (t.kind === 'raider') return orderDone(sim, { job: 'fight', ref: t.id, x: t.x, y: t.y, n: 4, hours: 6 }, '迎战劫掠骑手');
    return orderDone(sim, { job: 'fight', ref: t.id, x: t.x, y: t.y, n: 3, hours: 6 }, `打${t.name}`);
  },
  huntAll(sim, a) {
    const t = a.ref && sim.idx[a.ref];
    if (!t) return fail('没看见兽');
    if (t.kind === 'swarm') return fail('蝗虫打不完：用火赶，或者用雷火烧');
    if (t.kind === 'herd') {
      if (sim.bans.some(b => b.ref === t.id)) return fail('这群鹿下了禁令（✕）');
      return orderDone(sim, { job: 'hunt', ref: t.id, x: t.x, y: t.y, n: 6, hours: 9, big: true }, '围猎');
    }
    if (t.kind === 'raider') return orderDone(sim, { job: 'fight', ref: t.id, x: t.x, y: t.y, n: 6, hours: 6 }, '围打劫掠骑手');
    return orderDone(sim, { job: 'fight', ref: t.id, x: t.x, y: t.y, n: 6, hours: 6 }, `围打${t.name}`);
  },
  scare(sim, a) {
    const t = a.ref && sim.idx[a.ref];
    if (!t) return fail('没看见兽');
    if (t.kind === 'raider') {
      for (const rd of sim.raiders || []) rd.state = 'flee';
      return done('神火惊了马匹，劫掠骑手掉头逃散了');
    }
    if (t.kind === 'herd') {
      const prev = { hx: t.hx, hy: t.hy, x: t.x, y: t.y };
      const ang = Math.atan2(t.y - sim.camp.y, t.x - sim.camp.x);
      t.hx = clamp(t.hx + Math.cos(ang) * 400, 60, sim.map.w - 60); t.hy = clamp(t.hy + Math.sin(ang) * 400, 60, sim.map.h - 60);
      t.flee = sim.t + 90; t.fx = t.hx; t.fy = t.hy;
      return done('鹿群跑远了', () => Object.assign(t, prev, { flee: 0 }));
    }
    if (t.kind === 'swarm') {
      const prev = { ...t };
      scareBeast(sim, t, 2); t.power *= 0.6;
      return done('烟火一熏，蝗虫群掉头飞远了（少了四成）', () => Object.assign(t, prev));
    }
    const pack = t.kind === 'wolf' ? sim.beasts.filter(b => b.kind === 'wolf' && !b.dead && !b.gone) : [t];
    const saved = pack.some(b => b.state === 'stalk' && sim.idx[b.target]?.name);
    const prev = pack.map(b => [b, { ...b }]);
    for (const b of pack) scareBeast(sim, b, t.kind === 'wolf' ? 2 : 3);
    const u = bump(sim, 'love', saved ? 0.05 : 0.01);
    if (saved) sim.stats.saves++;
    return done(saved ? `${t.name}正扑向族人，被神火赶跑了` : `${t.name}被赶远了`, () => { for (const [b, s] of prev) Object.assign(b, s); u(); });
  },
  // 河·山：筑堤（会编筐才行）。沿着离目标最近的那段河岸修一道堤
  levee(sim, a) {
    if (!known(sim, a.x, a.y)) return fail('那边还是白纸');
    const q = nearestRiverPoint(sim.map, a), i = sim.map.river.indexOf(q), R = sim.map.river;
    const side = Math.sign((sim.camp.x - q.x) || 1);
    const pts = [];
    for (let k = -7; k <= 7; k++) {
      const j = Math.max(1, Math.min(R.length - 2, i + k)), r0 = R[j - 1], r1 = R[j + 1];
      let nx = -(r1.y - r0.y), ny = r1.x - r0.x; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      if (nx * side < 0) { nx = -nx; ny = -ny; }
      pts.push({ x: R[j].x + nx * (RIVER_HALF + 16), y: R[j].y + ny * (RIVER_HALF + 16) });
    }
    const mid = pts[7];
    if (sim.levees.some(L => !L.broken && dist(L, mid) < 160) || sim.sites.some(s => s.type === 'levee' && dist(s, mid) < 160)) return fail('这段河岸已经有堤了');
    const s = addSite(sim, 'levee', {}, mid.x, mid.y, { pts });
    return done(`河堤开工了（要石 ${s.need.stone}、木 ${s.need.wood}）`, () => removeSite(sim, s), { site: s });
  },
  // 日·放晴：雨雪立刻停，一天里不下
  clear(sim) {
    const w = sim.weather;
    if (!w.wet && !w.next) return fail('天本来就晴着');
    if (floodRainLocked(sim)) return fail('洪峰即将到来，这场雨停不下来');
    const prev = { ...w, next: w.next && { ...w.next } };
    w.wet = false; w.kind = 'clear'; w.until = sim.t; w.next = null; w.dry = Math.max(w.dry, 0);
    w.noRain = sim.t + DAY;
    return done('云散了，日头出来了', () => {
      if (floodRainLocked(sim)) return false;
      Object.assign(w, prev);
    });
  },
  // 月·入夜：天暗下来几个钟头，野兽看不清，族人提早歇下
  night(sim) {
    let n = 0;
    for (const b of sim.beasts) if (!b.dead && !b.gone && b.kind !== 'swarm' && b.state === 'stalk') { b.state = 'roam'; b.target = null; b.wary = sim.t + 6 * 60; n++; }
    for (const z of sim.strangers || []) if (z.state === 'go' && (z.task === 'fire' || z.task === 'food')) { z.state = 'home'; n++; }
    sim.buffs.night = sim.t + 3 * 60;
    for (const p of sim.alive) {
      p.fatigue = Math.max(0, p.fatigue - 0.25);
      setJob(sim, p, null); // 让已有活计的人也按入夜后的规则重新选择
    }
    return done(n ? `天一下子黑了：${n} 个盯着族人的东西没了目标` : '天一下子黑了，族人早早歇下');
  },
  // 月·歇息：族人歇半天，解乏、长精神
  rest(sim, a) {
    const who = a.ref && a.ref !== 'camp' ? sim.alive.filter(p => p.id === a.ref) : sim.alive.filter(p => dist(p, sim.camp) < sim.camp.r + 60);
    if (!who.length) return fail(a.ref && a.ref !== 'camp' ? '这个族人已经不在了' : '营地里没人');
    for (const p of who) { p.fatigue = 0; p.morale = clamp(p.morale + 0.1); p.restUntil = sim.t + 4 * 60; setJob(sim, p, null); }
    return done(`${who.length > 1 ? `${who.length} 个人` : who[0].name}歇了下来：解了乏，精神好了`);
  },
  giveFire: (sim, a) => bandH.giveFire(sim, a),
  marry: (sim, a) => bandH.marry(sim, a),
  drive: (sim, a) => bandH.drive(sim, a),
  awe: (sim, a) => bandH.awe(sim, a),
  // 第二代：农田与邻村
  fieldSow(sim, a) {
    const f = a.ref && sim.idx[a.ref];
    if (!f) return fail('这里没有农田');
    const prev = { state: f.state, sowDone: f.sowDone, missReason: f.missReason };
    const r = startSowField(sim, f);
    if (!r.ok) return fail(r.reason);
    const ord = issueOrder(sim, { job: 'sowField', ref: f.id, x: f.cx, y: f.cy, n: 3, hours: 8 });
    return done(`${f.name}开始播种${ord ? `（${ord.members.map(id => sim.idx[id].name).slice(0, 3).join('、')}过去下种）` : ''}`, () => {
      if (ord) cancelOrder(sim, ord);
      Object.assign(f, prev);
    }, { order: ord });
  },
  fieldHarvest(sim, a) {
    const f = a.ref && sim.idx[a.ref];
    const chk = canHarvestNow(sim, f);
    if (!chk.ok) return fail(chk.reason);
    const ord = issueOrder(sim, { job: 'harvestField', ref: f.id, x: f.cx, y: f.cy, n: 4, hours: 10 });
    return done(`${f.name}开镰收割${ord ? `（${ord.members.map(id => sim.idx[id].name).slice(0, 3).join('、')}去割谷）` : '，附近族人会来收'}`, () => {
      if (ord) cancelOrder(sim, ord);
    }, { order: ord });
  },
  fieldWater(sim, a) {
    const f = a.ref && sim.idx[a.ref];
    if (!f) return fail('这里没有农田');
    const prevM = f.moisture, prevP = f.pest, prevD = f.droughtHit;
    f.moisture = clamp(f.moisture + 0.45, 0, 1.15);
    f.pest = Math.max(0, f.pest - 0.25);
    f.droughtHit = Math.max(0, f.droughtHit - 0.2);
    const u = bump(sim, 'love', 0.015);
    sim.effects.push({ kind: 'flare', x: f.cx, y: f.cy, r: 50, t: sim.t });
    return done(`甘霖落进${f.name}，墒情润到 ${Math.round(f.moisture * 100)}%`, () => { f.moisture = prevM; f.pest = prevP; f.droughtHit = prevD; u(); });
  },
  fieldPest(sim, a) {
    const f = a.ref && sim.idx[a.ref];
    if (!f) return fail('这里没有农田');
    if (f.pest <= 0.02) return fail(`${f.name}没有生虫`);
    const prev = f.pest;
    f.pest = 0;
    sim.effects.push({ kind: 'burn', x: f.cx, y: f.cy, r: 45, t: sim.t });
    return done(`烟火熏净了${f.name}的虫害`, () => { f.pest = prev; });
  },
  fieldBless(sim, a) {
    const f = a.ref && sim.idx[a.ref];
    if (!f) return fail('这里没有农田');
    if (f.state === 'clearing') return fail('地还没开垦完，先等族人整地');
    const prev = { state: f.state, growth: f.growth, blessed: f.blessed, harvested: f.harvested, missReason: f.missReason };
    f.blessed = true;
    f.missReason = null;
    if (f.state === 'fallow') {
      f.state = 'sowing'; f.sowDone = 0; f.harvested = false;
    } else if (f.state === 'sowing') {
      f.state = 'growing'; f.growth = 0.45;
    } else if (f.state === 'growing') {
      f.growth = Math.min(1, f.growth + 0.65);
      if (f.growth >= 1) { f.state = 'ripe'; f.harvested = false; }
    }
    const u = bump(sim, 'love', 0.04);
    sim.effects.push({ kind: 'light', x: f.cx, y: f.cy, t: sim.t });
    return done(f.state === 'ripe' ? `不季之穗显灵：${f.name}立刻金黄成熟，可以收割！` : `不季之穗照临${f.name}：不怕霜冻，反季抽穗`, () => { Object.assign(f, prev); u(); });
  },
  villageTrade: (sim, a) => villageH.trade(sim, a),
  villageWater: (sim, a) => villageH.water(sim, a),
  villageBreakDam: (sim, a) => villageH.breakDam(sim, a),
  villageAwe: (sim, a) => villageH.awe(sim, a),
  site(sim, a, act) {
    const why = siteCheck(sim, a, act.build);
    if (why) return fail(why);
    const extra = {};
    let params = {};
    if (act.build === 'cairn') {
      const ang = Math.atan2(a.y - sim.camp.y, a.x - sim.camp.x) + Math.PI / 2, L = 55;
      extra.wall = [{ x: a.x - Math.cos(ang) * L, y: a.y - Math.sin(ang) * L }, { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L }];
      if (a.ctx === 'rock') params = { need: {}, work: 2 };
    }
    if (act.build === 'sapling') {
      const n = sim.nextId++, g = { id: `f${n}`, x: a.x, y: a.y, r: 46, trees: [], nuts: 0, burnt: 0, planted: true };
      for (let i = 0; i < 5; i++) {
        const ang = i / 5 * 6.28 + sim.rng.range(-0.3, 0.3), rr = i ? sim.rng.range(18, 34) : 0;
        g.trees.push({ id: `t${sim.nextId++}`, x: a.x + Math.cos(ang) * rr, y: a.y + Math.sin(ang) * rr, wood: K.tree.wood, alive: false, regrow: Infinity, size: sim.rng.range(24, 32), seed: sim.rng.int(1e9), forest: g.id, young: true });
      }
      extra.grove = g;
    }
    const s = addSite(sim, act.build, params, a.x, a.y, extra);
    return done(`${s.name}开工了${Object.keys(s.need).length ? `（要${Object.entries(s.need).map(([k, n]) => `${NAME[k]} ${n}`).join('、')}）` : ''}`, () => removeSite(sim, s), { site: s });
  },
};
const NAME = { wood: '木', stone: '石', grass: '草', hide: '皮', bronze: '青铜' };

function siteCheck(sim, a, type, gap = 46) {
  if (!known(sim, a.x, a.y)) return '那边还是白纸';
  if (a.ctx === 'rock' && type === 'cairn') return null;
  if (sim.map.riverDist(a.x, a.y) < RIVER_HALF + 18) return '离河太近';
  if (inFlood(sim, a.x, a.y)) return '那里正淹着水';
  for (const b of [...sim.buildings, ...sim.sites]) if (b.type !== 'fenceSeg' && b.type !== 'cairn' && b.type !== 'levee' && dist(b, a) < Math.max(gap, b.type === 'altar' || b.type?.startsWith?.('altar') ? 60 : 0)) return '和别的房子挤在一起了';
  for (const f of sim.map.forests) if (dist(f, a) < f.r - 8 && type !== 'sapling') return '这里是树林';
  for (const r of sim.map.rocks) if (dist(r, a) < r.r) return '这里是石堆';
  for (const f of sim.fires) if (dist(f, a) < 40) return '离火太近';
  return null;
}
export function startRain(sim, mins) {
  const w = sim.weather;
  w.wet = true; w.kind = sim.now.season === 3 ? 'snow' : 'rain'; w.until = sim.t + mins; w.dry = 0;
  if (w.drought) { w.drought = false; log(sim, '下雨了，旱情解了', 'season'); }
}

// 墨笔号令。a = { ctx, sym, ref, x, y }。返回 { ok, msg, verb, cost, undo }
export function command(sim, a) {
  const v = verbOf(a.ctx, a.sym), key = `${a.ctx}:${a.sym}`, name = (symbolById(a.sym) || BRONZE_GLYPHS[a.sym])?.name || a.sym;
  if (!v) return fail(`「${name}」在这里用不上`);
  const lk = lockOf(sim, a.ctx, a.sym);
  if (lk) return fail(`「${name}·${v.verb}」还没学会（${lk}）`, { locked: true });
  const act = ACTIONS[key];
  if (!act && !bronzeIds(a.ctx)) return fail(`「${name}」在这里用不上`);
  if (sim.ink < v.ink) return fail(`墨不够（「${v.verb}」要 ${v.ink} 墨）`, { noInk: true });
  const res = act ? H[act.kind](sim, a, act, v) : applyCityGlyph(sim, a);
  if (!res.ok) { sim.stats.cmdFail++; return { ...res, verb: v.verb }; }
  sim.ink -= v.ink;
  sim.stats.cmds[key] = (sim.stats.cmds[key] || 0) + 1;
  sim.stats.inkSpent += v.ink;
  log(sim, `${name === v.verb ? name : `${name}·${v.verb}`}（${v.ink} 墨）：${res.msg}`, 'god');
  let undone = false;
  const undo = res.undo ? () => {
    if (undone || res.undo() === false) return false;
    undone = true;
    sim.ink = Math.min(sim.inkMax, sim.ink + v.ink);
    sim.stats.inkSpent -= v.ink; sim.stats.undone++;
    log(sim, `撤回「${v.verb}」，墨退回`, 'god');
    return true;
  } : null;
  return { ok: true, msg: res.msg, verb: v.verb, cost: v.ink, undo, key, order: res.order, site: res.site };
}

// ---------------- 朱笔 ----------------
export function redLine(sim, pts, { closed = false } = {}) {
  const len = plen(pts) + (closed ? dist(pts[0], pts[pts.length - 1]) : 0);
  const cost = Math.max(1, Math.ceil(len / 260)) + (closed ? 1 : 0);
  if (sim.ink < cost) return fail(`墨不够（这条线要 ${cost} 墨）`);
  sim.ink -= cost; sim.stats.inkSpent += cost;
  const hp = endurance(len) * (closed ? 1.2 : 1);
  const w = addBarrier(sim, { kind: closed ? 'zone' : 'red', pts: pts.map(p => ({ x: p.x, y: p.y })), closed, hp: Math.round(hp) });
  sim.dirty.barriers = true;
  log(sim, closed ? `朱笔圈出禁区（${cost} 墨，承受 ${w.hp}）` : `朱笔画下封锁线（${cost} 墨，承受 ${w.hp}）`, 'god');
  return done('', () => { removeBarrier(sim, w); sim.ink += cost; sim.stats.inkSpent -= cost; }, { barrier: w, cost });
}
export function redGuard(sim, x, y, r) {
  if (sim.ink < 1) return fail('墨不够');
  sim.ink -= 1; sim.stats.inkSpent += 1;
  const w = addBarrier(sim, { kind: 'guard', x, y, r: clamp(r, 40, 260), hp: 60 });
  sim.dirty.barriers = true;
  log(sim, `朱笔画○：护住这一圈，野兽进不来（承受 60）`, 'god');
  return done('', () => { removeBarrier(sim, w); sim.ink += 1; sim.stats.inkSpent -= 1; }, { barrier: w });
}
export function redBan(sim, t) {
  if (!t || !t.ctx || !['wood', 'rock', 'beast', 'river'].includes(t.ctx) || t.kind === 'tiger' || t.kind === 'wolf') return fail('✕ 要画在林子、浆果丛、石堆或鹿群上');
  if (sim.bans.some(b => b.ref === t.ref)) return fail('这里已经禁了');
  if (sim.ink < 1) return fail('墨不够');
  sim.ink -= 1; sim.stats.inkSpent += 1;
  const ban = { id: `n${sim.nextId++}`, ref: t.ref, ctx: t.ctx, name: t.name, x: t.x, y: t.y, t: sim.t };
  sim.bans.push(ban);
  for (const p of sim.alive) p.love = clamp(p.love - 0.004);
  for (const p of sim.alive) if (p.job && p.job.ref && (p.job.ref === t.ref || sim.idx[p.job.ref]?.forest === t.ref)) setJob(sim, p, null);
  log(sim, `朱笔 ✕：${t.name}禁了`, 'god');
  return done('', () => { sim.bans = sim.bans.filter(b => b !== ban); sim.ink += 1; sim.stats.inkSpent -= 1; }, { ban });
}
export function unseal(sim, id) {
  const w = sim.idx[id];
  if (w && sim.barriers.includes(w)) { removeBarrier(sim, w); sim.dirty.barriers = true; log(sim, '朱笔一刀，启封', 'god'); return true; }
  const ban = sim.bans.find(b => b.id === id);
  if (ban) { sim.bans = sim.bans.filter(b => b !== ban); log(sim, `朱笔一刀：${ban.name}解禁`, 'god'); return true; }
  return false;
}

// ---------------- 铅笔 ----------------
export function scoutRoute(sim, pts) {
  const route = pts.map(p => ({ x: p.x, y: p.y }));
  const ord = issueOrder(sim, { job: 'scout', route, x: route[0].x, y: route[0].y, n: 2, hours: 16 });
  if (!ord) return fail('没人肯去');
  sim.stats.scouts++;
  log(sim, `铅笔画了一条探路的线：${ord.members.map(id => sim.idx[id].name).join('、')}沿着走一趟`, 'god');
  return done('', () => cancelOrder(sim, ord), { order: ord });
}
export function buildRoad(sim, pts) {
  const road = addRoad(sim, pts.map(p => ({ x: p.x, y: p.y })));
  const ord = issueOrder(sim, { job: 'road', ref: road.id, x: pts[0].x, y: pts[0].y, n: 3, hours: 12 });
  log(sim, `铅笔画了一条路：${road.segs.length} 段，修好了走得快`, 'god');
  return done('', () => { if (ord) cancelOrder(sim, ord); sim.roads = sim.roads.filter(r => r !== road); }, { road, order: ord });
}
// 迁徙：沿着铅笔画的这条路，全族带着火种走到终点安营（收不回来）
export function migrate(sim, pts) {
  if (sim.era3?.active) return fail('城邦的城心已定，城与附属村由道路相连，不再全族迁徙');
  const r = startMarch(sim, pts.map(p => ({ x: p.x, y: p.y })));
  return r.ok ? done('', null, { march: r.march, len: r.len }) : fail(r.msg);
}
// 第二代铅笔：划田（闭合圈地）、挖水渠（含大渠三段匹配）
export function planField(sim, pts) {
  if (!sim.era2?.active) return fail('进入第二代（农耕）后才能划田');
  const r = addField(sim, pts);
  if (!r.ok) return fail(r.msg);
  return done('', () => {
    sim.fields = sim.fields.filter(f => f !== r.field);
    delete sim.idx[r.field.id];
    updateCanalNetwork(sim);
    sim.dirty.fields = true;
  }, { field: r.field });
}
export function digCanal(sim, pts, opts = {}) {
  if (!sim.era2?.active) return fail('进入第二代（农耕）后才能挖水渠');
  const clean = pts.map(p => ({ x: p.x, y: p.y }));
  const stage = opts.grandStage || matchGrandCanalStage(sim, clean);
  if (stage) {
    const gr = startGrandCanal(sim, clean, stage);
    if (!gr.ok) return fail(gr.msg);
    return done('', () => {
      if (!sim.canals.includes(gr.canal) || gr.canal.segs.some(s => s.built) || gr.canal.blessed > 0) return false;
      sim.canals = sim.canals.filter(c => c !== gr.canal);
      delete sim.idx[gr.canal.id];
      sim.ink = Math.min(sim.inkMax, sim.ink + gr.ink);
      sim.stats.inkSpent -= gr.ink;
      sim.dirty.canals = true;
      return true;
    }, { canal: gr.canal, grandStage: stage, ink: gr.ink });
  }
  const r = addCanal(sim, clean);
  if (!r.ok) return fail(r.msg);
  return done('', () => {
    if (r.canal.segs.some(s => s.built)) return false;
    sim.canals = sim.canals.filter(c => c !== r.canal);
    delete sim.idx[r.canal.id];
    sim.dirty.canals = true;
    return true;
  }, { canal: r.canal, grandStage: 0 });
}
// 图纸落地：params 来自 blueprint.js 量出的数值
export function placeDesign(sim, type, params, x, y, strokes) {
  const lock = designLock(sim, type);
  if (lock) return fail(lock);
  if (type === 'citywall' || type === 'cartway') return fail('这张图纸要用铅笔在地图上画走向');
  const altar = type.startsWith('altar');
  const extra = {};
  if (altar && type !== 'altar1') { x = sim.era.altar.x; y = sim.era.altar.y; }
  else if (type === 'bridge') {
    if (!known(sim, x, y)) return fail('那边还是白纸');
    const q = nearestRiverPoint(sim.map, { x, y });
    if (!q || dist(q, { x, y }) > 120) return fail('木桥要架在河上（点河岸附近）');
    if (sim.buildings.concat(sim.sites).some(b => b.type === 'bridge' && dist(b, q) < 90)) return fail('这里已经有一座桥了');
    const i = sim.map.river.indexOf(q), r0 = sim.map.river[Math.max(0, i - 1)], r1 = sim.map.river[Math.min(sim.map.river.length - 1, i + 1)];
    extra.angle = Math.atan2(r1.y - r0.y, r1.x - r0.x) + Math.PI / 2;
    x = q.x; y = q.y;
  } else {
    const why = siteCheck(sim, { x, y }, type, altar ? 60 : 46);
    if (why) return fail(why);
    if (ERA3_DESIGNS.includes(type)) {
      if (dist({ x, y }, sim.camp) > 400) return fail('要放在城附近');
      if (sim.fields.some(f => pointInPolygon({ x, y }, f.pts))) return fail('这里已经划成农田了');
    }
  }
  const ink = altar ? altarInk(type) : 0;
  if (sim.ink < ink) return fail(`墨不够（祭坛这一段开光要 ${ink} 墨）`);
  params = { ...params };
  if (type === 'shack' && tribeKnows(sim, 'longhouse')) { params.cap = Math.min(9, Math.round(params.cap * 1.5)); params.warmth = Math.min(1, +(params.warmth + 0.1).toFixed(2)); params.need = { ...params.need, wood: Math.round(params.need.wood * 1.3) }; }
  const s = addSite(sim, type, params, x, y, altar ? { strokes, bless: altarBless(type), blessed: 0 } : { strokes, ...extra });
  if (ink) { sim.ink -= ink; sim.stats.inkSpent += ink; }
  log(sim, `照图纸${altar && type !== 'altar1' ? '在祭坛上' : placeName(sim, { x, y })}开工：${s.name}（要${Object.entries(s.need).map(([k, n]) => `${NAME[k]} ${n}`).join('、') || '人手'}${ink ? `；开工 ${ink} 墨，修的时候再吸 ${s.bless} 墨开光` : ''}）`, 'god');
  return done('', () => {
    if (!removeSite(sim, s)) return false;
    if (ink) { sim.ink = Math.min(sim.inkMax, sim.ink + ink); sim.stats.inkSpent -= ink; }
    return true;
  }, { site: s, ink });
}
// 城郭必须闭合并包住城心；车道须从城通向一个附属村。
export function placeCityLine(sim, type, params, pts, strokes) {
  if (type !== 'citywall' && type !== 'cartway') return fail('不是城郭或车道图纸');
  const lock = designLock(sim, type);
  if (lock) return fail(lock);
  if (pts.length < 2 || plen(pts) < 130) return fail('线太短了');
  let path = pts.map(p => ({ x: p.x, y: p.y }));
  const n = path.length, a = path[0], b = path.at(-1), c = sim.camp;
  if (type === 'citywall') {
    if (n < 4 || dist(a, b) > 70) return fail('城郭需要画成闭合线');
    if (dist(a, b) < 8) path.pop();
    if (!pointInPolygon(c, path)) return fail('城郭要围住营地中心');
    if (path.some(p => dist(c, p) > 320 || dist(c, p) < 78)) return fail('城郭离城心太远或太挤');
    for (let i = 0; i < path.length; i++) for (let j = i + 2; j < path.length; j++) {
      if (i === 0 && j === path.length - 1) continue;
      if (segIntersect(path[i], path[i + 1], path[j], path[(j + 1) % path.length])) return fail('城郭不能自相交叉');
    }
    path.push(path[0]);
  } else {
    const linked = (x, y) => dist(x, c) <= 135 && sim.era3.villages.some(v => dist(y, v) <= 110);
    if (!linked(a, b) && !linked(b, a)) return fail('车道一端要接城，另一端要接附属村');
  }
  for (let i = 1; i < path.length; i++) {
    const a0 = path[i - 1], a1 = path[i], steps = Math.ceil(dist(a0, a1) / 20);
    for (let k = 0; k <= steps; k++) {
      const f = k / Math.max(1, steps), x = a0.x + (a1.x - a0.x) * f, y = a0.y + (a1.y - a0.y) * f;
      if (!known(sim, x, y)) return fail('线经过白纸，先派人去探路');
      if (type === 'citywall' && (inFlood(sim, x, y) || sim.map.riverDist(x, y) < RIVER_HALF + 5)) return fail('城墙不能修在河里或积水处');
    }
  }
  const p = type === 'citywall' ? c : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const site = addSite(sim, type, params, p.x, p.y, { pts: path, strokes });
  log(sim, `${site.name}依图开工，沿你画的线施工`, 'god');
  return done('已经开工', () => removeSite(sim, site), { site });
}
export function placeFenceLine(sim, params, pts, strokes) {
  if (pts.length < 2 || plen(pts) < 60) return fail('篱笆太短了');
  if (pts.some(p => !known(sim, p.x, p.y))) return fail('篱笆不能修到白纸上');
  const fence = placeFence(sim, params, pts.map(p => ({ x: p.x, y: p.y })), strokes);
  log(sim, `照图纸修篱笆：${fence.segs.length} 段，每段要木 ${Math.max(1, Math.round(params.woodPer40))}`, 'god');
  return done('', () => { for (const s of sim.sites.filter(s => s.fence === fence.id)) removeSite(sim, s); sim.fences = sim.fences.filter(f => f !== fence); }, { fence });
}
