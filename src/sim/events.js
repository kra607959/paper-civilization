// 第一代的天灾人祸（第 2 年起）：蝗虫群、寒冬、山洪、热病；还有天黑没回来、走迷了路的人。
// 虎和狼在 beasts.js，外族在 band.js，大祭坛和迁徙在 era.js。
import { K, DAY, YEAR_DAYS } from './config.js';
import { dist, clamp, log, known, inFlood, foodTotal } from './util.js';
import { yearOf, sunset, hourOf } from './calendar.js';
import { tribeKnows, roleAlive } from './tech.js';
import { makeBeast, moveBeast, placeName, dirWord } from './beasts.js';
import { destroyBuilding, removeSite } from './build.js';
import { setJob } from './people.js';

export function initEvents(sim) {
  sim.flood = null;                 // 正在发的水：{ start, until, w, great }
  sim.floodPlan = null;             // 要来的山洪：{ t, w, warned }
  sim.harsh = { next: false, now: false };
  sim.levees = [];
  sim.plague = null;                // 正在闹的热病：{ since, n, dead }
  sim.ev = { locust: 0, flood: 0 }; // 哪一年来过
}
const perDay = (yearChance, days) => 1 - (1 - yearChance) ** (1 / days);

// ---------------- 每天 ----------------
export function dailyEvents(sim, newSeason) {
  const s = sim.now.season, y = yearOf(sim.t);
  // 寒冬：入秋就定了；会观星的提前一季看出来
  if (newSeason && s === 2) {
    sim.harsh.next = y >= 2 && sim.rng() < K.harsh.chance;
    if (sim.harsh.next && tribeKnows(sim, 'stars')) log(sim, '观星的人说：今冬会格外冷，多备柴、多晾干肉', 'danger');
  }
  if (newSeason && s === 3) {
    sim.harsh.now = sim.harsh.next; sim.harsh.next = false;
    if (sim.harsh.now) { sim.stats.harsh = (sim.stats.harsh || 0) + 1; log(sim, '寒冬：河边结了冰，雪一场接一场', 'danger'); }
  }
  if (newSeason && s === 0) sim.harsh.now = false;

  if (y >= 2) {
    // 山洪：春夏，一年至多一场
    if ((s === 0 || s === 1) && sim.ev.flood < y && !sim.floodPlan && !sim.flood && !(sim.era.floodSoon && !sim.era.flooded) && sim.rng() < perDay(K.flood.chance, 14)) {
      const lead = sim.rng.range(10, 30) * 60;
      sim.floodPlan = { t: sim.t + lead, w: sim.rng.range(...K.flood.width), warned: false };
      sim.ev.flood = y;
      if (tribeKnows(sim, 'stars')) log(sim, '观星的人说：上游的云压得低，一两天里河水要涨', 'danger');
    }
    // 蝗虫：夏秋，一年至多一群
    if ((s === 1 || s === 2) && sim.ev.locust < y && sim.rng() < perDay(K.locust.chance, 14)) { sim.ev.locust = y; spawnSwarm(sim); }
    // 热病：换季时起，冬春多，人挤着住更容易
    if (newSeason && !sim.plague) {
      const crowd = sim.plan.housing < sim.alive.length ? 1.5 : 1;
      if (sim.rng() < K.plague.chance * (s === 3 || s === 0 ? 1.3 : 0.7) * crowd) startPlague(sim);
    }
  }
  if (sim.plague) spreadPlague(sim);
}

// ---------------- 每小时 ----------------
export function hourlyEvents(sim) {
  const fp = sim.floodPlan;
  if (fp) {
    if (!fp.warned && sim.t >= fp.t - K.flood.warn * 60) { fp.warned = true; log(sim, '河水涨起来了，浑得发黄：怕是要发大水', 'danger'); }
    if (sim.t >= fp.t) { sim.floodPlan = null; startFlood(sim, fp.w, K.flood.hours * 60, false); }
  }
  if (sim.flood) {
    floodHour(sim);
    if (sim.t >= sim.flood.until) endFlood(sim);
  }
  lostHour(sim);
}

// ---------------- 大水 ----------------
const WASH = { shack: 0.5, rack: 0.7, hearth: 0.3, bench: 0.35, trap: 0.5, well: 0.4, outpost: 0.3, cairn: 0.1, levee: 0 };
export function startFlood(sim, w, mins, great) {
  sim.flood = { start: sim.t, until: sim.t + mins, w, great };
  sim.stats.floods = (sim.stats.floods || 0) + 1;
  const lost = [];
  for (const b of [...sim.buildings]) {
    if (b.type === 'altar' || !inFlood(sim, b.x, b.y)) continue;
    if (great || sim.rng() < (WASH[b.type] ?? 0.4)) { destroyBuilding(sim, b); lost.push(b.name); }
  }
  for (const s of [...sim.sites]) if (!s.type.startsWith('altar') && inFlood(sim, s.x, s.y) && (great || sim.rng() < 0.6)) { s.have = {}; removeSite(sim, s); }
  for (const w2 of [...sim.barriers]) {
    if (w2.kind !== 'fence' && w2.kind !== 'wall') continue;
    const mid = w2.pts[Math.floor(w2.pts.length / 2)];
    if (inFlood(sim, mid.x, mid.y) && (great || sim.rng() < 0.5)) { sim.barriers = sim.barriers.filter(x => x !== w2); delete sim.idx[w2.id]; if (w2.seg) w2.seg.built = false; lost.push(w2.kind === 'fence' ? '篱笆' : '石墙'); }
  }
  if (great) for (const L of sim.levees) L.broken = true;
  for (const f of sim.fires) if (inFlood(sim, f.x, f.y)) { f.lit = false; f.fuel = 0; f.outSince = sim.t; }
  let food = 0, wood = 0;
  if (inFlood(sim, sim.camp.x, sim.camp.y)) {
    const k = great ? 0.6 : 0.4;
    for (const b of sim.stock.food) { const n = b.n * k; b.n -= n; food += n; }
    sim.stock.food = sim.stock.food.filter(b => b.n > 0.01);
    wood = sim.stock.wood * (great ? 0.7 : 0.5); sim.stock.wood -= wood;
  }
  for (const p of sim.alive) if (inFlood(sim, p.x, p.y)) setJob(sim, p, null);
  sim.dirty.buildings = sim.dirty.barriers = true;
  sim.effects.push({ kind: 'flood', t: sim.t });
  const uniq = [...new Set(lost)];
  log(sim, great ? `大水来了！浊浪漫过河岸，旧营地${uniq.length ? `的${uniq.slice(0, 4).join('、')}` : ''}全冲没了` :
    `山洪下来了${uniq.length ? `：冲走了${uniq.slice(0, 4).join('、')}` : '，好在没冲走什么'}${food >= 2 ? `，库里泡坏 ${Math.round(food)} 份吃的` : ''}${wood >= 2 ? `、冲走 ${Math.round(wood)} 根柴` : ''}`, 'danger');
}
function floodHour(sim) {
  const f = sim.flood, raft = tribeKnows(sim, 'raft');
  for (const p of [...sim.alive]) {
    if (!inFlood(sim, p.x, p.y)) continue;
    if (p.asleep) setJob(sim, p, null);
    const frail = p.age < 10 || p.age >= 50 ? 1.6 : 1;
    const ch = (f.great ? 0.07 : 0.05) * frail * (raft ? 0.35 : 1) * (p.job?.kind === 'flee' ? 0.4 : 1);
    if (sim.rng() < ch) sim.die(p, '淹', placeName(sim, p));
    else p.health = Math.max(0.05, p.health - 0.04);
  }
}
function endFlood(sim) {
  const great = sim.flood.great;
  sim.flood = null;
  log(sim, great ? '大水退了，旧营地只剩一片烂泥' : '水退了', 'season');
}

// ---------------- 蝗虫 ----------------
export function spawnSwarm(sim) {
  const c = sim.camp, W = sim.map.w, H = sim.map.h;
  let best = null;
  for (let k = 0; k < 12; k++) {
    const e = [{ x: 30, y: sim.rng.range(60, H - 60) }, { x: W - 30, y: sim.rng.range(60, H - 60) }, { x: sim.rng.range(60, W - 60), y: 30 }, { x: sim.rng.range(60, W - 60), y: H - 30 }][sim.rng.int(4)];
    if (dist(e, c) > 900) { best = e; break; }
    if (!best || dist(e, c) > dist(best, c)) best = e;
  }
  const b = makeBeast(sim, 'swarm', best.x, best.y, { name: '蝗虫群', r: K.locust.r, power: 1, until: sim.t + K.locust.days * DAY, retarget: 0, tx: c.x, ty: c.y });
  sim.stats.swarms = (sim.stats.swarms || 0) + 1;
  log(sim, `${dirWord(c, best)}边天上黑压压一片：蝗虫群来了，见绿就吃`, 'danger', { beast: b.id });
  return b;
}
export function swarmTick(sim, b, dt) {
  if (sim.t > b.until || b.power <= 0.08) { b.gone = true; log(sim, b.power <= 0.08 ? '蝗虫群七零八落，散了' : '蝗虫群飞走了', 'season'); return; }
  if (b.state === 'flee') {
    if (moveBeast(sim, b, b.wx, b.wy, K.locust.speed * 1.6, dt, false) || sim.t > b.fleeUntil) b.state = 'roam';
    return;
  }
  // 往浆果多的地方飞，近的先
  if (sim.t >= b.retarget) {
    b.retarget = sim.t + 90;
    let best = null, bs = -Infinity;
    for (const pt of sim.map.patches) {
      let food = 0;
      for (const bu of sim.map.bushes) if (bu.patch === pt.id) food += bu.food;
      const s = food - dist(pt, b) / 60;
      if (food > 3 && s > bs) { bs = s; best = pt; }
    }
    const t = best || sim.camp;
    b.tx = t.x + sim.rng.range(-30, 30); b.ty = t.y + sim.rng.range(-30, 30);
  }
  let tx = b.tx, ty = b.ty, sp = K.locust.speed * (sim.weather.wet ? 0.3 : 1);
  // 怕烟火：有着着的火就绕开
  for (const f of sim.fires) if (f.lit && dist(f, b) < 140) { const a = Math.atan2(b.y - f.y, b.x - f.x); tx = b.x + Math.cos(a) * 200; ty = b.y + Math.sin(a) * 200; sp *= 1.3; break; }
  moveBeast(sim, b, tx, ty, sp, dt, false);
  const eat = K.locust.eat * b.power * dt / 60, r2 = b.r * b.r;
  for (const bu of sim.map.bushes) if ((bu.x - b.x) ** 2 + (bu.y - b.y) ** 2 < r2) bu.food = Math.max(0, bu.food - eat);
  if (dist(b, sim.camp) < sim.camp.r + b.r * 0.5) {
    for (const x of sim.stock.food) if (x.kind === 'berry' || x.kind === 'nut' || x.kind === 'root') { const n = Math.min(x.n, eat * 0.6); x.n -= n; b.ate = (b.ate || 0) + n; }
    sim.stock.food = sim.stock.food.filter(x => x.n > 0.01);
  }
  if (sim.weather.wet) b.power -= 0.03 * dt / 60;
}

// ---------------- 热病 ----------------
export function infect(sim, p) {
  p.sick = sim.rng.range(...K.plague.days); p.sev = sim.rng.range(0.8, 1.2); p.plague = true;
  if (sim.plague) sim.plague.n++;
}
export function startPlague(sim, from = null) {
  const pool = sim.alive.filter(p => p.age >= 3 && !(p.sick > 0) && !(p.immune > sim.t));
  if (!pool.length) return null;
  const p = pool[sim.rng.int(pool.length)];
  sim.plague = { since: sim.t, n: 0, dead: sim.stats.deaths.length };
  infect(sim, p);
  sim.stats.plagues = (sim.stats.plagues || 0) + 1;
  log(sim, `${p.name}发起了热病：浑身滚烫，说着胡话${from ? `（${from}）` : ''}`, 'danger', { who: p.id });
  return p;
}
function spreadPlague(sim) {
  const sick = sim.alive.filter(p => p.plague && p.sick > 0);
  if (!sick.length) {
    const dead = sim.stats.deaths.length - sim.plague.dead;
    log(sim, `热病过去了：前后病倒 ${sim.plague.n} 人${dead ? `，这些天死了 ${dead} 人` : '，没死人'}`, 'season');
    sim.plague = null;
    return;
  }
  const herb = roleAlive(sim, 'herb') ? 0.6 : 1, light = sim.buffs.light > sim.t ? 0.5 : 1;
  const fell = [];
  for (const q of sim.alive) {
    if (q.sick > 0 || q.immune > sim.t || q.lost) continue;
    let ch = 0;
    for (const p of sick) {
      if (p.bed && p.bed === q.bed) ch += 0.25;
      else if (dist(p, q) < sim.camp.r + 60) ch += 0.035;
    }
    if (sim.rng() < Math.min(0.6, ch) * herb * light) { infect(sim, q); fell.push(q.name); }
  }
  if (fell.length) log(sim, `${fell.join('、')}也病倒了`, 'danger');
}

// ---------------- 走失 ----------------
const FAR_JOBS = new Set(['explore', 'gather', 'nuts', 'hunt', 'chop', 'grass', 'quarry']);
function lostHour(sim) {
  const h = Math.floor(hourOf(sim.t));
  // 天黑前后：在远处落单的，有时就摸不回来了
  if (h === sunset(sim.t) && sim.day >= 28 && !sim.march) {
    const far = sim.alive.filter(p => p.age >= 8 && !p.lost && p.job && FAR_JOBS.has(p.job.kind) && dist(p, sim.camp) > 450 && !sim.alive.some(q => q !== p && dist(q, p) < 90));
    for (const p of far) {
      if (sim.rng() >= K.lost.chance * (p.temper === '怯' ? 0.6 : 1) * (p.age < 14 ? 1.5 : 1)) continue;
      p.lost = { since: sim.t, x: p.x, y: p.y };
      setJob(sim, p, null);
      if (p.order) p.order = null;
      sim.stats.lostPeople = (sim.stats.lostPeople || 0) + 1;
      log(sim, `天黑了，${p.name}${placeName(sim, p)}没回来：怕是走迷了路`, 'danger', { who: p.id, lost: true });
      break;
    }
  }
  for (const p of sim.alive) {
    if (!p.lost) continue;
    const L = p.lost;
    // 探路的人走过附近
    const scout = sim.alive.find(q => q !== p && !q.lost && q.job?.kind === 'scout' && dist(q, p) < 160);
    if (scout) { found(sim, p, `${scout.name}探路时在${placeName(sim, p).replace(/^在/, '')}找到了他`); continue; }
    // 夜里看见火光
    if (sim.now.dark && sim.fires.some(f => f.lit && dist(f, p) < 400)) { found(sim, p, '远远看见火光，摸着黑走了回来'); continue; }
    // 狗循着气味找到
    if (tribeKnows(sim, 'dog') && dist(p, sim.camp) < 1100 && sim.rng() < 0.04) { found(sim, p, '狗循着气味把他找了回来'); continue; }
    // 自己认出路
    if (!sim.now.dark && sim.rng() < (p.age >= 14 ? 0.006 : 0.003)) { found(sim, p, '自己认出了路'); continue; }
    if (sim.t - L.since > K.lost.days * DAY * 2 && p.alive) { /* 太久了：交给需求慢慢磨 */ }
  }
}
export function found(sim, p, how) {
  const days = Math.max(0, Math.round((sim.t - p.lost.since) / DAY * 10) / 10);
  p.lost = null;
  setJob(sim, p, null);
  sim.stats.foundPeople = (sim.stats.foundPeople || 0) + 1;
  log(sim, `${p.name}回来了：${how}${days >= 1 ? `（走失了 ${days} 天）` : ''}`, 'birth', { who: p.id });
}
