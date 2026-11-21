// 野兽：鹿群（被猎、春天添崽、冬天走远）、虎（饿了就找落单的人或鹿，怕火、怕人多）、
// 狼群（冬天来、夜里出没、开春走）。朱笔线、禁区、○、篱笆、石墙都挡野兽，顶久了会破。
import { K, DAY } from './config.js';
import { dist, clamp, log, known } from './util.js';
import { die, injure, companions, skillUp } from './people.js';
import { segIntersect, pointInPolygon } from '../recog/geom.js';
import { swarmTick } from './events.js';
import { tribeKnows } from './tech.js';

const DIRS = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
export function dirWord(from, to) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
// 「在营地东边的林子里」这样的地名
export function placeName(sim, p) {
  const d = dist(p, sim.camp);
  if (d < sim.camp.r) return '在营地里';
  const dir = dirWord(sim.camp, p);
  const f = sim.map.forests.find(f => dist(f, p) < f.r + 30);
  if (f) return `在营地${dir}边的林子里`;
  if (sim.map.riverDist(p.x, p.y) < 70) return `在营地${dir}边的河边`;
  const r = sim.map.rocks.find(r => dist(r, p) < r.r + 40);
  if (r) return `在营地${dir}边的石堆旁`;
  return d > 800 ? `在营地${dir}边很远的地方` : `在营地${dir}边的野地里`;
}

export function makeBeast(sim, kind, x, y, extra = {}) {
  const n = sim.nextId++;
  const b = {
    id: `k${n}`, n, kind, name: kind === 'tiger' ? '虎' : '狼', x, y, hunger: 0.3, state: 'roam', wx: x, wy: y,
    target: null, next: 0, scared: 0, rest: 0, wound: 0, dead: false, gone: false, press: null, fleeUntil: 0, home: { x, y }, ...extra,
  };
  sim.idx[b.id] = b;
  sim.beasts.push(b);
  return b;
}

// ---------------- 屏障 ----------------
// 屏障：{ id, kind: red|zone|fence|wall|guard, pts, hp, max, box, height? }
export function addBarrier(sim, bar) {
  const xs = bar.pts ? bar.pts.map(p => p.x) : [bar.x - bar.r, bar.x + bar.r];
  const ys = bar.pts ? bar.pts.map(p => p.y) : [bar.y - bar.r, bar.y + bar.r];
  bar.box = { x0: Math.min(...xs) - 12, x1: Math.max(...xs) + 12, y0: Math.min(...ys) - 12, y1: Math.max(...ys) + 12 };
  bar.max = bar.max ?? bar.hp;
  if (!bar.id) bar.id = `w${sim.nextId++}`;
  sim.barriers.push(bar);
  sim.idx[bar.id] = bar;
  return bar;
}
export function removeBarrier(sim, bar) {
  sim.barriers = sim.barriers.filter(b => b !== bar);
  delete sim.idx[bar.id];
}

function barrierHit(sim, b, nx, ny) {
  const a = { x: b.x, y: b.y }, c = { x: nx, y: ny };
  for (const w of sim.barriers) {
    const B = w.box;
    if ((a.x < B.x0 && c.x < B.x0) || (a.x > B.x1 && c.x > B.x1) || (a.y < B.y0 && c.y < B.y0) || (a.y > B.y1 && c.y > B.y1)) continue;
    if (w.kind === 'guard') {
      if (Math.hypot(nx - w.x, ny - w.y) < w.r && Math.hypot(a.x - w.x, a.y - w.y) >= w.r - 0.5) return w;
      continue;
    }
    const P = w.pts;
    for (let i = 1; i < P.length; i++) if (segIntersect(a, c, P[i - 1], P[i])) return w;
    if (w.closed && P.length > 2 && segIntersect(a, c, P[P.length - 1], P[0])) return w;
    if (w.kind === 'zone' && pointInPolygon(c, P) && !pointInPolygon(a, P)) return w;
  }
  return null;
}
export const insideGuard = (sim, p) => sim.barriers.some(w => (w.kind === 'guard' && Math.hypot(p.x - w.x, p.y - w.y) < w.r) || (w.kind === 'zone' && pointInPolygon(p, w.pts)));

function breakBarrier(sim, w, b) {
  const by = b.kind === 'tiger' ? '虎' : '狼';
  if (w.kind === 'fence') {
    w.broken = true;
    removeBarrier(sim, w);
    sim.repairFence?.(w);
    log(sim, `${by}撞破了一段篱笆`, 'danger');
  } else {
    removeBarrier(sim, w);
    const what = { red: '封锁线', zone: '禁区', guard: '护圈', wall: '石墙' }[w.kind] || '屏障';
    log(sim, `${by}冲破了${what}`, 'danger');
  }
  sim.dirty.barriers = true;
}

// 野兽走一步；被挡住就先往两边绕，绕不过去就顶，顶到承受度归零就破
export function moveBeast(sim, b, tx, ty, speed, dt, blockable = true) {
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const s = Math.min(d, speed * dt);
  const nx = b.x + dx / d * s, ny = b.y + dy / d * s;
  const hit = blockable && sim.barriers.length ? barrierHit(sim, b, nx, ny) : null;
  if (!hit) { b.x = nx; b.y = ny; b.press = null; return s >= d - 0.01; }
  const a0 = Math.atan2(dy, dx), side = b.side || (sim.rng() < 0.5 ? 1 : -1);
  for (const ang of [0.7 * side, 1.3 * side, -0.7 * side, -1.3 * side]) {
    const sx = b.x + Math.cos(a0 + ang) * s, sy = b.y + Math.sin(a0 + ang) * s;
    if (!barrierHit(sim, b, sx, sy)) { b.x = sx; b.y = sy; b.side = Math.sign(ang); b.press = hit.id; b.slide = (b.slide || 0) + dt; if (b.slide < 240) return false; }
  }
  // 篱笆矮的，虎会跳
  if (hit.kind === 'fence' && b.kind === 'tiger' && sim.rng() < Math.max(0, 0.6 - (hit.height || 0.5)) * 0.03 * dt) {
    b.x = nx + dx / d * 8; b.y = ny + dy / d * 8; log(sim, '虎跳过了矮篱笆', 'danger'); return false;
  }
  if (hit.kind === 'fence' && hit.sharp > 0 && sim.rng() < hit.sharp * 0.004 * dt) {
    fleeFrom(sim, b, { x: nx, y: ny }, 500, 6);
    if (b.kind === 'tiger' || sim.rng() < 0.3) log(sim, `${b.kind === 'tiger' ? '虎' : '狼'}撞在削尖的木桩上，掉头走了`, 'danger');
    return false;
  }
  b.press = hit.id;
  hit.hp -= (b.kind === 'tiger' ? 14 : 6) * dt / 60;
  if (hit.hp <= 0) breakBarrier(sim, hit, b);
  return false;
}

// ---------------- 鹿 ----------------
function herdHome(sim, h) {
  if (sim.now.season !== 3) return { x: h.hx, y: h.hy };
  const a = Math.atan2(h.hy - sim.camp.y, h.hx - sim.camp.x), d = sim.harsh?.now ? 650 : 450;
  return { x: clamp(h.hx + Math.cos(a) * d, 60, sim.map.w - 60), y: clamp(h.hy + Math.sin(a) * d, 60, sim.map.h - 60) };
}
function herdTick(sim, h, dt) {
  if (h.n <= 0) return;
  if (h.flee > sim.t) { moveBeast(sim, h, h.fx, h.fy, K.deer.speed, dt, false); return; }
  if (Math.hypot(h.wx - h.x, h.wy - h.y) < 6) {
    const c = herdHome(sim, h), a = sim.rng.range(0, 6.28), r = sim.rng.range(0, h.range);
    h.wx = clamp(c.x + Math.cos(a) * r, 40, sim.map.w - 40); h.wy = clamp(c.y + Math.sin(a) * r, 40, sim.map.h - 40);
    if (sim.map.riverDist(h.wx, h.wy) < 40) { h.wx = h.x; h.wy = h.y; }
  }
  moveBeast(sim, h, h.wx, h.wy, 0.9, dt, false);
}

// ---------------- 虎 ----------------
function preyOK(sim, b, p, hungry) {
  if (!p.alive || p.age < 2) return false;
  if (b.kind === 'tiger' && sim.altarWard && b.hunger < 1.1) { const A = sim.era?.altar; if (A && Math.hypot(A.x - p.x, A.y - p.y) < sim.altarWard) return false; }
  if (p.inside) { const sh = sim.idx[p.bed]; if (!sh || (sh.sturdy ?? 1) >= 0.5 || b.hunger < 0.9) return false; }
  if (b.scared > sim.t || b.wary > sim.t) return false;
  if (insideGuard(sim, p)) return false;
  const starving = b.hunger >= (b.kind === 'wolf' ? 0.9 : 1.1);
  for (const f of sim.fires) if (f.lit && Math.hypot(f.x - p.x, f.y - p.y) < K.tiger.fearFire && !(starving && sim.now.light < 0.9)) return false;
  return companions(sim, p, 90) < (hungry ? 2 : 1);
}
function choosePrey(sim, b, range = 800) {
  const hungry = b.hunger > 0.85;
  const herds = sim.herds.filter(h => h.n > 0 && dist(h, b) < (hungry ? 1300 : 900));
  const people = sim.alive.filter(p => Math.abs(p.x - b.x) < range && Math.abs(p.y - b.y) < range && dist(p, b) < range && preyOK(sim, b, p, hungry));
  const near = arr => arr.reduce((m, x) => (!m || dist(x, b) < dist(m, b) ? x : m), null);
  if (people.length) {
    const p = near(people), home = b.kind === 'tiger' ? b.home : null;
    let w = b.kind === 'wolf' ? 0.35 : 0.12;
    if (home && dist(p, home) < K.tiger.territory) w *= 2.5;        // 闯进了虎的地盘
    if (sim.now.light < 0.9) w *= 1.6;
    if (hungry) w *= 1.6;
    if (!herds.length) w *= 3;
    if (sim.rng() < w) return p;
  }
  return herds.length ? near(herds) : null;
}
function fleeFrom(sim, b, from, d = 700, hours = 6) {
  const a = Math.atan2(b.y - from.y, b.x - from.x) + sim.rng.range(-0.4, 0.4);
  b.wx = clamp(b.x + Math.cos(a) * d, 40, sim.map.w - 40); b.wy = clamp(b.y + Math.sin(a) * d, 40, sim.map.h - 40);
  b.state = 'flee'; b.fleeUntil = sim.t + hours * 60; b.target = null;
}
export function scareBeast(sim, b, days = 3) {
  fleeFrom(sim, b, sim.camp, 900, 10);
  b.scared = sim.t + days * DAY;
}

function attack(sim, b, t) {
  const name = b.kind === 'tiger' ? '虎' : '狼';
  if (t.kind === 'herd') { // 鹿群
    if (sim.rng() < 0.5) {
      t.n -= 1; sim.stats.deerByBeast++;
      const eat = b.kind === 'wolf' ? sim.beasts.filter(w => w.kind === 'wolf' && !w.dead && !w.gone && dist(w, b) < 400) : [b];
      for (const w of eat) { w.hunger = 0; w.rest = sim.t + DAY; w.state = 'roam'; w.target = null; }
    }
    else { t.flee = sim.t + 40; const a = sim.rng.range(0, 6.28); t.fx = t.x + Math.cos(a) * 160; t.fy = t.y + Math.sin(a) * 160; b.state = 'roam'; b.next = sim.t + 90; }
    b.target = null;
    return;
  }
  const comp = companions(sim, t, 90);
  if (comp >= 2) {
    fleeFrom(sim, b, t, 600, 8);
    b.wary = sim.t + 2 * DAY;
    log(sim, `${name}扑向${t.name}，大家一起吼着把它赶跑了`, 'danger', { who: t.id });
    return;
  }
  const pk = (b.kind === 'tiger' ? K.tiger.attack : K.wolf.attack) - 0.2 * t.skills.hunt - (t.temper === '勇' ? 0.1 : 0) - comp * 0.15 + (t.age < 14 ? 0.1 : 0) + (t.asleep ? 0.12 : 0) - (t.clothes ? 0.04 : 0);
  if (sim.rng() < pk) {
    const where = placeName(sim, t);
    die(sim, t, b.kind === 'tiger' ? '虎' : '狼', where);
    b.hunger = 0; b.rest = sim.t + (b.kind === 'tiger' ? 2 * DAY : DAY);
    b.state = 'roam'; b.target = null;
    sim.stats.beastKills++;
  } else {
    if (sim.rng() < 0.5) injure(sim, t, 0.35, `被${name}扑伤，拼命逃了回来`, b.kind === 'tiger' ? '虎' : '狼');
    else log(sim, `${name}扑向${t.name}，扑了个空，${t.name}逃回来了`, 'danger', { who: t.id });
    fleeFrom(sim, b, t, 600, 8);
    b.wary = sim.t + 2 * DAY;
  }
}

function trapCheck(sim, b) {
  for (const t of sim.buildings) {
    if (t.type !== 'trap' || t.sprung || Math.abs(t.x - b.x) > 24 || Math.abs(t.y - b.y) > 24) continue;
    if (b.trapped?.[t.id]) continue;
    (b.trapped ||= {})[t.id] = true;
    if (sim.rng() >= (t.deadly || 0.2) * (b.kind === 'tiger' ? 0.4 : 1)) continue;
    t.sprung = true;
    if (b.kind === 'wolf') { killBeast(sim, b, '一头狼掉进陷阱，被尖桩扎死了'); sim.stock.hide += 0; }
    else { b.wound = (b.wound || 0) + 1; fleeFrom(sim, b, t, 700, 12); log(sim, `${b.name}踩进陷阱，带着伤逃了`, 'danger'); if (b.wound >= 3) killBeast(sim, b, `${b.name}伤重，倒下了`); }
    return true;
  }
  return false;
}
function hunterTick(sim, b, dt, cfg) {
  b.hunger = Math.min(1.2, b.hunger + cfg.hungerDay * dt / DAY);
  if (sim.steps % 3 === 0 && trapCheck(sim, b)) return;
  if (b.rest > sim.t) { moveBeast(sim, b, b.home.x, b.home.y, 2.5, dt); return; }
  if (b.state === 'flee') {
    if (moveBeast(sim, b, b.wx, b.wy, 7, dt) || sim.t > b.fleeUntil) { b.state = 'roam'; b.wx = b.x; b.wy = b.y; }
    return;
  }
  if (b.state === 'roam') {
    if (b.hunger > cfg.hunt && sim.t >= b.next && (!cfg.nightOnly || sim.now.light < 0.9)) {
      b.next = sim.t + 30;
      const prey = choosePrey(sim, b, cfg.range);
      if (prey && prey.name && sim.now.light < 0.9 && dist(prey, sim.camp) < sim.camp.r + 260 && tribeKnows(sim, 'dog') && sim.rng() < 0.45) {
        b.wary = sim.t + 6 * 60; b.next = sim.t + 120;
        if (!sim.barkAt || sim.t - sim.barkAt > 6 * 60) { sim.barkAt = sim.t; log(sim, `夜里狗叫成一片，${b.name}没敢靠近`, 'danger'); }
        sim.stats.barks = (sim.stats.barks || 0) + 1;
        return;
      }
      if (prey) { b.state = 'stalk'; b.target = prey.id; b.since = sim.t; return; }
    }
    if (Math.hypot(b.wx - b.x, b.wy - b.y) < 6) {
      const a = sim.rng.range(0, 6.28), r = sim.rng.range(40, cfg.roam);
      b.wx = clamp(b.home.x + Math.cos(a) * r, 40, sim.map.w - 40); b.wy = clamp(b.home.y + Math.sin(a) * r, 40, sim.map.h - 40);
    }
    moveBeast(sim, b, b.wx, b.wy, 2.2, dt);
    return;
  }
  // stalk
  const t = sim.idx[b.target];
  const isHerd = t && t.kind === 'herd';
  if (!t || (isHerd ? t.n <= 0 : !t.alive) || sim.t - b.since > 6 * 60 || (!isHerd && !preyOK(sim, b, t, b.hunger > 0.85))) {
    b.state = 'roam'; b.target = null; b.next = sim.t + 45; return;
  }
  const d = dist(b, t);
  moveBeast(sim, b, t.x, t.y, d < 90 ? cfg.dash : cfg.speed, dt);
  if (dist(b, t) < 26) attack(sim, b, t);
}

const TIGER = () => ({ hungerDay: K.tiger.hungerDay, hunt: 0.55, range: 800, roam: 380, speed: K.tiger.speed, dash: K.tiger.dash, nightOnly: false });
const WOLF = () => ({ hungerDay: K.wolf.hungerDay, hunt: 0.45, range: 1100, roam: 260, speed: K.wolf.speed, dash: 8, nightOnly: true });

function wolfTick(sim, b, dt) {
  if (b.stay && !sim.march && sim.era?.flooded && sim.t - sim.era.trialAt > 3 * DAY && (sim.era.done || sim.t - sim.era.trialAt > 20 * DAY)) b.stay = false;
  if (sim.now.season !== 3 && b.state !== 'leave' && !b.stay) { b.state = 'leave'; const e = edgePoint(sim, b); b.wx = e.x; b.wy = e.y; }
  if (b.state === 'leave') { if (moveBeast(sim, b, b.wx, b.wy, 5, dt, false)) { b.gone = true; } return; }
  hunterTick(sim, b, dt, WOLF());
}
function edgePoint(sim, p) {
  const { w, h } = sim.map, c = sim.camp;
  const cands = [{ x: 20, y: p.y }, { x: w - 20, y: p.y }, { x: p.x, y: 20 }, { x: p.x, y: h - 20 }];
  return cands.reduce((m, q) => (dist(q, c) > dist(m, c) ? q : m));
}

// ---------------- 人打兽 ----------------
function fights(sim, dt) {
  for (const b of sim.beasts) {
    if (b.dead || b.gone) continue;
    const F = sim.alive.filter(p => p.job && p.job.kind === 'fight' && p.job.ref === b.id && Math.abs(p.x - b.x) < 60 && dist(p, b) < 55);
    if (!F.length) { b.fightW = 0; continue; }
    if ((b.fightW = (b.fightW || 0) + dt) < 10) continue;
    b.fightW = 0;
    const n = F.length, sk = F.reduce((s, p) => s + p.skills.hunt, 0) / n;
    const pk = clamp(0.07 * n + 0.25 * sk + (F.some(p => p.temper === '勇') ? 0.06 : 0) + (sim.buffs.light > sim.t ? 0.05 : 0) - (b.kind === 'tiger' ? 0.12 : 0), 0.04, 0.8);
    const names = F.map(p => p.name).join('、');
    if (sim.rng() < pk) {
      killBeast(sim, b, `${names}合力打死了${b.name}`);
      for (const p of F) { skillUp(p, 'hunt', 0.05); p.morale = Math.min(1, p.morale + 0.1); }
      if (b.kind === 'tiger') sim.stock.hide += 2;
    } else {
      const v = F[sim.rng.int(n)];
      if (sim.rng() < (b.kind === 'tiger' ? 0.22 : 0.07)) die(sim, v, b.kind === 'tiger' ? '虎' : '狼', `跟${b.name}搏斗时`);
      else injure(sim, v, 0.3, `跟${b.name}搏斗受了伤`, b.kind === 'tiger' ? '虎' : '狼');
      b.wound++;
      if (b.wound >= 3) killBeast(sim, b, `${b.name}伤重，倒下了`);
      else if (sim.rng() < 0.45) fleeFrom(sim, b, F[0], 600, 8);
    }
  }
}
export function killBeast(sim, b, text) {
  b.dead = true; b.state = 'dead'; b.diedAt = sim.t;
  sim.stats.beastsKilled = (sim.stats.beastsKilled || 0) + 1;
  if (b.kind === 'tiger') sim.tigerBack = sim.t + 21 * DAY;
  log(sim, text, 'work');
}

export function beastsTick(sim, dt) {
  for (const h of sim.herds) herdTick(sim, h, dt);
  for (const b of sim.beasts) {
    if (b.dead || b.gone) continue;
    if (b.kind === 'tiger') hunterTick(sim, b, dt, TIGER());
    else if (b.kind === 'swarm') swarmTick(sim, b, dt);
    else wolfTick(sim, b, dt);
  }
  fights(sim, dt);
}

// 每天：春天鹿添崽；入冬狼来；虎死了过一阵又有虎
export function dailyBeasts(sim, newSeason) {
  const s = sim.now.season;
  if (newSeason && s === 0) {
    let born = 0;
    let came = 0;
    for (const h of sim.herds) {
      if (h.n > 0) { const k = Math.max(1, Math.round(h.n * 0.5)); h.n = Math.min(14, h.n + k); born += k; }
      else if (sim.rng() < 0.5) { h.n = 2 + sim.rng.int(3); came += h.n; }      // 吃空的地方，开春从山那边又过来几头
    }
    if (born) log(sim, `开春了，鹿群里添了 ${born} 头小鹿`, 'season');
    if (came) log(sim, `山那边又过来 ${came} 头鹿`, 'season');
  }
  if (newSeason && s === 3) {
    const far = sim.map.forests.reduce((m, f) => (!m || dist(f, sim.camp) > dist(m, sim.camp) ? f : m), null) || sim.map.lair;
    const e = edgePoint(sim, far);
    const n = K.wolf.pack + (sim.rng() < 0.4 ? 1 : 0) + (sim.harsh?.now ? 2 : 0);
    for (let i = 0; i < n; i++) makeBeast(sim, 'wolf', e.x + sim.rng.range(-40, 40), e.y + sim.rng.range(-40, 40), { home: { x: (e.x + far.x) / 2, y: (e.y + far.y) / 2 } });
    log(sim, `入冬了，${n} 头狼从远处下来，夜里听得见嚎声${sim.harsh?.now ? '——冬天冷，狼比往年多' : ''}`, 'danger');
  }
  if (sim.tigerBack && sim.t >= sim.tigerBack && !sim.beasts.some(b => b.kind === 'tiger' && !b.dead)) {
    sim.tigerBack = 0;
    const L = sim.map.lair;
    makeBeast(sim, 'tiger', L.x, L.y);
    log(sim, '又有一只虎占了远处的林子', 'danger');
  }
  sim.beasts = sim.beasts.filter(b => !(b.gone || (b.dead && sim.t - (b.diedAt || sim.t) > 2 * DAY)));
}
