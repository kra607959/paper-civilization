// 外族：河那边邻近的一个游群。火灭了会夜里来偷火种，饿了会来偷吃的；
// 你可以送火、结亲、驱赶、显灵。关系好到一定程度、又结过亲，他们会过河来并成一族（聚成一族）。
import { K, DAY, TECHS, GENIUS } from './config.js';
import { dist, clamp, log, reveal, known, foodTotal, mainFire } from './util.js';
import { yearOf } from './calendar.js';
import { makePerson, setJob, TEMPERS } from './people.js';
import { learn, tribeKnows, refreshKnown } from './tech.js';
import { startPlague } from './events.js';

const NAMES = { m: ['獾子', '老獾', '阿鹭', '苇生', '石鹭', '阿蒲', '小獾', '鹭生'], f: ['小芦', '青苇', '鹭儿', '阿菱', '小茭', '阿荻', '小苇', '阿蘅'] };
const BAND_TECHS = ['harpoon', 'dog', 'herb', 'raft', 'hide'];

export function initBand(sim) {
  const at = sim.map.band, r = sim.rng;
  const members = [];
  const used = new Set();
  const n = K.band.pop;
  for (let i = 0; i < n; i++) {
    const sex = i % 2 ? 'f' : 'm', pool = NAMES[sex].filter(x => !used.has(x));
    const name = pool[r.int(pool.length)]; used.add(name);
    members.push({ name, sex, age: i < 2 ? r.range(36, 50) : i < n - 2 ? r.range(16, 32) : r.range(3, 10) });
  }
  const techs = [BAND_TECHS[r.int(BAND_TECHS.length)]];
  let genius = null;
  if (r() < 0.6) { const cand = members.filter(m => m.age >= 16 && m.age <= 30); const g = cand[r.int(cand.length)]; if (g) { g.genius = r.pick(Object.keys(GENIUS)); genius = g.name; } }
  sim.band = { name: '苇族', x: at.x, y: at.y, members, techs, genius, mood: 0, met: false, fire: true, fireOut: 0, hungry: 0, marriages: 0, gifts: 0, raids: 0, cowed: 0, merged: false, gone: false, faith: 0, asked: 0 };
  sim.strangers = [];
}
const adultsOf = B => B.members.filter(m => m.age >= 14);
export const bandMood = B => (B.mood >= 0.6 ? '亲近' : B.mood >= 0.2 ? '和气' : B.mood > -0.2 ? '提防' : B.mood > -0.5 ? '敌视' : '仇恨');

// ---------------- 每天 ----------------
export function dailyBand(sim) {
  const B = sim.band;
  if (!B || B.merged || B.gone) return;
  const s = sim.now.season, winter = s === 3;
  // 初见：过了头一周，他们隔河望见我们；或是我们先探到他们的营地
  if (!B.met && ((sim.day >= K.band.meetDay && sim.rng() < 0.3) || known(sim, B.x, B.y))) meet(sim);
  if (!B.met) return;
  for (const m of B.members) m.age += 1 / 28;
  B.mood += (0 - B.mood) * 0.01;
  // 他们的火
  if (B.fire) {
    if (sim.rng() < K.band.fireOut * (winter ? 2 : 1) * (sim.weather.wet ? 1.6 : 1)) { B.fire = false; B.fireOut = sim.t; }
  } else if (sim.t - B.fireOut > 4 * DAY && sim.rng() < 0.35) B.fire = true;   // 好歹自己钻木钻着了
  // 冬天、火灭了：会冻死人
  B.hungry = winter ? Math.min(1, B.hungry + 0.12) : Math.max(0, B.hungry - 0.1);
  if (winter && !B.fire && sim.t - B.fireOut > DAY && sim.rng() < 0.12) bandLoses(sim, '冻死');
  else if (B.hungry > 0.8 && sim.rng() < 0.05) bandLoses(sim, '饿死');
  if (s === 0 && sim.rng() < 0.04 && adultsOf(B).length >= 4) { const sex = sim.rng.chance(0.5) ? 'm' : 'f', pool = NAMES[sex].filter(x => !B.members.some(m => m.name === x) && !sim.people.some(p => p.name === x)); if (pool.length) B.members.push({ name: pool[0], sex, age: 0 }); }
  // 要火、偷火、偷吃的
  const out = sim.t - B.fireOut;
  if (!B.fire && out > DAY * 0.5 && !sim.strangers.length) {
    if (B.mood >= 0.2 && B.asked < sim.day - 2) send(sim, 'ask', 2);
    else if (sim.t > B.cowed && sim.rng() < K.band.raid) send(sim, 'fire', 2);
  } else if (B.hungry > 0.5 && B.mood < 0 && sim.t > B.cowed && !sim.strangers.length && sim.rng() < 0.25) send(sim, 'food', 2);
  else if (B.mood >= 0.45 && !sim.strangers.length && sim.rng() < 0.06) send(sim, 'gift', 1);
  // 走的人：天才心里不痛快，会跟外族走
  for (const p of sim.alive) {
    if (!p.genius || p.age < 16 || p.love >= 0.2 || p.lost || B.mood < -0.2) continue;
    if (sim.rng() < 0.03) { leaveForBand(sim, p); break; }
  }
  // 并成一族
  if (B.mood >= K.band.mergeMood && (B.marriages >= 1 || adultsOf(B).length <= 4) && yearOf(sim.t) >= 3 && sim.rng() < 0.08) merge(sim);
  if (!B.members.length) { B.gone = true; log(sim, `${B.name}一个人也不剩了`, 'death'); }
}
function meet(sim) {
  const B = sim.band;
  B.met = true;
  reveal(sim, B.x, B.y, 170);
  sim.dirty.fog = true;
  log(sim, `河那边来了几个陌生人，脸上抹着红泥，隔着河望了我们好一阵：他们叫自己${B.name}，${B.members.length} 口人，营地在${dirOf(sim, B)}边`, 'danger', { band: true });
}
const dirOf = (sim, p) => { const a = Math.atan2(p.y - sim.camp.y, p.x - sim.camp.x); return ['东', '东南', '南', '西南', '西', '西北', '北', '东北'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; };
function bandLoses(sim, how) {
  const B = sim.band, frail = B.members.filter(m => m.age < 6 || m.age >= 45);
  const pool = frail.length ? frail : B.members;
  if (!pool.length) return;
  const m = pool[sim.rng.int(pool.length)];
  B.members = B.members.filter(x => x !== m);
  if (B.genius === m.name) B.genius = null;
  log(sim, `听说${B.name}的${m.name}${how}了`, 'death');
}
function leaveForBand(sim, p) {
  const B = sim.band;
  B.members.push({ name: p.name, sex: p.sex, age: p.age, genius: p.genius, knows: { ...(p.knows || {}) }, fromUs: true });
  if (p.genius) B.genius = p.name;
  log(sim, `${p.name}心里不痛快，跟着${B.name}的人走了。${p.genius ? `一个${GENIUS[p.genius]}，就这么没了` : ''}`, 'danger', { who: p.id });
  sim.stats.defected = (sim.stats.defected || 0) + 1;
  sim.removePerson(p, '投奔外族');
}

// ---------------- 来人：偷火、偷吃的、要火、送礼 ----------------
function send(sim, task, n) {
  const B = sim.band;
  const pool = adultsOf(B).filter(m => m.age < 45);
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const m = pool[i];
    const night = task === 'fire' || task === 'food';
    sim.strangers.push({ id: `z${sim.nextId++}`, name: m.name, task, x: B.x + sim.rng.range(-20, 20), y: B.y + sim.rng.range(-20, 20), state: night ? 'wait' : 'go', loot: null, until: sim.t + 2 * DAY, i });
  }
  if (task === 'ask') { B.asked = sim.day; log(sim, `${B.name}的火灭了，派人过河来，比划着想要火种`, 'danger', { band: true }); }
  if (task === 'gift') log(sim, `${B.name}的人背着东西过河来了`, 'season', { band: true });
  for (const z of sim.strangers) sim.idx[z.id] = z;
}
const speedOf = (sim, z, run) => (run ? 7 : 4.5) * (sim.map.riverDist(z.x, z.y) < 28 ? 0.5 : 1);
function step(sim, z, x, y, dt, run) {
  const dx = x - z.x, dy = y - z.y, d = Math.hypot(dx, dy), s = speedOf(sim, z, run) * dt;
  if (d <= s) { z.x = x; z.y = y; return true; }
  z.x += dx / d * s; z.y += dy / d * s; return false;
}
export function strangersTick(sim, dt) {
  if (!sim.strangers?.length) return;
  const B = sim.band, f = mainFire(sim) || sim.camp;
  for (const z of [...sim.strangers]) {
    if (z.state === 'wait') { if (sim.now.bed || sim.t > z.until) z.state = 'go'; continue; }
    if (z.state === 'home' || z.state === 'flee') {
      if (step(sim, z, B.x, B.y, dt, z.state === 'flee')) gone(sim, z);
      continue;
    }
    // go：摸到营地边上
    const tx = f.x + Math.cos(z.i * 2.4) * (z.task === 'ask' || z.task === 'gift' ? sim.camp.r + 10 : 26), ty = f.y + Math.sin(z.i * 2.4) * (z.task === 'ask' || z.task === 'gift' ? 40 : 18);
    if (!step(sim, z, tx, ty, dt, false)) {
      // 偷东西的被发现：营地里醒着的大人、狗
      if ((z.task === 'fire' || z.task === 'food') && dist(z, f) < 150 && !z.seen) {
        const party = sim.strangers.filter(x => x.task === z.task);
        for (const x of party) x.seen = true;
        const guards = sim.alive.filter(p => p.age >= 14 && !p.asleep && !p.lost && dist(p, f) < 120).length;
        const ch = 0.15 + 0.15 * Math.min(4, guards) + (tribeKnows(sim, 'dog') ? 0.35 : 0);
        if (sim.rng() < ch) caught(sim, z, guards, party);
      }
      continue;
    }
    if (z.task === 'ask') { if (!z.since) z.since = sim.t; if (sim.t - z.since > 5 * 60 || sim.now.dark) { z.state = 'home'; if (!B.fire) { B.mood = clamp(B.mood - 0.05, -1, 1); log(sim, `${B.name}的人等不到火种，垂着头回去了`, 'season'); } } continue; }
    if (z.task === 'gift') {
      const k = sim.rng() < 0.5;
      if (k) sim.stock.hide += 2; else { sim.stock.food.push({ kind: 'meat', n: 6, exp: sim.t + 3 * DAY }); }
      B.gifts++;
      log(sim, `${B.name}的${z.name}送来${k ? '两张兽皮' : '一扇鹿肉'}`, 'birth', { band: true });
      z.state = 'home'; continue;
    }
    // 偷：一伙人只偷一回，其余的跟着跑
    const party = sim.strangers.filter(x => x.task === z.task && x !== z);
    for (const x of party) if (x.state === 'go') x.state = 'flee';
    if (z.task === 'fire') {
      if (f.lit !== undefined && f.lit) {
        f.fuel = Math.max(0, f.fuel - 5);
        const scattered = sim.rng() < 0.3;
        if (scattered) { f.lit = false; f.fuel = 0; f.outSince = sim.t; }
        B.fire = true; B.raids++; B.mood = clamp(B.mood - 0.05, -1, 1);
        for (const p of sim.alive) p.love = clamp(p.love - 0.01);
        log(sim, `夜里${B.name}的人摸进营地，偷走了火种${scattered ? '，火堆也踢散了' : ''}`, 'danger', { band: true });
        sim.stats.fireStolen = (sim.stats.fireStolen || 0) + 1;
      }
    } else {
      let took = 0;
      for (const b of [...sim.stock.food].sort((a, c) => c.n - a.n)) { const n = Math.min(b.n, 8 - took); b.n -= n; took += n; if (took >= 8) break; }
      sim.stock.food = sim.stock.food.filter(b => b.n > 0.01);
      if (took >= 1) { B.hungry = Math.max(0, B.hungry - 0.3); B.raids++; log(sim, `夜里${B.name}的人摸进营地，偷走 ${Math.round(took)} 份吃的`, 'danger', { band: true }); sim.stats.foodStolen = (sim.stats.foodStolen || 0) + took; }
    }
    if (sim.rng() < 0.05 && !sim.plague) startPlague(sim, `${B.name}的人带来的`);
    z.state = 'flee';
  }
}
function caught(sim, z, guards, party = [z]) {
  const B = sim.band;
  for (const x of party) x.state = 'flee';
  B.mood = clamp(B.mood - 0.05, -1, 1);
  let hurt = '';
  if (guards >= 1 && sim.rng() < 0.25) {
    const ours = sim.alive.filter(p => p.age >= 14 && !p.asleep && dist(p, z) < 200);
    const v = ours[sim.rng.int(ours.length)];
    if (v && sim.rng() < 0.5) { v.health = Math.max(0.1, v.health - 0.25); v.hurt = sim.t; v.hurtBy = '伤'; hurt = `，${v.name}挨了一棍`; }
    else hurt = `，${z.name}挨了几拳`;
  }
  log(sim, `${B.name}的人夜里摸到营地边上，被${tribeKnows(sim, 'dog') ? '狗叫声' : '守夜的人'}撞见，吼跑了${hurt}`, 'danger', { band: true });
  sim.stats.raidsFoiled = (sim.stats.raidsFoiled || 0) + 1;
}
function gone(sim, z) {
  sim.strangers = sim.strangers.filter(x => x !== z);
  delete sim.idx[z.id];
}

// ---------------- 号令（墨笔写在外族身上） ----------------
const fail = (msg, extra = {}) => ({ ok: false, msg, ...extra });
const done = (msg, undo = null, extra = {}) => ({ ok: true, msg, undo, ...extra });
export const bandH = {
  giveFire(sim) {
    const B = sim.band;
    if (!B?.met || B.merged) return fail('没有外族');
    if (B.fire) return fail(`${B.name}的火正旺，用不着`);
    B.fire = true; B.mood = clamp(B.mood + 0.3, -1, 1); B.gifts++;
    for (const z of sim.strangers) if (z.task === 'ask') z.state = 'home';
    for (const p of sim.alive) p.love = clamp(p.love + 0.01);
    return done(`${B.name}的人捧着火把回去了，一路回头作揖（关系：${bandMood(B)}）`);
  },
  marry(sim) {
    const B = sim.band;
    if (!B?.met || B.merged) return fail('没有外族');
    if (B.mood < 0.2) return fail(`${B.name}还信不过我们（关系：${bandMood(B)}）：先送火、送东西`);
    const single = sim.alive.filter(p => p.age >= 15 && p.age <= 36 && !sim.idx[p.partner]?.alive && !p.lost).sort((a, b) => a.age - b.age);
    const young = m => m.age >= 16 && m.age <= 34;
    if (!single.length) {
      // 族里的年轻人都成了家：请他们一对小夫妻搬过来，两族做亲戚
      const man = B.members.filter(m => m.sex === 'm' && young(m)), wife = B.members.filter(m => m.sex === 'f' && young(m));
      if (!man.length || !wife.length || B.members.length < 4) return fail(`${B.name}那边没有合适的人`);
      const pay = payGift(sim, 8);
      const a = adopt(sim, man[sim.rng.int(man.length)]), b = adopt(sim, wife[sim.rng.int(wife.length)]);
      a.partner = b.id; b.partner = a.id;
      B.marriages++; B.mood = clamp(B.mood + 0.15, -1, 1);
      for (const q of sim.alive) q.morale = clamp(q.morale + 0.05);
      sim.stats.marriages = (sim.stats.marriages || 0) + 1;
      sim.assignBeds();
      return done(`${B.name}的${a.name}和${b.name}两口子搬过来，跟我们做了亲戚${pay >= 1 ? `；送去 ${Math.round(pay)} 份吃的当礼` : ''}`);
    }
    let pick = null, ours = null;
    for (const o of single) {
      const cands = B.members.filter(m => m.sex !== o.sex && m.age >= 16 && m.age <= 34);
      if (!cands.length) continue;
      const g = cands.find(m => m.genius && B.mood >= 0.5);
      pick = g || cands[sim.rng.int(cands.length)]; ours = o; break;
    }
    if (!pick) return fail(`${B.name}那边没有合适的人`);
    const gift = payGift(sim, 6);
    const p = adopt(sim, pick);
    p.partner = ours.id; ours.partner = p.id;
    B.marriages++; B.mood = clamp(B.mood + 0.2, -1, 1);
    for (const q of sim.alive) q.morale = clamp(q.morale + 0.05);
    sim.stats.marriages = (sim.stats.marriages || 0) + 1;
    sim.assignBeds();
    return done(`${B.name}的${p.name}${p.sex === 'f' ? '嫁' : '入赘'}过来，和${ours.name}成了一家${p.genius ? `——还是个${GENIUS[p.genius]}` : ''}${gift >= 1 ? `；送去 ${Math.round(gift)} 份吃的当聘礼` : ''}`);
  },
  drive(sim) {
    const B = sim.band;
    if (!B?.met || B.merged) return fail('没有外族');
    const here = sim.strangers.filter(z => z.state === 'go' || z.state === 'wait');
    B.mood = clamp(B.mood - (here.length ? 0.1 : 0.25), -1, 1);
    B.cowed = sim.t + 10 * DAY;
    for (const z of here) z.state = 'flee';
    for (const p of sim.alive) p.fear = clamp(p.fear + 0.02);
    return done(here.length ? `${here.map(z => z.name).join('、')}被赶回了河那边` : `族里的汉子拿着石矛去河边吼了一阵：${B.name}十天里不敢过来（关系：${bandMood(B)}）`);
  },
  awe(sim) {
    const B = sim.band;
    if (!B?.met || B.merged) return fail('没有外族');
    B.mood = clamp(B.mood + 0.25, -1, 1); B.faith += 0.3;
    sim.effects.push({ kind: 'light', x: B.x, y: B.y, t: sim.t });
    return done(`${B.name}的人看见天上落下一道光，跪了一地（关系：${bandMood(B)}）`);
  },
};

// 送礼：从存粮里拿，挑存得最多的那堆
function payGift(sim, want) {
  const gift = Math.min(want, foodTotal(sim));
  let left = gift;
  for (const b of [...sim.stock.food].sort((a, c) => c.n - a.n)) { const n = Math.min(b.n, left); b.n -= n; left -= n; if (left <= 0) break; }
  sim.stock.food = sim.stock.food.filter(b => b.n > 0.01);
  return gift;
}
// 外族的人过来成了我们的人
function adopt(sim, m, x = null, y = null) {
  const B = sim.band;
  B.members = B.members.filter(q => q !== m);
  if (B.genius === m.name) B.genius = null;
  const c = sim.camp;
  const p = makePerson(sim, { name: m.name, sex: m.sex, age: m.age, temper: sim.rng.pick(TEMPERS), x: x ?? c.x + sim.rng.range(-40, 40), y: y ?? c.y + sim.rng.range(-30, 30) });
  p.from = B.name; p.love = clamp(0.25 + 0.15 * B.faith); p.genius = m.genius || null; p.geniusShown = true;
  sim.people.push(p); sim.alive.push(p);
  for (const id of [...B.techs, ...Object.keys(m.knows || {})]) if (TECHS[id] && p.age >= 10) learn(sim, p, id, 'band');
  refreshKnown(sim);
  return p;
}
export function merge(sim) {
  const B = sim.band;
  if (B.merged) return;
  const n = B.members.length;
  const names = [];
  for (const m of [...B.members]) names.push(adopt(sim, m).name);
  B.merged = true;
  for (const p of sim.alive) p.morale = clamp(p.morale + 0.1);
  sim.stats.merged = n;
  sim.assignBeds();
  log(sim, `${B.name}的头人带着全族扛着家当过了河：${names.slice(0, 5).join('、')}${n > 5 ? ` 等 ${n} 口人` : ''}，从今往后是一族了`, 'birth', { band: true, big: true });
}
