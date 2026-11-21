// 族人：名字、脾气、手艺、需求（饿、渴、累、冷）、病、士气、爱戴与敬畏；
// 每人自己挑活：急事先办（逃命、喝水、吃饭、烤火、睡觉），再听号令，再按族里缺什么、自己擅长什么去干活。
import { K, DAY, NAMES, TECHS } from './config.js';
import { isDark, daylightLeft, seasonOf, sunrise } from './calendar.js';
import { dist, clamp, log, FOOD, addFood, foodTotal, takeFood, nearestFire, mainFire, fireHeatAt, dropPoint, known, reveal, burnRate, inFlood, dryPoint, localBuildings } from './util.js';
import { nearestRiverPoint, RIVER_HALF } from './mapgen.js';
import { knows, tribeKnows, roleAlive, addProgress, studyMul, paintOne, unpainted, muralSpot, checkLoss, maybeGenius } from './tech.js';
import { sowSeasonOk, harvestField, onCanalSegBuilt } from './farming.js';

export const LABEL = {
  eat: '吃饭', drink: '喝水', sleep: '睡觉', warm: '烤火', rest: '养着', idle: '歇着', play: '玩', flee: '逃命',
  gather: '采浆果', nuts: '捡坚果', chop: '砍柴', quarry: '采石', grass: '割草', fish: '叉鱼', water: '挑水', hunt: '打猎',
  fight: '打兽', tend: '添柴', kindle: '钻木取火', build: '盖', sew: '缝皮衣', explore: '四处看看', scout: '探路', road: '修路',
  rally: '集结', train: '操练', migrate: '搬家', march: '赶路', study: '琢磨', paint: '画壁画', heal: '治病', trapcheck: '看陷阱',
  dance: '跳舞', lost: '迷了路', root: '挖块根',
  clearField: '开垦农田', sowField: '播种', harvestField: '收割谷物', digCanal: '挖水渠', weaveCloth: '织布衣',
};
const WORK = new Set(['gather', 'nuts', 'chop', 'quarry', 'grass', 'fish', 'water', 'hunt', 'fight', 'build', 'road', 'train', 'trapcheck', 'root', 'march', 'clearField', 'sowField', 'harvestField', 'digCanal', 'weaveCloth']);
const TEMPER = {
  勤: { work: 1.12, obey: 0.1, note: '勤快' }, 懒: { work: 0.85, obey: -0.05, note: '懒散' },
  勇: { work: 1, obey: 0, note: '胆大' }, 怯: { work: 1, obey: 0.05, note: '胆小' },
  和: { work: 1, obey: 0.05, note: '和气' }, 倔: { work: 1.05, obey: -0.18, note: '倔' },
};
export const TEMPERS = Object.keys(TEMPER);
export const temperNote = t => TEMPER[t]?.note || '';
const DONE = 'done';

// ---------------- 建族 ----------------
const FOUNDERS = [
  { name: '老柯', sex: 'm', age: 51, temper: '倔', skills: { fire: 0.8, hunt: 0.5, build: 0.45 } },
  { name: '阿禾', sex: 'f', age: 47, temper: '和', skills: { gather: 0.6, fire: 0.55, fish: 0.4 } },
  { name: '石头', sex: 'm', age: 29, temper: '勇', skills: { hunt: 0.62, chop: 0.5 } },
  { name: '小杏', sex: 'f', age: 26, temper: '勤', skills: { gather: 0.58, fish: 0.45, build: 0.4 } },
  { name: '阿木', sex: 'm', age: 24, temper: '勤', skills: { chop: 0.62, build: 0.55 } },
  { name: '青禾', sex: 'f', age: 23, temper: '怯', skills: { gather: 0.52, fish: 0.5 } },
  { name: '阿岩', sex: 'm', age: 21, temper: '懒', skills: { quarry: 0.6, hunt: 0.42 } },
  { name: '小溪', sex: 'f', age: 20, temper: '和', skills: { fish: 0.56, gather: 0.42 } },
  { name: '小满', sex: 'f', age: 7, temper: '勇' },
  { name: '阿栗', sex: 'm', age: 5, temper: '怯' },
];
const COUPLES = [['老柯', '阿禾'], ['石头', '小杏'], ['阿木', '青禾'], ['阿岩', '小溪']];
const KIDS = { 小满: ['小杏', '石头'], 阿栗: ['青禾', '阿木'] };

export function makePerson(sim, o) {
  const r = sim.rng, sk = o.skills || {};
  const base = () => (o.age < 14 ? r.range(0.05, 0.2) : r.range(0.18, 0.42));
  const n = sim.nextId++;
  const p = {
    id: `p${n}`, n, name: o.name, sex: o.sex, age: o.age, alive: true, x: o.x, y: o.y,
    temper: o.temper || r.pick(TEMPERS), partner: null, parents: o.parents || [], kids: [],
    skills: { gather: sk.gather ?? base(), chop: sk.chop ?? base(), quarry: sk.quarry ?? base(), hunt: sk.hunt ?? base(), fish: sk.fish ?? base(), build: sk.build ?? base(), fire: sk.fire ?? base() * 0.6 },
    hunger: 0.25, thirst: 0.2, fatigue: 0.2, cold: 0, health: 1, sick: 0, sev: 0, morale: 0.62, felt: 15,
    love: K.baseLove + r.range(-0.06, 0.06), fear: K.baseFear + r.range(-0.05, 0.05), grief: 0,
    clothes: 0, pregnant: 0, carry: null, job: null, order: null, asleep: false, inside: null, bed: null,
    hurt: 0, hurtBy: '', born: sim.t, cause: null, worked: {}, knows: {}, genius: null, lost: null, plague: false, immune: 0,
  };
  sim.idx[p.id] = p;
  return p;
}

export function foundTribe(sim) {
  const c = sim.camp;
  FOUNDERS.forEach((o, i) => {
    const a = i / FOUNDERS.length * Math.PI * 2;
    const p = makePerson(sim, { ...o, x: c.x + Math.cos(a) * 50, y: c.y + Math.sin(a) * 30 });
    sim.people.push(p);
  });
  const by = n => sim.people.find(p => p.name === n);
  for (const [a, b] of COUPLES) { by(a).partner = by(b).id; by(b).partner = by(a).id; }
  for (const [k, ps] of Object.entries(KIDS)) for (const n of ps) { by(k).parents.push(by(n).id); by(n).kids.push(by(k).id); }
  sim.alive = sim.people.filter(p => p.alive);
}

// ---------------- 小工具 ----------------
const J = (kind, prio, x, y, extra = {}) => ({ kind, prio, x, y, phase: 'go', w: 0, ...extra });
export function setJob(sim, p, j) {
  if (p.job && p.job.kind !== j?.kind) sim.plan.count[p.job.kind] = Math.max(0, (sim.plan.count[p.job.kind] || 0) - 1);
  if (j && (!p.job || p.job.kind !== j.kind)) sim.plan.count[j.kind] = (sim.plan.count[j.kind] || 0) + 1;
  p.job = j;
  if (!j || j.kind !== 'sleep') { p.asleep = false; p.inside = null; }
}
const adult = p => p.age >= 14;
const elder = p => p.age >= 50;
const lightOn = sim => sim.buffs.light > sim.t;

function speedOf(sim, p, run) {
  let v = run ? K.run : K.walk;
  if (p.carry && p.carry.n > 2) v *= 0.82;
  if (p.age < 10) v *= 0.8; else if (elder(p)) v *= 0.85;
  if (p.health < 0.5) v *= 0.75;
  if (p.fatigue > 0.9) v *= 0.85;
  if (sim.now.light < 0.6) v *= 0.85;
  // 拖家带口、背着火种和家当，走得慢；掉了队的快步赶上来
  if (!run && p.job?.kind === 'march' && !(sim.march && dist(p, sim.march.c) > 100 && p.job.i <= sim.march.minI + 1)) v *= K.era.pace;
  const rk = roadKey(p.x, p.y);
  if (sim.bridgeCells?.has(rk)) v *= 1.35;
  else if (sim.map.riverDist(p.x, p.y) < RIVER_HALF) v *= p.knows?.canoe ? 0.92 : p.knows?.raft ? 0.85 : K.riverSlow;
  else if (sim.roadCells.size && sim.roadCells.has(rk)) v *= K.roadFast;
  return v;
}
export const roadKey = (x, y) => Math.floor(y / 25) * 1000 + Math.floor(x / 25);

export function moveTo(sim, p, x, y, dt, run = false) {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  const s = speedOf(sim, p, run) * dt;
  if (d <= s) { p.x = x; p.y = y; return true; }
  p.x += dx / d * s; p.y += dy / d * s;
  return false;
}
const arrived = (sim, p, j, dt, run) => moveTo(sim, p, j.x, j.y, dt, run);

export function factor(sim, p, skill) {
  const s = p.skills[skill] ?? 0.35;
  return (0.6 + 0.8 * s) * (0.7 + 0.6 * p.morale) * (lightOn(sim) ? 1.15 : 1) * (0.5 + 0.5 * p.health) * (TEMPER[p.temper]?.work || 1) * (p.age < 14 ? 0.5 : elder(p) ? 0.8 : 1) * toolMul(sim, p, skill);
}
// 学会的手艺让活干得快：辨识野食（采集）、打制石器（砍、采石、盖；有石器台更快）
function toolMul(sim, p, skill) {
  const k = p.knows;
  if (!k) return 1;
  if (skill === 'gather') return k.forage ? 1.25 : 1;
  if (skill === 'fish') return k.net ? 1.8 : 1;
  if (skill === 'chop' || skill === 'quarry' || skill === 'build') return k.knap ? 1.15 + (sim.benchTool || 0) : 1;
  return 1;
}
// 一趟背多少：会编筐的多背一半
const carryCap = (p, base = K.carry) => base * (p.knows?.basket ? 1.5 : 1);
export const skillUp = (p, k, d) => { p.skills[k] = Math.min(1, (p.skills[k] || 0) + d); };

// 营地里每人的位置（围着主火）
function campSpot(sim, p, r0 = 34, r1 = 70) {
  const f = sim.march ? sim.march.c : mainFire(sim) || sim.camp, k = p.n;
  const a = k * 2.399, rr = r0 + ((k * 37) % 100) / 100 * (r1 - r0);
  return { x: f.x + Math.cos(a) * rr, y: f.y + Math.sin(a) * rr * 0.7 };
}
const inCamp = (sim, p) => (sim.march ? dist(p, sim.march.c) < 110 : dist(p, sim.camp) < sim.camp.r);

function deposit(sim, p) {
  const c = p.carry;
  if (!c) return;
  if (FOOD[c.kind]) addFood(sim, c.kind, c.n);
  else if (c.kind in sim.stock) sim.stock[c.kind] += c.n;
  if (c.hide) sim.stock.hide += c.hide;
  sim.stats.got[c.kind] = (sim.stats.got[c.kind] || 0) + c.n;
  p.carry = null;
}
function addCarry(p, kind, n) {
  if (!p.carry) p.carry = { kind, n: 0 };
  if (p.carry.kind === kind) p.carry.n += n;
}
const carryN = p => (p.carry ? p.carry.n : 0);

const claims = (sim, ref) => sim.alive.reduce((n, q) => n + (q.job && q.job.ref === ref ? 1 : 0), 0);
export const banned = (sim, id) => sim.bans.some(b => b.ref === id);
export function companions(sim, p, r) {
  let n = 0;
  for (const q of sim.alive) if (q !== p && q.age >= 10 && Math.abs(q.x - p.x) < r && Math.abs(q.y - p.y) < r && dist(q, p) < r) n++;
  return n;
}

// 看得见的野兽威胁
export function threatFor(sim, p) {
  if (p.asleep) return null;
  const see = p.temper === '怯' ? 300 : p.temper === '勇' ? 150 : 230;
  for (const b of sim.beasts) {
    if (b.dead || b.gone || b.kind === 'swarm') continue;
    const d = dist(b, p);
    if (d < see && (b.state === 'stalk' || d < 110)) return { b, d };
  }
  return null;
}

// ---------------- 需求 ----------------
function feltTemp(sim, p) {
  let T = sim.now.temp;
  const sh = p.inside ? sim.idx[p.inside] : null;
  if (sh) T += K.shelterHeat.base + K.shelterHeat.warmth * sh.warmth;
  if (sim.weather.wet && !(sh && sh.rainproof > 0.45)) T -= sim.weather.kind === 'snow' ? 2 : 3;
  T += fireHeatAt(sim, p) * (sh ? 0.5 : 1);
  if (p.clothes) T += p.clothes >= 2 ? 8 : 5;
  if (p.asleep && !sh) T -= 2;
  if (p.job && WORK.has(p.job.kind) && p.job.phase === 'work') T += 2;
  return T;
}

export function needsTick(sim, p, dt) {
  const dd = dt / DAY, kid = p.age < 14, winter = sim.now.season === 3;
  const working = p.job && WORK.has(p.job.kind) && p.job.phase !== 'back';
  p.hunger += (kid ? (p.age < 2 ? 0.3 : K.hunger.child) : K.hunger.adult) * (winter ? 1.3 : 1) * (working ? 1.12 : 1) * (p.pregnant ? 1.15 : 1) * dd;
  p.thirst += K.thirst * (sim.now.temp > 24 ? 1.3 : 1) * (working ? 1.15 : 1) * (p.lost ? 0.5 : 1) * dd;
  if (p.asleep) p.fatigue = Math.max(0, p.fatigue - K.fatigueSleep * dd);
  else p.fatigue += K.fatigueAwake * (working ? 1.2 : 1) * dd;
  const T = feltTemp(sim, p);
  p.felt = T;
  if (T < K.coldBelow) p.cold += (K.coldBelow - T) * 0.11 * dd;
  else p.cold -= (0.6 + Math.max(0, T - K.coldBelow) * 0.4) * dd;
  p.hunger = clamp(p.hunger, 0, 1.5); p.thirst = clamp(p.thirst, 0, 1.5); p.fatigue = clamp(p.fatigue, 0, 1.2); p.cold = clamp(p.cold, 0, 1.4);

  const frail = p.age < 3 || p.age >= 55 ? 1.4 : 1;
  const dmg = {
    // 挨饿：老人小孩先撑不住，各人底子也不一样，饥荒不会一夜之间全倒下
    饿: (p.hunger >= 1.3 ? 0.4 : p.hunger >= 1 ? 0.22 : 0) * (p.age < 10 || p.age >= 48 ? 1.35 : 1) * (0.75 + 0.5 * ((p.n * 0.6180339) % 1)),
    渴: p.thirst >= 1 ? 0.6 : 0,
    冻: p.cold > 0.7 ? 0.6 * (p.cold - 0.7) / 0.3 * frail : 0,
    病: p.sick > 0 ? (p.plague ? K.plague.dmg : 0.1) * p.sev * frail : 0,
  };
  let hurt = dmg.饿 + dmg.渴 + dmg.冻 + dmg.病;
  const heal = p.hunger < 0.7 && p.thirst < 0.8 && p.cold < 0.5 && !(p.sick > 0) ? K.heal * (p.asleep ? 2 : 1) : 0;
  p.health = Math.min(1, p.health + (heal - hurt) * dd);
  if (p.sick > 0) {
    const herbGarden = sim.era2?.active && tribeKnows(sim, 'herbgarden') ? 1.45 : 1;
    p.sick -= dd * (lightOn(sim) ? 2 : 1) * (p.inside ? 1.3 : 1) * herbGarden;
    if (p.sick <= 0) { p.sick = 0; p.sev = 0; if (p.plague) { p.plague = false; p.immune = sim.t + 28 * DAY; } }
  }
  // 士气
  const target = 0.55 + 0.3 * (p.love - 0.3) - 0.3 * Math.max(0, p.fear - 0.35) - 0.35 * Math.max(0, p.hunger - 0.5)
    - 0.3 * Math.max(0, p.cold - 0.4) - p.grief - (p.sick > 0 ? 0.12 : 0) + (lightOn(sim) ? 0.2 : 0) + (p.bed ? 0.04 : 0) + sim.comfort;
  p.morale += (clamp(target) - p.morale) * Math.min(1, 1.5 * dd);
  p.grief = Math.max(0, p.grief - 0.12 * dd);
  p.age += dd / 28;
  if (p.health <= 0) {
    let cause = Object.entries(dmg).sort((a, b) => b[1] - a[1])[0][0];
    if (p.hurt > sim.t - DAY && p.hurtBy) cause = p.hurtBy;
    die(sim, p, cause);
  }
}

// ---------------- 生死 ----------------
const HOW = {
  饿: '饿死了', 渴: '渴死了', 冻: '冻死了', 病: '病死了', 老: '老死了', 虎: '被虎叼走了', 狼: '被狼咬死了', 伤: '伤重不治', 雷: '被雷火劈死了', 鹿: '被鹿角挑伤，没挺过来',
  淹: '被大水卷走了',
};
export function die(sim, p, cause, where = '') {
  if (!p.alive) return;
  p.alive = false; p.cause = cause; p.diedAt = sim.t;
  setJob(sim, p, null);
  sim.alive = sim.alive.filter(q => q !== p);
  sim.stats.deaths.push({ name: p.name, age: Math.floor(p.age), cause, t: sim.t });
  for (const q of sim.alive) {
    const kin = q.id === p.partner || p.kids.includes(q.id) || p.parents.includes(q.id);
    q.grief = Math.min(0.5, q.grief + (kin ? 0.3 : 0.08));
    q.love = Math.max(0, q.love - (kin ? 0.05 : 0.012));
  }
  const pt = sim.idx[p.partner];
  if (pt) pt.partner = null;
  for (const o of sim.orders) o.members = o.members.filter(id => id !== p.id);
  log(sim, `${p.name}（${Math.floor(p.age)} 岁）${where}${p.plague && cause === '病' ? '得热病' : ''}${HOW[cause] || cause}`, 'death', { who: p.id, cause });
  checkLoss(sim, p);
  // 会办葬礼：第二天傍晚大家送他一程，哀伤减半
  if (tribeKnows(sim, 'burial') && sim.alive.length) sim.later.push({ t: sim.t + 12 * 60, kind: 'funeral', name: p.name });
}
// 活着离开（投奔外族）：不算死，但手艺一样带走了
export function removePerson(sim, p, why) {
  if (!p.alive) return;
  p.alive = false; p.gone = why; p.diedAt = sim.t;
  setJob(sim, p, null);
  sim.alive = sim.alive.filter(q => q !== p);
  const pt = sim.idx[p.partner];
  if (pt) pt.partner = null;
  for (const o of sim.orders) o.members = o.members.filter(id => id !== p.id);
  for (const q of sim.alive) q.grief = Math.min(0.5, q.grief + 0.04);
  checkLoss(sim, p);
}

export function injure(sim, p, amount, by, cause) {
  p.health -= amount;
  p.hurt = sim.t; p.hurtBy = cause;
  if (p.health <= 0) die(sim, p, cause);
  else log(sim, `${p.name}${by}`, 'danger', { who: p.id });
}

function nameFor(sim, sex) {
  const used = new Set(sim.people.map(p => p.name));
  const pool = NAMES[sex].filter(n => !used.has(n));
  return pool.length ? pool[sim.rng.int(pool.length)] : `${NAMES[sex][sim.rng.int(NAMES[sex].length)]}${sim.people.length}`;
}

// 每天清早：怀孕、生产、老、病
export function dailyPeople(sim) {
  const P = sim.plan, winter = sim.now.season === 3;
  const avgMorale = sim.alive.reduce((s, p) => s + p.morale, 0) / Math.max(1, sim.alive.length);
  for (const f of [...sim.alive]) {
    // 生
    if (f.pregnant && sim.t >= f.pregnant) {
      f.pregnant = 0;
      const sex = sim.rng.chance(0.5) ? 'm' : 'f', pt = sim.idx[f.partner];
      const baby = makePerson(sim, { name: nameFor(sim, sex), sex, age: 0, temper: sim.rng.pick(TEMPERS), x: f.x, y: f.y, parents: [f.id, ...(pt ? [pt.id] : [])] });
      baby.health = 0.85; baby.hunger = 0.1;
      maybeGenius(sim, baby);
      f.kids.push(baby.id); if (pt) pt.kids.push(baby.id);
      sim.people.push(baby); sim.alive.push(baby);
      f.health = Math.max(0.3, f.health - 0.1);
      for (const q of sim.alive) { q.morale = Math.min(1, q.morale + 0.06); q.love = Math.min(1, q.love + 0.01); }
      sim.stats.births++;
      log(sim, `${f.name}生了个${sex === 'm' ? '儿子' : '女儿'}，取名${baby.name}`, 'birth', { who: baby.id });
      continue;
    }
    // 怀
    if (f.sex === 'f' && !f.pregnant && f.age >= 17 && f.age <= 40) {
      const pt = sim.idx[f.partner];
      if (!pt || !pt.alive || pt.age < 17) continue;
      const youngest = Math.min(99, ...f.kids.map(id => sim.idx[id]).filter(k => k && k.alive).map(k => k.age));
      if (youngest < 1) continue;
      const ch = K.birthChance * (avgMorale > 0.5 ? 1 : 0.4) * (P.foodDays > 1.5 ? 1 : 0.3) * (P.housing >= sim.alive.length ? 1 : 0.35) * (winter ? 0.5 : 1);
      if (sim.rng() < ch) { f.pregnant = sim.t + K.pregnantDays * DAY; log(sim, `${f.name}有了身孕`, 'birth', { who: f.id }); }
    }
    // 老
    if (f.age > 52 && sim.rng() < (f.age - 52) * 0.0025) { die(sim, f, '老'); continue; }
    // 病
    if (!(f.sick > 0) && !f.lost) {
      const sickNear = sim.alive.filter(q => q.sick > 0 && !q.plague && dist(q, f) < 150).length;
      const garden = sim.era2?.active && tribeKnows(sim, 'herbgarden') ? 0.55 : 1;
      const ch = (0.006 * (f.cold > 0.6 ? 3 : 1) * (f.hunger > 0.8 ? 2 : 1) * (winter ? 1.5 : 1) * (f.age < 3 || f.age >= 50 ? 1.5 : 1) + 0.012 * sickNear) * garden;
      if (sim.rng() < ch) {
        f.sick = sim.rng.range(2, 5); f.sev = sim.rng.range(0.5, 1);
        log(sim, `${f.name}病倒了`, 'danger', { who: f.id });
      }
    }
  }
}

// ---------------- 想：现在该干什么 ----------------
export function orderOf(sim, p) {
  if (!p.order) return null;
  const o = sim.orders.find(x => x.id === p.order);
  if (!o || o.done || sim.t >= o.until) { p.order = null; return null; }
  return o;
}

// 便宜的急迫度：比当前活计急很多才重想
export function urgency(sim, p) {
  if (p.lost) return 95;
  if (sim.flood && inFlood(sim, p.x, p.y)) return 99;
  const o = orderOf(sim, p);
  if ((!o || o.job !== 'fight') && threatFor(sim, p)) return 100;
  if (p.thirst > 0.8) return 90;
  if (p.hunger > 0.8 && sim.plan.food >= 1) return 88;
  if (p.cold > 0.6 && !sim.anyLitCamp && p.age >= 14 && sim.stock.wood >= 1 && !sim.plan.count.kindle) return 89;
  if (p.cold > 0.8 && sim.anyLit) return 86;
  if (p.fatigue > 0.97) return 84;
  if (p.hurt > sim.t - 240 || p.health < 0.35 || p.sick > 0) return 82;
  if (o && o.job === 'rally') return 75;
  if (sim.now.bed) return 70;
  if (sim.march && sim.march.members.includes(p.id) && !(p.job && p.job.kind === 'march')) return 66;
  if (sim.now.dark) return 62;
  if (o && !(p.job && p.job.order === o.id)) return 61;
  return 0;
}

// 发大水时，要蹚过水才去得了的活不去：在干地方待着
function crossesFlood(sim, p, j) {
  for (let k = 1; k <= 8; k++) { const t = k / 8; if (inFlood(sim, p.x + (j.x - p.x) * t, p.y + (j.y - p.y) * t)) return true; }
  return false;
}
export function think(sim, p) {
  const j = think0(sim, p);
  if (sim.flood && j && j.kind !== 'flee' && j.kind !== 'march' && j.prio < 99 && j.x != null && crossesFlood(sim, p, j)) {
    const d = inFlood(sim, p.x, p.y) ? dryPoint(sim, p, 30) : { x: p.x, y: p.y };
    return J('idle', Math.min(j.prio, 40), d.x, d.y, { until: sim.t + 60 });
  }
  return j;
}
function think0(sim, p) {
  const N = sim.now, o = orderOf(sim, p), food = sim.plan.food;
  if (sim.flood && inFlood(sim, p.x, p.y)) { const d = dryPoint(sim, p, 30); return J('flee', 99, d.x, d.y, { from: 'flood', until: 0 }); }
  const marching = sim.march && sim.march.members.includes(p.id);
  const th = (!o || o.job !== 'fight') ? threatFor(sim, p) : null;
  // 赶路的人抱成一团举着火把走（孩子夹在大人中间）：狼不敢扑，用不着散开逃
  const stand = th && th.b.kind !== 'tiger' && ((p.temper === '勇' && companions(sim, p, 90) >= 2) || (marching && companions(sim, p, 120) >= 3));
  if (th && !stand) return fleeJob(sim, p, th.b);
  if (p.lost) return lostJob(sim, p);
  if (p.thirst > 0.8) return drinkJob(sim, p, 90);
  if (p.hunger > 0.8 && food >= 1) return eatJob(sim, p, 88);
  if (p.cold > 0.6 && !sim.anyLitCamp && adult(p)) { const t = fireJob(sim, p, 87); if (t) return t; }
  if (p.cold > 0.8 && sim.anyLit) return warmJob(sim, p, 86);
  if (p.fatigue > 0.97) return sleepJob(sim, p, 84);
  // 病了、伤了就歇着；赶路时咬牙跟着走，快不行了才停下
  if ((p.hurt > sim.t - 240 || p.health < 0.35 || p.sick > 0) && !(marching && p.health >= 0.2)) return J('rest', 82, ...Object.values(sleepSpot(sim, p)), { until: sim.t + 180 });
  if (o && o.job === 'rally') return orderJob(sim, p, o) || idleJob(sim, p, 75);
  if (N.bed) {
    const t = !marching && adult(p) && fireJob(sim, p, 71);
    return t || sleepJob(sim, p, 70);
  }
  if (marching) return marchJob(sim, p);
  if (N.dark && sim.danceUntil > sim.t && p.age >= 5) return danceJob(sim, p);
  if (N.dark) {
    const t = adult(p) && fireJob(sim, p, 62);
    if (t) return t;
    if (p.hunger > 0.3 && food >= 1) return eatJob(sim, p, 62);
    if (p.thirst > 0.45) return drinkJob(sim, p, 62);
    if (p.cold > 0.2 && sim.anyLit) return warmJob(sim, p, 62);
    return idleJob(sim, p, 62, 40);
  }
  if (o) { const j = orderJob(sim, p, o); if (j) return j; }
  if (p.hunger > 0.5 && food >= 1) return eatJob(sim, p, 50);
  if (p.thirst > 0.55) return drinkJob(sim, p, 50);
  if (p.cold > 0.55 && sim.anyLit) return warmJob(sim, p, 50);
  if (p.fatigue > 0.88) return sleepJob(sim, p, 50, true);
  if (p.restUntil > sim.t) return idleJob(sim, p, 25, 50);
  if (p.age < 6 || (p.pregnant && p.pregnant - sim.t < 3 * DAY)) return idleJob(sim, p, 20, 60, p.age < 6 ? 'play' : 'idle');
  return chooseWork(sim, p) || idleJob(sim, p, 10, 45);
}

function eatJob(sim, p, prio) {
  const s = inCamp(sim, p) ? { x: p.x, y: p.y } : campSpot(sim, p);
  return J('eat', prio, s.x, s.y);
}
function drinkJob(sim, p, prio) {
  if (inCamp(sim, p) && sim.stock.water >= 1) return J('drink', prio, p.x, p.y, { src: 'stock' });
  if (sim.flood) { const d = dryPoint(sim, p, 6); return J('drink', prio, d.x, d.y); }   // 水边就是水
  let best = nearestRiverPoint(sim.map, p), bd = best ? dist(best, p) : Infinity;
  for (const b of sim.buildings) if (b.type === 'well') { const d = dist(b, p); if (d < bd) { bd = d; best = b; } }
  for (const sp of sim.map.springs || []) if (known(sim, sp.x, sp.y)) { const d = dist(sp, p); if (d < bd) { bd = d; best = { ...sp, type: 'well' }; } }
  if (inCamp(sim, p) && sim.stock.water >= 1) return J('drink', prio, p.x, p.y, { src: 'stock' });
  const off = best.type === 'well' ? 0 : RIVER_HALF + 6, a = Math.atan2(p.y - best.y, p.x - best.x);
  return J('drink', prio, best.x + Math.cos(a) * off, best.y + Math.sin(a) * off);
}
function warmJob(sim, p, prio) {
  const nf = nearestFire(sim, p);
  if (!nf) return idleJob(sim, p, prio);
  const k = p.n, a = k * 2.399, rr = Math.min(nf.fire.radius * 0.55, 40);
  return J('warm', prio, nf.fire.x + Math.cos(a) * rr, nf.fire.y + Math.sin(a) * rr * 0.7, { ref: nf.fire.id });
}
function sleepSpot(sim, p) {
  const sh = !sim.march && p.bed && sim.idx[p.bed];
  if (sh && sh.built) {
    const k = p.n;
    return { x: sh.x + ((k % 5) - 2) * 5, y: sh.y - 6 };
  }
  return campSpot(sim, p, 30, 58);
}
function sleepJob(sim, p, prio, nap = false) {
  const s = sleepSpot(sim, p);
  return J('sleep', prio, s.x, s.y, { nap, shack: !sim.march && p.bed && sim.idx[p.bed]?.built ? p.bed : null });
}
function idleJob(sim, p, prio, mins = 60, kind = 'idle') {
  const s = campSpot(sim, p, 40, 95);
  return J(kind, prio, s.x, s.y, { until: sim.t + mins });
}
function fleeJob(sim, p, b) {
  const nf = nearestFire(sim, p);
  const to = nf && nf.d < 900 ? nf.fire : sim.camp;
  const a = Math.atan2(p.y - to.y, p.x - to.x);
  sim.stats.fled++;
  return J('flee', 100, to.x + Math.cos(a) * 30, to.y + Math.sin(a) * 20, { from: b.id, until: 0 });
}
// 迷了路：白天在走失的地方附近转，渴了找河、饿了找浆果；夜里就地睡（冷）
function lostJob(sim, p) {
  const L = p.lost;
  if (sim.now.bed || (sim.now.dark && p.fatigue > 0.6)) return J('lost', 95, p.x, p.y, { sleep: true });
  if (p.thirst > 0.6) { const q = nearestRiverPoint(sim.map, p); if (q && dist(q, p) < 520) { const a = Math.atan2(p.y - q.y, p.x - q.x); return J('lost', 95, q.x + Math.cos(a) * (RIVER_HALF + 6), q.y + Math.sin(a) * (RIVER_HALF + 6), { drink: true }); } }
  if (p.hunger > 0.5) {
    let b = null, bd = 320;
    for (const x of sim.map.bushes) if (x.food >= 1) { const d = dist(x, p); if (d < bd) { bd = d; b = x; } }
    if (b) return J('lost', 95, b.x + 5, b.y + 5, { eat: b.id });
  }
  const a = sim.rng.range(0, 6.28), r = sim.rng.range(40, 260);
  return J('lost', 95, clamp(L.x + Math.cos(a) * r, 30, sim.map.w - 30), clamp(L.y + Math.sin(a) * r, 30, sim.map.h - 30), {});
}
// 迁徙：沿着铅笔画的路走，走在前头的等后面的
function marchJob(sim, p) {
  const M = sim.march, R = M.route;
  let i = 0, bd = Infinity;
  for (let k = Math.max(0, M.minI - 2); k < R.length; k++) { const d = dist(R[k], p); if (d < bd) { bd = d; i = k; } if (d > bd + 200) break; }
  return J('march', 66, R[i].x, R[i].y, { i });
}
// 月圆夜：围着祭坛（没有就围着火）跳舞
function danceJob(sim, p) {
  const c = sim.buildings.find(b => b.type === 'altar') || mainFire(sim) || sim.camp;
  const a = p.n * 2.399, rr = 46 + (p.n % 3) * 9;
  return J('dance', 63, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr * 0.6 + 16, { a, rr, c: { x: c.x, y: c.y } });
}
function studyJob(sim, p) {
  const t = TECHS[sim.research.id];
  const b = (t.domain === 'craft' || t.domain === 'potter') && localBuildings(sim, 'bench')[0];
  const s = b ? { x: b.x + 12, y: b.y + 8 } : campSpot(sim, p, 30, 52);
  return J('study', 32, s.x, s.y, { tech: sim.research.id });
}
// 草药师要看的人：病着的、刚受了伤的，一天看一回
function patient(sim, p) {
  let best = null, bs = -Infinity;
  for (const q of sim.alive) {
    if (q.lost || (q.treated && sim.t - q.treated < 20 * 60)) continue;
    const need = (q.sick > 0 ? 1 + (q.plague ? 1 : 0) : 0) + (q.hurt > sim.t - 2 * DAY && q.health < 0.65 ? 0.8 : 0);
    if (!need) continue;
    const s = need - dist(p, q) / 800;
    if (s > bs) { bs = s; best = q; }
  }
  return best;
}
// 火：灭了就生；柴不够撑到下一回有人添（夜里要撑到天亮）就添满
export function fuelWanted(sim, f) {
  const N = sim.now;
  const hours = N.dark || N.bed ? ((sunrise(sim.t) - N.hour + 24) % 24) + 2 : 5;
  return hours * burnRate(sim, f, N.dark || N.bed) * 1.5;
}
function fireJob(sim, p, prio) {
  for (const f of sim.fires) {
    if (dist(f, sim.camp) > sim.camp.r + 80) continue;
    if (!f.lit && sim.stock.wood >= 1 && !sim.alive.some(q => q.job && q.job.kind === 'kindle')) return J('kindle', prio + 2, f.x + 14, f.y + 8, { ref: f.id });
    if (f.lit && f.fuel < fuelWanted(sim, f) && sim.stock.wood >= 1 && !sim.alive.some(q => q.job && q.job.kind === 'tend' && q.job.ref === f.id)) return J('tend', prio + 1, f.x - 12, f.y + 6, { ref: f.id });
  }
  return null;
}

// ---------------- 号令 → 活计 ----------------
function orderJob(sim, p, o) {
  const base = { order: o.id };
  switch (o.job) {
    case 'rally': {
      const k = p.n, a = k * 2.399, rr = 16 + (k % 4) * 10;
      return J('rally', 75, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr * 0.7, { ...base, until: o.until });
    }
    case 'chop': return chopJob(sim, p, 60, sim.idx[o.ref], base) || ((o.done = true), null);
    case 'gather': return gatherJob(sim, p, 60, o, base) || ((o.done = true), null);
    case 'quarry': return quarryJob(sim, p, 60, sim.idx[o.ref], base) || ((o.done = true), null);
    case 'fish': return fishJob(sim, p, 60, o, base);
    case 'water': return J('water', 60, ...riverSpot(sim, o), { ...base });
    case 'hunt': {
      const h = sim.idx[o.ref];
      if (!h || h.n <= 0) { o.done = true; return null; }
      return J('hunt', 60, h.x, h.y, { ...base, ref: h.id, big: o.big, until: o.until });
    }
    case 'fight': {
      const b = sim.idx[o.ref];
      if (!b || b.dead || b.gone) { o.done = true; return null; }
      return J('fight', 60, b.x, b.y, { ...base, ref: b.id, until: o.until });
    }
    case 'train': { const s = campSpot(sim, p, 60, 100); return J('train', 60, s.x, s.y, { ...base, until: o.until }); }
    case 'scout': return J('scout', 60, o.route[0].x, o.route[0].y, { ...base, route: o.route, i: 0 });
    case 'road': return roadJob(sim, p, o, base);
    case 'migrate': { const k = p.n, a = k * 2.399; return J('migrate', 66, o.x + Math.cos(a) * 40, o.y + Math.sin(a) * 28, { ...base }); }
    case 'build': {
      const s = sim.idx[o.ref];
      if (!s || s.built) { o.done = true; return null; }
      return J('build', 60, s.x, s.y, { ...base, ref: s.id });
    }
    case 'sowField': {
      const f = sim.idx[o.ref];
      if (!f || (f.state !== 'sowing' && f.state !== 'fallow')) { o.done = true; return null; }
      return J('sowField', 60, f.cx, f.cy, { ...base, ref: f.id });
    }
    case 'harvestField': {
      const f = sim.idx[o.ref];
      if (!f || f.state !== 'ripe' || f.harvested) { o.done = true; return null; }
      return J('harvestField', 60, f.cx, f.cy, { ...base, ref: f.id });
    }
  }
  return null;
}

function riverSpot(sim, o) {
  const q = nearestRiverPoint(sim.map, o), a = Math.atan2(sim.camp.y - q.y, sim.camp.x - q.x);
  return [q.x + Math.cos(a) * (RIVER_HALF + 6), q.y + Math.sin(a) * (RIVER_HALF + 6)];
}

// ---------------- 自己挑活 ----------------
function reachOf(sim) {
  return Math.min(1500, daylightLeft(sim.t) * 60 * K.walk * 0.4);
}
function chopJob(sim, p, prio, forest, extra = {}) {
  const reach = forest ? 99999 : reachOf(sim);
  let best = null, bd = Infinity;
  for (const f of forest ? [forest] : sim.map.forests) {
    if (!known(sim, f.x, f.y) || banned(sim, f.id)) continue;
    if (dist(f, p) - f.r > reach) continue;
    for (const t of f.trees) {
      if (!t.alive || t.wood <= 0) continue;
      const d = dist(t, p) + claims(sim, t.id) * 60;
      if (d < bd) { bd = d; best = t; }
    }
  }
  return best ? J('chop', prio, best.x + 8, best.y + 10, { ref: best.id, ...extra }) : null;
}
function gatherJob(sim, p, prio, o, extra = {}) {
  const reach = o ? 99999 : p.age < 14 ? 380 : reachOf(sim), autumn = sim.now.season === 2;
  // 秋天林子里捡坚果
  if (autumn && (!o || o.forest)) {
    let bf = null, bd = Infinity;
    for (const f of o?.forest ? [sim.idx[o.forest]] : sim.map.forests) {
      if (!f || f.nuts < 1 || !known(sim, f.x, f.y) || banned(sim, f.id)) continue;
      const d = dist(f, p) + claims(sim, f.id) * 80;
      if (d < bd && dist(f, p) < reach) { bd = d; bf = f; }
    }
    if (bf) { const a = sim.rng.range(0, 6.28), rr = sim.rng.range(0, bf.r * 0.7); return J('nuts', prio, bf.x + Math.cos(a) * rr, bf.y + Math.sin(a) * rr, { ref: bf.id, ...extra }); }
  }
  let best = null, bd = Infinity;
  const cx = o ? o.x : p.x, cy = o ? o.y : p.y, lim = o ? o.r : reach;
  for (const b of sim.map.bushes) {
    if (b.food < 1.5 || !known(sim, b.x, b.y) || banned(sim, b.patch)) continue;
    const dc = Math.hypot(b.x - cx, b.y - cy);
    if (dc > lim) continue;
    const d = dist(b, p) + claims(sim, b.id) * 90 - b.food * 4;
    if (d < bd) { bd = d; best = b; }
  }
  return best ? J('gather', prio, best.x + 6, best.y + 6, { ref: best.id, ...extra }) : null;
}
function quarryJob(sim, p, prio, rock, extra = {}) {
  const reach = rock ? 99999 : reachOf(sim);
  let best = null, bd = Infinity;
  for (const r of rock ? [rock] : sim.map.rocks) {
    if (!r || r.stone < 1 || !known(sim, r.x, r.y) || banned(sim, r.id)) continue;
    const d = dist(r, p);
    if (d < bd && d < reach + r.r) { bd = d; best = r; }
  }
  if (!best) return null;
  const k = p.n, a = k * 1.7;
  return J('quarry', prio, best.x + Math.cos(a) * best.r * 0.9, best.y + Math.sin(a) * best.r * 0.6, { ref: best.id, ...extra });
}
function fishJob(sim, p, prio, o, extra = {}) {
  const at = o || dropPoint(sim, p);
  const q = nearestRiverPoint(sim.map, at), a = Math.atan2(p.y - q.y, p.x - q.x), k = p.n;
  const i = Math.max(0, Math.min(sim.map.river.length - 1, sim.map.river.indexOf(q) + ((k % 5) - 2) * 3));
  const r = sim.map.river[i];
  return J('fish', prio, r.x + Math.cos(a) * (RIVER_HALF + 4), r.y + Math.sin(a) * (RIVER_HALF + 4), { ...extra });
}
function huntJob(sim, p, prio) {
  const reach = reachOf(sim) * 0.8;
  let best = null, bd = Infinity;
  for (const h of sim.herds) {
    if (h.n <= 0 || !known(sim, h.x, h.y) || banned(sim, h.id)) continue;
    const d = dist(h, p);
    if (d < bd && d < reach) { bd = d; best = h; }
  }
  return best ? J('hunt', prio, best.x, best.y, { ref: best.id, until: sim.t + 7 * 60 }) : null;
}
function rootJob(sim, p, prio) {
  const reach = reachOf(sim);
  let best = null, bd = Infinity;
  for (const pt of sim.map.patches) {
    if (!(pt.roots >= 1) || !known(sim, pt.x, pt.y) || banned(sim, pt.id)) continue;
    const d = dist(pt, p) + claims(sim, pt.id) * 90;
    if (d < bd && dist(pt, p) < reach) { bd = d; best = pt; }
  }
  if (!best) return null;
  const a = (p.n * 1.9) % 6.28;
  return J('root', prio, best.x + Math.cos(a) * best.r * 0.6, best.y + Math.sin(a) * best.r * 0.5, { ref: best.id });
}
function grassJob(sim, p, prio) {
  for (let k = 0; k < 12; k++) {
    const a = sim.rng.range(0, 6.28), d = sim.rng.range(140, 300);
    const x = sim.camp.x + Math.cos(a) * d, y = sim.camp.y + Math.sin(a) * d;
    if (sim.map.riverDist(x, y) < RIVER_HALF + 20 || !known(sim, x, y)) continue;
    if (sim.map.forests.some(f => Math.hypot(f.x - x, f.y - y) < f.r)) continue;
    return J('grass', prio, x, y);
  }
  return null;
}
function exploreJob(sim, p, prio) {
  const reach = reachOf(sim);
  for (let k = 0; k < 24; k++) {
    const a = sim.rng.range(0, 6.28);
    for (let d = 200; d < reach; d += 50) {
      const x = sim.camp.x + Math.cos(a) * d, y = sim.camp.y + Math.sin(a) * d;
      if (x < 40 || y < 40 || x > sim.map.w - 40 || y > sim.map.h - 40) break;
      if (!known(sim, x, y)) return J('explore', prio, x + Math.cos(a) * 120, y + Math.sin(a) * 120);
    }
  }
  return null;
}
function buildJob(sim, p, prio) {
  let best = null, bd = Infinity;
  for (const s of sim.sites) {
    if (s.built || !siteCanProgress(sim, s)) continue;
    const d = dist(s, p) + s.queue * 400 + claims(sim, s.id) * 120;
    if (d < bd) { bd = d; best = s; }
  }
  return best ? J('build', prio, best.x, best.y, { ref: best.id }) : null;
}
function roadJob(sim, p, o, base) {
  const r = sim.idx[o.ref];
  const seg = r && r.segs.find(s => !s.built && !sim.alive.some(q => q !== p && q.job && q.job.seg === s));
  if (!seg) { if (r && r.segs.every(s => s.built)) o.done = true; return null; }
  return J('road', 60, seg.x, seg.y, { ...base, ref: r.id, seg });
}
export const missing = s => Object.fromEntries(Object.entries(s.need).map(([k, n]) => [k, Math.max(0, n - (s.have[k] || 0))]));
export function siteCanProgress(sim, s) {
  if (s.bless && s.blessed < s.bless - 0.01 && sim.ink - K.era.blessFloor * sim.inkMax < 1) return false; // 等神的墨
  const m = missing(s);
  for (const [k, n] of Object.entries(m)) if (n > 0 && (sim.stock[k] || 0) < 1) return false;
  return true;
}

function canalSegJob(sim, p, prio) {
  let best = null, bd = Infinity;
  for (const c of sim.canals || []) {
    if (c.built) continue;
    if (c.bless && c.blessed < c.bless - 0.01 && sim.ink - K.era.blessFloor * sim.inkMax < 1) { c.waiting = 'ink'; continue; }
    c.waiting = null;
    for (const seg of c.segs) {
      if (seg.built) continue;
      const busy = sim.alive.some(q => q !== p && q.job && q.job.seg === seg);
      if (busy) continue;
      const d = dist(seg, p) + (c.grandStage ? 0 : 120);
      if (d < bd) { bd = d; best = { c, seg }; }
    }
  }
  return best ? J('digCanal', prio, best.seg.x, best.seg.y, { ref: best.c.id, seg: best.seg }) : null;
}

function chooseWork(sim, p) {
  const P = sim.plan, season = sim.now.season, kid = p.age < 14, old = elder(p);
  if (daylightLeft(sim.t) < 1.2) return idleJob(sim, p, 12, 50);
  const sf = k => 0.6 + 0.8 * (p.skills[k] || 0);
  const opts = [];
  const add = (kind, score, make) => {
    if (score <= 0) return;
    const busy = P.count[kind] || 0;
    opts.push({ kind, score: score * (0.85 + sim.rng() * 0.3) / (1 + 0.7 * busy), make });
  };
  if (!kid) {
    const fj = fireJob(sim, p, 40);
    if (fj) add(fj.kind, 90, () => fj);
    if (P.buildable) add('build', 46 * sf('build'), () => buildJob(sim, p, 32));
    if (sim.stock.wood < P.woodTarget * 2.5) add('chop', (4 + 50 * P.woodUrg) * sf('chop'), () => chopJob(sim, p, 30));
    if (P.stoneNeed > 0) add('quarry', (12 + 40 * clamp(P.stoneNeed / 10)) * sf('quarry'), () => quarryJob(sim, p, 30));
    if (P.grassNeed > 0 && season !== 3) add('grass', (12 + 40 * clamp(P.grassNeed / 8)) * sf('gather'), () => grassJob(sim, p, 30));
    if (!old) add('hunt', (3 + 34 * P.foodUrg + (P.rackFree > 6 && P.foodDays < 25 ? 20 : 0)) * sf('hunt') ** 1.5 * (p.temper === '怯' ? 0.5 : p.temper === '勇' ? 1.3 : 1), () => huntJob(sim, p, 30));
    if (P.hides >= 2 && P.naked > 0 && !P.count.sew && p.knows.hide) add('sew', season >= 2 ? 48 : 26, () => { const s = campSpot(sim, p); return J('sew', 30, s.x, s.y); });
    // 第二代：农田、水渠与织布（仅当进入第二代或有农田/水渠时激活，不扰动第一代 RNG）
    if (sim.era2?.active || sim.fields?.length || sim.canals?.length) {
      const ripeF = sim.fields.find(f => f.state === 'ripe' && !f.harvested && claims(sim, f.id) < 3);
      if (ripeF) add('harvestField', 78 * sf('gather'), () => J('harvestField', 34, ripeF.cx, ripeF.cy, { ref: ripeF.id }));
      const sowF = sim.fields.find(f => (f.state === 'sowing' || (f.state === 'fallow' && (f.blessed || sowSeasonOk(sim)))) && claims(sim, f.id) < 2);
      if (sowF) add('sowField', 64 * sf('gather'), () => J('sowField', 32, sowF.cx, sowF.cy, { ref: sowF.id }));
      const clearF = sim.fields.find(f => f.state === 'clearing' && claims(sim, f.id) < 2);
      if (clearF) add('clearField', 56 * sf('build'), () => J('clearField', 32, clearF.cx, clearF.cy, { ref: clearF.id }));
      if (sim.canals?.some(c => !c.built)) add('digCanal', 52 * sf('build'), () => canalSegJob(sim, p, 32));
      if (tribeKnows(sim, 'weave') && sim.stock.grass >= 3 && P.naked > 0 && !P.count.weaveCloth) add('weaveCloth', season >= 2 ? 44 : 24, () => { const s = campSpot(sim, p); return J('weaveCloth', 30, s.x, s.y); });
    }
    // 研究：轮到的那个人去琢磨
    if (sim.research.id && sim.research.by === p.id) add('study', 58 * (p.genius ? 1.2 : 1), () => studyJob(sim, p));
    // 壁画：会画的把族里会的手艺画上石壁
    if (p.knows.mural && !P.count.paint && unpainted(sim).length) add('paint', p.genius === 'art' ? 44 : 24, () => { const m = muralSpot(sim); return J('paint', 30, m.x + ((p.n % 3) - 1) * 10, m.y + 10); });
    // 草药师：有人病了、伤了
    if (sim.roles.herb === p.id) { const q = patient(sim, p); if (q) add('heal', 80, () => J('heal', 34, q.x, q.y, { ref: q.id })); }
    // 陷阱里有东西、或者要重新支起来
    const tr = sim.buildings.find(b => b.type === 'trap' && (b.meat >= 2 || b.sprung) && !claims(sim, b.id));
    if (tr) add('trapcheck', 26 + (tr.meat || 0) * 4, () => J('trapcheck', 30, tr.x + 8, tr.y + 6, { ref: tr.id }));
    if (!old && !P.count.explore && !P.count.scout) add('explore', (2 + (sim.day < 2 ? 10 : 0) + (P.scarce ? 14 : 0)) * (p.temper === '怯' ? 0.3 : 1), () => exploreJob(sim, p, 30));
  }
  if (season !== 3 || P.nutsKnown) add('gather', (season === 3 ? 0 : 4 + 50 * P.foodUrg) * sf('gather') + (season === 2 && P.nutsKnown ? 12 : 0), () => gatherJob(sim, p, 30));
  // 冬天会辨识野食的去挖块根
  if (season === 3 && p.knows.forage && p.age >= 8) add('root', (6 + 40 * P.foodUrg) * sf('gather'), () => rootJob(sim, p, 30));
  if (!sim.flood) add('fish', (3 + 40 * P.foodUrg) * sf('fish') * (season === 3 ? (p.knows.harpoon ? 0.9 : 0.5) : 1) * (p.knows.harpoon ? 1.3 : 1) * (kid ? 0.6 : 1), () => fishJob(sim, p, 30));
  add('idle', p.temper === '懒' ? 24 : p.temper === '勤' ? 6 : 12, () => idleJob(sim, p, 10, 45));
  opts.sort((a, b) => b.score - a.score);
  for (const o of opts) { const j = o.make(); if (j) return j; }
  return null;
}

// ---------------- 干：每一步的活计 ----------------
function back(sim, p, j, dt) {
  if (!j.to) { const d = dropPoint(sim, p); const s = d === sim.camp ? campSpot(sim, p) : d; j.to = { x: s.x, y: s.y }; }
  if (moveTo(sim, p, j.to.x, j.to.y, dt)) { deposit(sim, p); return DONE; }
}
function workStop(sim, p, j) {
  return sim.now.dark || (j.until && sim.t > j.until);
}

const H = {
  eat(sim, p, j, dt) {
    if (!arrived(sim, p, j, dt)) return;
    if ((j.w += dt) < 12) return;
    j.w = 0;
    const f = takeFood(sim, sim.anyLitCamp);
    if (!f) return DONE;
    p.hunger = Math.max(0, p.hunger - f.val);
    if (p.hunger < 0.12) return DONE;
  },
  drink(sim, p, j, dt) {
    if (!arrived(sim, p, j, dt)) return;
    if (j.src === 'stock') { if (sim.stock.water < 1) return DONE; sim.stock.water -= 1; }
    p.thirst = 0;
    return DONE;
  },
  warm(sim, p, j, dt) {
    const f = sim.idx[j.ref];
    if (!f || !f.lit) return DONE;
    if (!arrived(sim, p, j, dt)) return;
    if (p.cold < 0.08 || (j.w += dt) > 240) return DONE;
  },
  sleep(sim, p, j, dt) {
    if (!p.asleep) {
      if (!arrived(sim, p, j, dt)) return;
      p.asleep = true; p.inside = j.shack;
    }
    if (j.nap ? p.fatigue < 0.3 : (!sim.now.bed && p.fatigue < 0.15)) { p.asleep = false; p.inside = null; return DONE; }
  },
  rest(sim, p, j, dt) {
    if (!arrived(sim, p, j, dt)) return;
    if (sim.t > j.until) return DONE;
  },
  idle(sim, p, j, dt) { if (arrived(sim, p, j, dt) && sim.t > j.until) return DONE; },
  play(sim, p, j, dt) { if (arrived(sim, p, j, dt) && sim.t > j.until) return DONE; },
  flee(sim, p, j, dt) {
    if (!moveTo(sim, p, j.x, j.y, dt, true)) return;
    if (!j.until) j.until = sim.t + 30;
    if (sim.t > j.until) return DONE;
  },
  gather(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      const b = sim.idx[j.ref];
      if (workStop(sim, p, j) || !b || b.food < 0.5) {
        const o = j.order && sim.orders.find(x => x.id === j.order);
        const nb = !workStop(sim, p, j) && carryN(p) < carryCap(p) && gatherJob(sim, p, j.prio, o && { ...o, r: o.r }, {});
        if (nb && nb.kind === 'gather' && dist(nb, p) < 160) { j.ref = nb.ref; j.x = nb.x; j.y = nb.y; j.phase = 'go'; return; }
        j.phase = 'back'; return;
      }
      const amt = Math.min(b.food, K.rate.gather * factor(sim, p, 'gather') * dt / 60);
      b.food -= amt; addCarry(p, 'berry', amt);
      skillUp(p, 'gather', 0.0004 * dt);
      if (carryN(p) >= carryCap(p)) j.phase = 'back';
      return;
    }
    return back(sim, p, j, dt);
  },
  nuts(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      const f = sim.idx[j.ref];
      if (workStop(sim, p, j) || !f || f.nuts < 0.5) { j.phase = 'back'; return; }
      const amt = Math.min(f.nuts, K.rate.gather * 0.8 * factor(sim, p, 'gather') * dt / 60);
      f.nuts -= amt; addCarry(p, 'nut', amt);
      if (carryN(p) >= carryCap(p)) j.phase = 'back';
      return;
    }
    return back(sim, p, j, dt);
  },
  chop(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      const t = sim.idx[j.ref];
      if (workStop(sim, p, j) || !t || !t.alive) {
        if (!workStop(sim, p, j) && carryN(p) < carryCap(p) && t) {
          const nj = chopJob(sim, p, j.prio, sim.idx[t.forest]);
          if (nj && dist(nj, p) < 140) { j.ref = nj.ref; j.x = nj.x; j.y = nj.y; j.phase = 'go'; return; }
        }
        j.phase = 'back'; return;
      }
      const amt = Math.min(t.wood, K.rate.chop * factor(sim, p, 'chop') * dt / 60);
      t.wood -= amt; addCarry(p, 'wood', amt);
      skillUp(p, 'chop', 0.0004 * dt);
      if (t.wood <= 0.01) { t.alive = false; t.wood = 0; t.regrow = sim.t + 28 * DAY; sim.dirty.trees = true; sim.stats.trees++; }
      if (carryN(p) >= carryCap(p)) j.phase = 'back';
      return;
    }
    return back(sim, p, j, dt);
  },
  quarry(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      const r = sim.idx[j.ref];
      if (workStop(sim, p, j) || !r || r.stone < 0.5) { j.phase = 'back'; return; }
      const amt = Math.min(r.stone, K.rate.quarry * factor(sim, p, 'quarry') * dt / 60);
      r.stone -= amt; addCarry(p, 'stone', amt);
      skillUp(p, 'quarry', 0.0004 * dt);
      if (carryN(p) >= carryCap(p, 5)) j.phase = 'back';
      return;
    }
    return back(sim, p, j, dt);
  },
  grass(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      if (workStop(sim, p, j) || sim.now.season === 3) { j.phase = 'back'; return; }
      addCarry(p, 'grass', K.rate.grass * factor(sim, p, 'gather') * dt / 60);
      if (carryN(p) >= carryCap(p, 8)) j.phase = 'back';
      return;
    }
    return back(sim, p, j, dt);
  },
  fish(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      if (workStop(sim, p, j) || (j.w += dt) > 300) { j.phase = 'back'; return; }
      const season = sim.now.season;
      const rate = K.rate.fish[season] * (sim.weather.drought ? 0.7 : 1) * (p.knows.harpoon ? (season === 3 ? 2.4 : 1.6) : 1) * (sim.harsh?.now ? 0.5 : 1);
      addCarry(p, 'fish', rate * factor(sim, p, 'fish') * dt / 60);
      skillUp(p, 'fish', 0.0004 * dt);
      if (carryN(p) >= carryCap(p)) j.phase = 'back';
      return;
    }
    return back(sim, p, j, dt);
  },
  water(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') { if ((j.w += dt) >= 15) { p.carry = { kind: 'water', n: 12 }; j.phase = 'back'; } return; }
    return back(sim, p, j, dt);
  },
  hunt(sim, p, j, dt) {
    const h = sim.idx[j.ref];
    if (j.phase !== 'back') {
      if (!h || h.n <= 0 || workStop(sim, p, j)) { j.phase = 'back'; return; }
      j.x = h.x; j.y = h.y;
      if (dist(p, h) > 70) { moveTo(sim, p, h.x, h.y, dt); return; }
      j.phase = 'work';
      if ((j.w += dt) < 30) return;
      j.w = 0;
      let mates = 0;
      for (const q of sim.alive) if (q !== p && q.job && q.job.kind === 'hunt' && q.job.ref === h.id && dist(q, h) < 150) mates++;
      let pk = 0.04 + 0.2 * p.skills.hunt + 0.05 * Math.min(5, mates) + (p.temper === '勇' ? 0.04 : 0) + (lightOn(sim) ? 0.04 : 0) - (sim.now.season === 3 ? 0.04 : 0) + (j.big ? 0.06 : 0)
        + (p.knows.knap ? 0.03 : 0) + (p.knows.drive ? 0.04 : 0) + (sim.known.dog ? 0.05 : 0) + (sim.roles.hunter === p.id ? 0.03 : 0);
      pk = clamp(pk, 0.03, 0.62);
      if (sim.rng() < pk) {
        h.n -= 1;
        p.carry = { kind: 'meat', n: sim.now.season === 3 ? 5 : K.deer.meat, hide: 1 };
        sim.stats.deer++;
        skillUp(p, 'hunt', 0.03);
        if (j.order) log(sim, `${p.name}猎到一头鹿`, 'work', { who: p.id });
        j.phase = 'back';
      } else {
        skillUp(p, 'hunt', 0.008);
        h.flee = sim.t + 30;
        const a = Math.atan2(h.y - p.y, h.x - p.x) + sim.rng.range(-0.8, 0.8), d = sim.rng.range(140, 240);
        h.fx = h.x + Math.cos(a) * d; h.fy = h.y + Math.sin(a) * d;
        if (sim.rng() < 0.012) injure(sim, p, 0.3, '打猎时被鹿角挑伤了', '鹿');
      }
      return;
    }
    return back(sim, p, j, dt);
  },
  fight(sim, p, j, dt) {
    const b = sim.idx[j.ref];
    if (!b || b.dead || b.gone || sim.t > j.until || (sim.now.dark && dist(b, sim.camp) > sim.camp.r * 2)) { j.phase = 'back'; return back(sim, p, j, dt); }
    j.x = b.x; j.y = b.y;
    if (dist(p, b) > 45) moveTo(sim, p, b.x, b.y, dt, true);
  },
  build(sim, p, j, dt) {
    const s = sim.idx[j.ref];
    if (!s || s.built) { if (p.carry && s) deposit(sim, p); return DONE; }
    if (j.phase === 'go') {
      const m = missing(s);
      if (p.carry && m[p.carry.kind] > 0) {
        if (!moveTo(sim, p, s.x, s.y, dt)) return;
        const n = Math.min(p.carry.n, m[p.carry.kind]);
        s.have[p.carry.kind] = (s.have[p.carry.kind] || 0) + n;
        p.carry.n -= n;
        if (p.carry.n <= 0.01) p.carry = null;
        return;
      }
      if (p.carry) { if (moveTo(sim, p, sim.camp.x, sim.camp.y, dt)) deposit(sim, p); return; }
      const lack = Object.entries(m).filter(([, n]) => n > 0.01);
      if (lack.length) {
        const fromCamp = dist(s, sim.camp) > 40;
        if (fromCamp && !moveTo(sim, p, sim.camp.x + 20, sim.camp.y + 12, dt)) return;
        const pick = lack.find(([k]) => (sim.stock[k] || 0) >= 1);
        if (!pick) { s.waiting = lack[0][0]; return DONE; }
        const [k, n] = pick, take = Math.min(n, Math.floor(sim.stock[k]), k === 'grass' ? 10 : 6);
        sim.stock[k] -= take;
        if (fromCamp) p.carry = { kind: k, n: take };
        else s.have[k] = (s.have[k] || 0) + take;
        return;
      }
      s.waiting = null;
      if (!moveTo(sim, p, s.x, s.y, dt)) return;
      j.phase = 'work';
    }
    if (sim.now.dark) return DONE;
    let dp = factor(sim, p, 'build') * K.rate.build * dt / 60;
    if (s.bless) { // 祭坛边修边开光：神的墨跟着进度流进去，留四成应急；墨不够就先停工
      const want = dp / s.work * s.bless, pay = Math.min(want, Math.max(0, sim.ink - K.era.blessFloor * sim.inkMax));
      sim.ink -= pay; sim.stats.inkSpent += pay; s.blessed += pay;
      if (pay < want * 0.999) { s.progress += want > 0 ? dp * pay / want : 0; s.waiting = 'ink'; return DONE; }
    }
    s.progress += dp;
    skillUp(p, 'build', 0.0004 * dt);
    if (s.progress >= s.work) { sim.completeSite(s, p); return DONE; }
  },
  tend(sim, p, j, dt) {
    const f = sim.idx[j.ref];
    if (!f) return DONE;
    if (!arrived(sim, p, j, dt)) return;
    if ((j.w += dt) < 8) return;
    const need = Math.ceil((K.fire.maxFuel - f.fuel) / K.fire.perWood);
    const n = Math.min(need, Math.floor(sim.stock.wood));
    if (n > 0 && f.lit) { sim.stock.wood -= n; f.fuel += n * K.fire.perWood; sim.stats.woodBurnt += n; }
    return DONE;
  },
  kindle(sim, p, j, dt) {
    const f = sim.idx[j.ref];
    if (!f || f.lit) return DONE;
    if (!arrived(sim, p, j, dt)) return;
    if ((j.w += dt) < 30) return;
    if (sim.stock.wood < 1) return DONE;
    const pk = (0.1 + 0.8 * p.skills.fire + (p.knows.keepfire ? 0.25 : 0)) * (sim.weather.wet ? (p.knows.keepfire ? 0.6 : 0.35) : 1);
    skillUp(p, 'fire', 0.03);
    if (sim.rng() < pk) {
      sim.stock.wood -= 1; f.lit = true; f.fuel = Math.max(f.fuel, 0) + K.fire.perWood; f.outSince = 0;
      log(sim, `${p.name}钻木取火，${f.name}又点着了`, 'work', { who: p.id });
    }
    return DONE;
  },
  sew(sim, p, j, dt) {
    if (!arrived(sim, p, j, dt)) return;
    const needle = !!p.knows.needle;
    if ((j.w += dt) < (needle ? 120 : 180)) return;
    if (sim.stock.hide >= 2) {
      const top = needle ? 2 : 1;
      const who = sim.alive.filter(q => (q.clothes || 0) < top && !q.lost).sort((a, b) => (a.clothes || 0) - (b.clothes || 0) || (b.age < 14 || b.age >= 50 ? 1 : 0) - (a.age < 14 || a.age >= 50 ? 1 : 0) || b.cold - a.cold)[0];
      if (who) { sim.stock.hide -= 2; const up = who.clothes >= 1; who.clothes = top; sim.stats.coats++; log(sim, `${p.name}给${who === p ? '自己' : who.name}${up ? '用骨针重缝了件厚皮衣' : needle ? '用骨针缝了件厚皮衣' : '缝了件皮衣'}`, 'work', { who: p.id }); }
    }
    return DONE;
  },
  explore(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt) || daylightLeft(sim.t) < 2.5) j.phase = 'back'; return; }
    return back(sim, p, j, dt);
  },
  scout(sim, p, j, dt) {
    if (j.phase === 'go') {
      const q = j.route[j.i];
      if (moveTo(sim, p, q.x, q.y, dt)) { j.i += 3; if (j.i >= j.route.length) { j.phase = 'back'; } }
      return;
    }
    return back(sim, p, j, dt);
  },
  road(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (workStop(sim, p, j)) return DONE;
    j.seg.work += factor(sim, p, 'build') * dt / 60;
    if (j.seg.work >= j.seg.need) { j.seg.built = true; sim.roadBuilt(j.seg); return DONE; }
  },
  rally(sim, p, j, dt) { arrived(sim, p, j, dt); if (sim.t > j.until) return DONE; },
  train(sim, p, j, dt) {
    if (!arrived(sim, p, j, dt)) return;
    skillUp(p, 'hunt', 0.025 * dt / 60);
    if (sim.t > j.until || sim.now.dark) return DONE;
  },
  migrate(sim, p, j, dt) { if (arrived(sim, p, j, dt)) return DONE; },
  march(sim, p, j, dt) {
    const M = sim.march;
    if (!M || sim.now.bed) return DONE;
    if (j.i > M.minI + 3) return;               // 走在前头的，等等后面的
    const q = M.route[Math.min(j.i, M.route.length - 1)];
    if (sim.flood && inFlood(sim, q.x, q.y)) { M.blocked = sim.t; return; } // 前面是水：停在水边等
    if (moveTo(sim, p, q.x + ((p.n % 5) - 2) * 7, q.y + ((p.n % 3) - 1) * 7, dt) && j.i < M.route.length - 1) j.i++;
  },
  study(sim, p, j, dt) {
    const R = sim.research;
    if (!R.id || R.by !== p.id || R.id !== j.tech) return DONE;
    if (!arrived(sim, p, j, dt)) return;
    if (workStop(sim, p, j) || (j.w += dt) > 7 * 60) return DONE;
    const t = TECHS[R.id];
    if (t.skill) skillUp(p, t.skill, 0.0002 * dt);
    if (addProgress(sim, p, R.id, K.tech.rate * factor(sim, p, t.skill) * studyMul(sim, p, R.id) * dt / 60)) return DONE;
  },
  paint(sim, p, j, dt) {
    if (!arrived(sim, p, j, dt)) return;
    if (workStop(sim, p, j) || !unpainted(sim).length) return DONE;
    j.w += factor(sim, p, null) * (p.genius === 'art' ? 1.6 : 1) * dt / 60;
    if (j.w >= 3) { paintOne(sim, p); return DONE; }
  },
  heal(sim, p, j, dt) {
    const q = sim.idx[j.ref];
    if (!q || !q.alive || q.lost) return DONE;
    j.x = q.x; j.y = q.y;
    if (dist(p, q) > 16) { moveTo(sim, p, q.x, q.y, dt); return; }
    if ((j.w += dt) < 30) return;
    q.treated = sim.t;
    if (q.sick > 0) { q.sick = Math.max(0, q.sick - 1.5); q.sev *= 0.7; }
    q.health = Math.min(1, q.health + 0.12);
    skillUp(p, 'gather', 0.01);
    sim.stats.healed = (sim.stats.healed || 0) + 1;
    if (!q.treatLog || sim.t - q.treatLog > 3 * DAY) { q.treatLog = sim.t; log(sim, `${p.name}给${q === p ? '自己' : q.name}敷了草药`, 'work', { who: p.id }); }
    return DONE;
  },
  trapcheck(sim, p, j, dt) {
    const b = sim.idx[j.ref];
    if (j.phase === 'go') { if (!b) return DONE; if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      if ((j.w += dt) < 20) return;
      if (b) { if (b.meat >= 1) { p.carry = { kind: 'meat', n: b.meat, hide: b.hides || 0 }; b.meat = 0; b.hides = 0; } b.sprung = false; }
      j.phase = 'back'; return;
    }
    return back(sim, p, j, dt);
  },
  root(sim, p, j, dt) {
    if (j.phase === 'go') { if (arrived(sim, p, j, dt)) j.phase = 'work'; return; }
    if (j.phase === 'work') {
      const pt = sim.idx[j.ref];
      if (workStop(sim, p, j) || !pt || !(pt.roots >= 0.5)) { j.phase = 'back'; return; }
      const amt = Math.min(pt.roots, 1.3 * factor(sim, p, 'gather') * dt / 60);
      pt.roots -= amt; addCarry(p, 'root', amt);
      if (carryN(p) >= carryCap(p, 5)) j.phase = 'back';
      return;
    }
    return back(sim, p, j, dt);
  },
  dance(sim, p, j, dt) {
    if (!(sim.danceUntil > sim.t) || sim.now.bed) return DONE;
    j.a += dt * 0.02;
    moveTo(sim, p, j.c.x + Math.cos(j.a) * j.rr, j.c.y + Math.sin(j.a) * j.rr * 0.6 + 16, dt);
  },
  lost(sim, p, j, dt) {
    if (!p.lost) return DONE;
    if (j.sleep) { p.asleep = true; if (!sim.now.bed && !(sim.now.dark && p.fatigue > 0.3)) { p.asleep = false; return DONE; } return; }
    if (!arrived(sim, p, j, dt)) return;
    if (j.drink) p.thirst = 0;
    if (j.eat) { const b = sim.idx[j.eat]; if (b && b.food >= 1) { b.food -= 1; p.hunger = Math.max(0, p.hunger - 0.34); if (p.hunger > 0.2) return; } }
    return DONE;
  },
  clearField(sim, p, j, dt) {
    const f = sim.idx[j.ref];
    if (!f || f.state !== 'clearing') return DONE;
    if (!arrived(sim, p, j, dt)) return;
    if (sim.now.dark) return DONE;
    f.clearDone += factor(sim, p, 'build') * (p.knows?.plow ? 1.35 : 1) * dt / 60;
    skillUp(p, 'build', 0.0003 * dt);
    if (f.clearDone >= f.clearWork) {
      f.clearDone = f.clearWork;
      f.state = 'fallow';
      sim.dirty.fields = true;
      log(sim, `${p.name}他们把${f.name}开垦平了，${sowSeasonOk(sim) ? '正可以播种' : '等开春或用「不季之穗」播种'}`, 'work', { who: p.id, field: f.id });
      return DONE;
    }
  },
  sowField(sim, p, j, dt) {
    const f = sim.idx[j.ref];
    if (!f || (f.state !== 'sowing' && f.state !== 'fallow')) return DONE;
    if (f.state === 'fallow') {
      if (!f.blessed && !sowSeasonOk(sim)) return DONE;
      f.state = 'sowing'; f.sowDone = 0; f.harvested = false;
    }
    if (!arrived(sim, p, j, dt)) return;
    if (sim.now.dark) return DONE;
    f.sowDone += factor(sim, p, 'gather') * (p.knows?.sow ? 1.25 : 1) * dt / 60;
    skillUp(p, 'gather', 0.0003 * dt);
    if (f.sowDone >= f.sowWork) {
      f.sowDone = f.sowWork;
      f.state = 'growing';
      f.growth = 0.02;
      f.harvested = false;
      sim.dirty.fields = true;
      log(sim, `${p.name}把${f.name}播好了种，只等抽穗成熟`, 'work', { who: p.id, field: f.id });
      return DONE;
    }
  },
  harvestField(sim, p, j, dt) {
    const f = sim.idx[j.ref];
    if (!f || f.state !== 'ripe' || f.harvested) return DONE;
    if (!arrived(sim, p, j, dt)) return;
    if (sim.now.dark) return DONE;
    f.harvestDone += factor(sim, p, 'gather') * 1.45 * dt / 60;
    skillUp(p, 'gather', 0.0004 * dt);
    if (f.harvestDone >= f.harvestWork) {
      harvestField(sim, f, p);
      return DONE;
    }
  },
  digCanal(sim, p, j, dt) {
    const c = sim.idx[j.ref], seg = j.seg;
    if (!c || !seg || seg.built) return DONE;
    if (!arrived(sim, p, j, dt)) return;
    if (sim.now.dark) return DONE;
    let dp = factor(sim, p, 'build') * (p.knows?.irrigate ? 1.4 : 1) * dt / 60;
    if (c.bless && c.blessed < c.bless - 0.01) {
      const totalNeed = c.segs.reduce((s, g) => s + g.need, 0) || 1;
      const want = dp / totalNeed * c.bless;
      const pay = Math.min(want, Math.max(0, sim.ink - K.era.blessFloor * sim.inkMax));
      sim.ink -= pay; sim.stats.inkSpent += pay; c.blessed += pay;
      if (pay < want * 0.999) { seg.work += want > 0 ? dp * pay / want : 0; c.waiting = 'ink'; return DONE; }
    }
    c.waiting = null;
    seg.work += dp;
    skillUp(p, 'build', 0.0004 * dt);
    if (seg.work >= seg.need) {
      onCanalSegBuilt(sim, c, seg, p);
      return DONE;
    }
  },
  weaveCloth(sim, p, j, dt) {
    if (!arrived(sim, p, j, dt)) return;
    if ((j.w += dt) < 120) return;
    if (sim.stock.grass >= 3) {
      const who = sim.alive.filter(q => (q.clothes || 0) < 1 && !q.lost).sort((a, b) => (a.clothes || 0) - (b.clothes || 0) || b.cold - a.cold)[0];
      if (who) {
        sim.stock.grass -= 3;
        who.clothes = 1;
        sim.stats.coats++;
        log(sim, `${p.name}用麻草织了件粗布衣给${who === p ? '自己' : who.name}穿上`, 'work', { who: p.id });
      }
    }
    return DONE;
  },
};

// 每一步：一个人
export function personTick(sim, p, dt) {
  needsTick(sim, p, dt);
  if (!p.alive) return;
  if (sim.march && p.age < 5 && sim.march.members.includes(p.id)) { if (sim.now.bed && !p.asleep) setJob(sim, p, think(sim, p)); else if (!sim.now.bed) { p.asleep = false; return; } }
  const look = !p.job || (sim.steps + p.n) % 5 === 0 || (sim.stalking && p.job.kind !== 'flee' && !p.asleep);
  if (!p.job || (look && urgency(sim, p) > p.job.prio + 3)) setJob(sim, p, think(sim, p));
  const j = p.job;
  if (!j) return;
  const r = H[j.kind](sim, p, j, dt);
  if (p.carry && j.kind !== 'build' && inCamp(sim, p) && dist(p, sim.camp) < sim.camp.r * 0.7) deposit(sim, p);
  if (r === DONE) setJob(sim, p, null);
}
