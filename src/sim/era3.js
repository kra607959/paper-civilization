// 第三代 · 青铜城邦。城内沿用具名族人，附属村以户群结算。
import { DAY, YEAR_DAYS, SEASON_DAYS, TECHS, ERA3_TECH_IDS } from './config.js';
import { addFood, clamp, dist, foodTotal, localBuildings, log, reveal } from './util.js';
import { learn, tribeKnows } from './tech.js';
import { startPlague } from './events.js';

const ok = (msg, extra = {}) => ({ ok: true, msg, ...extra });
const no = msg => ({ ok: false, msg });
const days = n => n * DAY;
const built = (sim, id) => localBuildings(sim, id)[0];
export const CITY_TECH = { patrol: 'wheel', guard: 'bronzeWalls', trade: 'measure', ritual: 'rites', peace: 'script' };
export const CITY_LAWS = { patrol: '驿巡令', guard: '守望令', trade: '市平令', ritual: '清祭令', recruit: '乡备令', peace: '安民令' };
export const CITY_TAX = { relief: '减赋', normal: '常赋', levy: '加赋' };
export const BELL_INK = 16;

export function initEra3(sim) {
  sim.era3 = {
    active: false, startDay: 0, startedAt: 0, done: false, result: null,
    villages: [], rivals: [], convoys: [], archive: {}, scripture: {}, laws: {}, law: null, tax: 'normal',
    treasury: 0, unrest: 0.15, guards: 0, guardUntil: 0, patrolUntil: 0, ritualUntil: 0,
    census: { 耕户: 0, 工户: 0, 掌事: 0 },
    next: {}, bell: null, bellUntil: 0, trialAt: 0, trial: null, attempts: 0, lastBattle: null,
    grainTax: 0, trades: 0, revolts: 0, droughts: 0, raids: 0, losses: 0, victories: 0,
  };
  sim.stock.copper = 0;
  sim.stock.bronze = 0;
}

export const canEnterEra3 = sim => !!(sim.era2?.done && sim.era2.result?.ok && !sim.era3?.active && sim.alive.length);
export const cityPopulation = sim => sim.alive.length + sim.era3.villages.reduce((n, h) => n + h.pop, 0);
export const cityFollowers = sim => (sim.era3.bellUntil > sim.t ? sim.alive.length : 0) +
  [...sim.era3.villages, ...sim.era3.rivals].reduce((n, h) => n + Math.round(h.pop * h.faith), 0);

export function enterEra3(sim) {
  if (!canEnterEra3(sim)) return no(sim.era3?.active ? '已经进入青铜时代' : '先以大渠分洪，通过农耕篇');
  const E = sim.era3, c = sim.camp;
  E.active = true; E.startedAt = sim.t; E.startDay = sim.day;
  E.trialAt = sim.t + days(9 * YEAR_DAYS);
  const riverSide = sim.map.river[0].x < c.x ? -1 : 1;
  const used = [c, ...(sim.village ? [sim.village] : []), ...(sim.band && !sim.band.merged ? [sim.band] : [])];
  const choose = (angle, lo, hi) => {
    const candidates = [];
    for (let r = lo; r <= hi; r += 65) for (let i = 0; i < 18; i++) {
      const a = angle + ((i % 2) ? 1 : -1) * Math.ceil(i / 2) * 0.21;
      const p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
      if (p.x < 100 || p.y < 100 || p.x > sim.map.w - 100 || p.y > sim.map.h - 100) continue;
      if (sim.map.riverDist(p.x, p.y) < 64 || used.some(q => dist(q, p) < 155)) continue;
      candidates.push({ ...p, score: i * 60 + r + sim.map.rocks.filter(k => dist(k, p) < k.r + 22).length * 180 });
    }
    candidates.sort((a, b) => a.score - b.score);
    const p = candidates[0];
    if (!p) return null;
    const at = { x: p.x, y: p.y };
    used.push(at); reveal(sim, p.x, p.y, 145);
    return at;
  };
  for (const [i, name] of ['禾汀', '柳渡'].entries()) {
    const at = choose(i ? 1.35 : -1.22, 235, 510);
    if (at) E.villages.push({ ...at, id: `ward${i}`, name, pop: 24 + i * 3, cap: 42 + i * 5, faith: 0, loyalty: 0.72, bins: 12 });
  }
  const rivals = [
    ['岚丘', '#345e65', -2.65, 73, -0.12], ['白陶', '#796281', 2.65, 67, 0.12], ['鹿阜', '#9e6337', 1.1, 82, -0.24],
  ];
  for (const [i, [name, color, angle, force, mood]] of rivals.entries()) {
    const at = choose(riverSide < 0 ? angle : Math.PI - angle, 490, 1080);
    if (at) {
      const R = { ...at, id: `polis${i}`, name, color, force, mood, pop: 31 + i * 5, faith: 0, trades: 0, allied: false };
      E.rivals.push(R); sim.idx[R.id] = R;
    }
  }
  for (const [i, trait] of ['smith', 'scribe', 'general'].entries()) {
    const p = sim.alive.filter(q => q.age >= 14 && !q.genius)[i % 2];
    if (p) { p.genius = trait; p.geniusShown = true; log(sim, `${p.name}显出新才：${['铸匠', '史官', '将领'][i]}`, 'birth', { who: p.id }); }
  }
  sim.dirty.tech = sim.dirty.buildings = true;
  log(sim, '第三代 · 青铜时代：旧人、旧地、旧技艺仍在。城与村从今天起要一起治理。', 'god', { big: true, era: true });
  return ok('青铜城邦开启');
}

export function cityTarget(sim, p) {
  const E = sim.era3;
  if (!E?.active) return null;
  for (const r of E.rivals) if (dist(r, p) < 85) return { ctx: 'polis', ref: r.id, x: r.x, y: r.y, name: r.name };
  const c = built(sim, 'palace') || citySeat(sim);
  if (dist(c, p) < 49) return { ctx: 'city', ref: 'city', x: c.x, y: c.y, name: '城务台' };
  return null;
}

export function citySeat(sim) {
  const c = sim.camp;
  return { x: c.x, y: c.y + (c.y > sim.map.h - 120 ? -82 : 82) };
}

export function lockCityGlyph(sim, ctx, id) {
  if (!sim?.era3?.active) return '第三代';
  const t = CITY_TECH[id];
  return t && !tribeKnows(sim, t) ? `先研究「${TECHS[t].name}」` : null;
}

function spendGrain(sim, n) {
  if (sim.stock.food.filter(b => b.kind === 'grain').reduce((v, b) => v + b.n, 0) < n) return false;
  for (const b of sim.stock.food.filter(b => b.kind === 'grain').sort((a, b) => a.exp - b.exp)) {
    const take = Math.min(n, b.n); b.n -= take; n -= take; if (n <= 0) break;
  }
  sim.stock.food = sim.stock.food.filter(b => b.n > 0.001);
  return true;
}

export function setCityTax(sim, level) {
  if (!sim.era3?.active || !tribeKnows(sim, 'tribute')) return no('先学会税赋');
  if (!Object.hasOwn(CITY_TAX, level)) return no('没有这一档税额');
  const E = sim.era3;
  if (E.tax !== level) log(sim, `立下新税额：${CITY_TAX[level]}`, 'god');
  E.tax = level;
  return ok(`税额改为${CITY_TAX[level]}，下一季起生效`);
}

export function enactCityLaw(sim, id) {
  const E = sim.era3;
  if (!E?.active || !tribeKnows(sim, 'law') || !built(sim, 'palace')) return no('先研究立法、建好宫室');
  if (!CITY_LAWS[id] || !E.scripture[id]) return no('先发出这道神谕，让史官抄进书简');
  if (E.law === id) return no('这道律令已在施行');
  if (sim.ink < 4) return no('刻定律令要 4 墨');
  sim.ink -= 4; sim.stats.inkSpent += 4;
  E.law = id; E.laws[id] = sim.t;
  log(sim, `刻神谕为律：${CITY_LAWS[id]}`, 'god', { big: true });
  return ok(`${CITY_LAWS[id]}已施行`);
}

export function applyCityGlyph(sim, a) {
  const E = sim.era3, id = a.sym;
  const why = lockCityGlyph(sim, a.ctx, id);
  if (why) return no(why);
  if (id === 'trade' ? a.ctx !== 'polis' : a.ctx !== 'city') return no('这个符要落在相应的城印上');
  if (id !== 'trade' && E.next[id] > sim.t) return no('这道号令刚发过，等族人办完再写');
  let msg, cool = 1;
  if (id === 'recruit') {
    const cap = Math.min(28, Math.floor(cityPopulation(sim) * (E.law === 'recruit' ? 0.28 : 0.23)));
    if (E.guards >= cap) return no('已经征到足够的守卒');
    if (E.treasury >= 4) E.treasury -= 4;
    else if (!spendGrain(sim, 3)) return no('征召要 3 份谷或 4 份税粮');
    const n = Math.min(cap - E.guards, 5 + (built(sim, 'palace') ? 2 : 0)); E.guards += n;
    E.unrest = clamp(E.unrest + 0.04); cool = 2;
    msg = `征来 ${n} 名守卒，现在共 ${E.guards} 名`;
  } else if (id === 'patrol' || id === 'guard') {
    if (!E.guards) return no('先征召守卒');
    if (id === 'patrol') { E.patrolUntil = sim.t + days(5 + (tribeKnows(sim, 'post') ? 3 : 0)); msg = '守卒沿村路巡行，运粮损失变少'; }
    else { E.guardUntil = sim.t + days(5); msg = '守卒登墙，接下来五天准备迎敌'; }
  } else if (id === 'ritual' || id === 'peace') {
    if (id === 'ritual' && !built(sim, 'temple')) return no('先建宗庙再祭祀');
    E.unrest = Math.max(0, E.unrest - (id === 'peace' ? 0.2 : 0.16));
    E.ritualUntil = sim.t + days(4 + (built(sim, 'temple')?.params.quality || 0));
    for (const p of sim.alive) p.love = clamp(p.love + 0.025);
    cool = 3; msg = '民心安定，祭告之力维持五天';
  } else if (id === 'trade') {
    const r = E.rivals.find(x => x.id === a.ref);
    if (!r) return no('请在邻邦的城印上写贸易符');
    if (!built(sim, 'market')) return no('先建市集');
    if (E.convoys.some(x => x.ref === r.id)) return no('去这座城的商队还在路上');
    if (r.mood <= -0.75) return no('关系紧张，先敲钟安抚或等待停战');
    if (sim.stock.pottery >= 2) sim.stock.pottery -= 2;
    else if (sim.stock.wood >= 8) sim.stock.wood -= 8;
    else return no('贸易要 2 只陶罐或 8 根木');
    const eraRoad = built(sim, 'cartway');
    const duration = Math.max(1, dist(r, sim.camp) / (eraRoad ? 360 : 175) * (tribeKnows(sim, 'post') ? 0.72 : 1));
    E.convoys.push({ ref: r.id, depart: sim.t, due: sim.t + days(duration) });
    msg = `商队去${r.name}，约 ${Math.ceil(duration)} 天后回来`;
  } else return no('这道神谕不属于城邦');
  if (id !== 'trade') E.next[id] = sim.t + days(cool);
  if (tribeKnows(sim, 'script')) {
    const S = E.scripture[id] ||= { first: sim.t, count: 0 };
    S.count++;
  }
  return ok(msg);
}

export function cityBuilt(sim, b) {
  const E = sim.era3;
  if (!E?.active) return;
  if (b.type === 'bell') {
    if (!E.bell) sim.inkMax += 16;
    E.bell = b.id;
    if (!E.trial && !E.done) E.trialAt = Math.max(sim.t + days(2 * SEASON_DAYS), E.startedAt + days(6 * YEAR_DAYS));
    log(sim, '铸钟告成。钟声把两村与城连在一起，也惊动了外邦。', 'build', { big: true });
    ringCityBell(sim, { first: true });
  }
}

export function ringCityBell(sim, { first = false } = {}) {
  const E = sim.era3, b = sim.idx[E?.bell];
  if (!E?.active || !b) return no('大钟尚未铸成');
  if (E.next.bell > sim.t) return no('今日已鸣过一次钟');
  if (!first && sim.ink < BELL_INK) return no(`鸣钟需要 ${BELL_INK} 墨`);
  if (!first) { sim.ink -= BELL_INK; sim.stats.inkSpent += BELL_INK; }
  E.next.bell = sim.t + DAY;
  E.bellUntil = sim.t + days(7);
  for (const h of [...E.villages, ...E.rivals]) {
    if (dist(b, h) > b.params.reach) continue;
    if (h.mood != null) h.mood = clamp(h.mood + 0.13 * (1 - h.faith), -1, 1);
    h.faith = 1;
    if (h.loyalty != null) h.loyalty = clamp(h.loyalty + 0.13);
  }
  E.unrest = Math.max(0, E.unrest - 0.10);
  log(sim, `鸣响大钟：声传约 ${b.params.reach} 步，钟声所及已聚起 ${cityFollowers(sim)} 名信众`, 'god');
  return ok('大钟已鸣', { bell: b, pitch: b.params.hz, tone: b.params.tone });
}

export function cityDefense(sim) {
  const E = sim.era3;
  const wall = built(sim, 'citywall'), way = built(sim, 'cartway');
  const drill = E.guardUntil > sim.t, calm = E.ritualUntil > sim.t;
  return Math.round(
    (wall?.integrity || 0) * (wall?.params.strength || 0) +
    E.guards * (1.15 + (tribeKnows(sim, 'bronzeWalls') ? 0.4 : 0) + (drill ? 0.45 : 0)) +
    (tribeKnows(sim, 'chariot') && way ? 20 * way.params.quality : 0) +
    (calm ? (tribeKnows(sim, 'divination') ? 14 : 7) : 0) +
    (E.law === 'guard' ? 7 : 0) + (E.bellUntil > sim.t ? 10 : 0) +
    E.villages.reduce((n, v) => n + v.loyalty * v.pop * 0.13, 0) + Math.min(10, E.treasury / 3) - E.unrest * 14
  );
}

export function repairCityWall(sim) {
  const wall = built(sim, 'citywall');
  if (!wall || wall.integrity >= 1) return no('没有需要维修的城墙');
  if (sim.stock.stone < 8 || sim.stock.wood < 4) return no('修墙要 8 石、4 木');
  sim.stock.stone -= 8; sim.stock.wood -= 4;
  wall.integrity = clamp(wall.integrity + 0.30);
  log(sim, `城墙补到 ${Math.round(wall.integrity * 100)}% 完好`, 'build');
  return ok('修了一段城墙');
}

export function startCoalition(sim) {
  const E = sim.era3;
  if (!E?.active || E.trial || E.done) return false;
  const enemies = E.rivals.filter(r => r.mood < 0.68);
  const members = enemies.length >= 2 ? enemies : [...E.rivals].sort((a, b) => a.mood - b.mood).slice(0, 2);
  const strength = Math.max(124, Math.round(members.reduce((n, r) => n + r.force * (1 - Math.max(0, r.mood) * 0.30) * (1 - r.faith * 0.10), 0)));
  E.attempts++;
  E.trial = { names: members.map(r => r.name), strength, wave: 0, held: 0, loss: 0, nextAt: sim.t + days(3) };
  log(sim, `${E.trial.names.join('、')}的主战派结盟来伐！三天后第一波攻势，备粮、修墙、征卒守城。`, 'danger', { big: true });
  return true;
}

function siegeTick(sim) {
  const E = sim.era3, T = E.trial;
  if (!T || sim.t < T.nextAt) return;
  const wall = built(sim, 'citywall');
  const need = T.strength + T.wave * 7;
  const defense = cityDefense(sim), fed = E.treasury >= 5 || spendGrain(sim, 5);
  if (E.treasury >= 5) E.treasury -= 5;
  const held = !!wall && defense >= need && fed;
  if (held) T.held++;
  else {
    T.loss++; E.losses++;
    E.unrest = clamp(E.unrest + 0.18);
    E.guards = Math.max(0, E.guards - 3);
    const injured = sim.alive.filter(p => p.age >= 14 && dist(p, sim.camp) < 220).slice(0, 2);
    for (const p of injured) p.health = Math.max(0.1, p.health - 0.22);
  }
  if (wall) wall.integrity = clamp(wall.integrity - (held ? 0.14 : 0.32));
  T.wave++;
  T.nextAt = sim.t + days(4);
  log(sim, `联盟第 ${T.wave} 波：${held ? '守住了' : fed ? '城防失守' : '军粮不足'}（城防 ${defense} / 来势 ${need}）`, held ? 'build' : 'danger', { big: true });
  if (T.wave < 3) return;
  E.lastBattle = { ...T }; E.trial = null;
  if (T.held >= 2 && E.bell && sim.idx[E.bell] && sim.alive.length >= 6) {
    E.done = true; E.victories++;
    E.result = { ok: true, day: sim.day, days: sim.day - E.startDay, pop: cityPopulation(sim), residents: sim.alive.length,
      archive: Object.keys(E.archive).length, technologies: ERA3_TECH_IDS.filter(id => tribeKnows(sim, id)).length, followers: cityFollowers(sim),
      held: T.held, attempts: E.attempts, trades: E.trades, hz: sim.idx[E.bell].params.hz };
    log(sim, '联盟退兵，青铜城邦站稳了。第三代考验通过。', 'god', { big: true });
  } else {
    E.trialAt = sim.t + days(YEAR_DAYS);
    E.warnedAt = 0;
    log(sim, '这一轮联盟暂退。修墙备粮、补足钟声与守卒，明年仍可再战。', 'danger', { big: true });
  }
}

export function dailyEra3(sim, newSeason) {
  const E = sim.era3;
  if (!E?.active) return;
  const season = sim.now.season, age = sim.day - E.startDay;
  // 城粮按消耗与现存仓容量周转；超出保鲜能力的部分只能露放，每日损耗。
  const limit = Math.max(1, sim.plan.daily || sim.alive.length) * 24 + (sim.granaryCap || 0);
  let overflow = Math.ceil(Math.max(0, foodTotal(sim) - limit) * 0.28), lost = 0;
  if (overflow) {
    for (const b of [...sim.stock.food].sort((a, b) => a.exp - b.exp)) {
      const n = Math.min(b.n, overflow); b.n -= n; overflow -= n; lost += n;
      if (!overflow) break;
    }
    sim.stock.food = sim.stock.food.filter(b => b.n > 0.001);
    sim.stats.spoiled += lost;
    if (lost >= 3 && (newSeason || !E.lastOverstock || sim.t - E.lastOverstock >= days(14))) {
      E.lastOverstock = sim.t;
      log(sim, `城仓放不下所有存粮，露放坏了 ${Math.round(lost)} 份；可先留足军粮。`, 'waste');
    }
  }
  const officers = new Set(Object.values(sim.roles).filter(Boolean));
  E.census = { 耕户: 0, 工户: 0, 掌事: 0 };
  for (const h of sim.households) {
    const p = sim.idx[h.head];
    const estate = h.members.some(id => officers.has(id)) ? '掌事' : p && (p.skills.build + p.skills.fire > 1.1 || p.genius === 'smith') ? '工户' : '耕户';
    h.estate = estate; E.census[estate]++;
  }
  const F = built(sim, 'furnace');
  if (F && sim.stock.wood >= 2 && sim.stock.stone >= 1) {
    sim.stock.wood -= 2; sim.stock.stone -= 1;
    sim.stock.copper += Math.max(1, Math.round(F.params.quality * 3));
    if (tribeKnows(sim, 'alloy') && sim.stock.copper >= 2) {
      sim.stock.copper -= 2; sim.stock.bronze += built(sim, 'workshop')?.params.quality >= .60 ? 3 : 2;
    }
  }
  if (tribeKnows(sim, 'script')) {
    const scribe = sim.alive.filter(p => p.age >= 14 && !p.lost).sort((p, q) => (q.genius === 'scribe') - (p.genius === 'scribe') || p.n - q.n)[0];
    if (scribe) {
      const ids = Object.keys(sim.known).filter(id => E.archive[id] == null).slice(0, scribe.genius === 'scribe' ? 3 : 2);
      for (const id of ids) E.archive[id] = sim.t;
      const read = Object.keys(E.archive).find(id => !sim.known[id]);
      if (read) learn(sim, scribe, read, 'tablet');
      if (ids.length) sim.dirty.tech = true;
    }
  }
  for (const q of E.convoys.filter(q => q.due <= sim.t)) {
    const r = sim.idx[q.ref];
    if (!r) continue;
    const grain = Math.round(16 + (built(sim, 'market')?.params.quality || 0) * 6 + (E.law === 'trade' ? 6 : 0));
    addFood(sim, 'grain', grain);
    sim.stock.stone += 8; sim.stock.copper += 3;
    r.trades++; E.trades++; r.mood = clamp(r.mood + 0.19, -1, 1); r.allied = r.mood >= 0.68;
    log(sim, `商队从${r.name}回来，带回 ${grain} 份谷物、石料与铜料`, 'work');
  }
  E.convoys = E.convoys.filter(q => q.due > sim.t);
  const patron = (built(sim, 'palace')?.params.quality || 0) * 0.04;
  if (sim.day % 3 === 0) {
    const yieldMul = built(sim, 'cartway') ? 1.25 : 1;
    for (const v of E.villages) {
      v.bins = Math.min(85, v.bins + Math.round(v.pop * 0.55 * (E.droughtUntil > sim.t ? 0.53 : 1)));
      if (v.loyalty >= 0.35 && (E.patrolUntil > sim.t || E.law === 'patrol' || built(sim, 'cartway'))) {
        const n = Math.min(v.bins, Math.round(v.pop * 0.38 * yieldMul));
        v.bins -= n; addFood(sim, 'grain', n); sim.stock.wood += 3; sim.stock.stone += 2;
      }
    }
    if (E.guards > 0 && !E.trial) {
      const n = Math.ceil(E.guards / 8);
      if (E.treasury >= n) E.treasury -= n;
      else if (!spendGrain(sim, n)) E.guards = Math.max(0, E.guards - 1);
    }
  }
  if (newSeason) {
    const t = E.tax === 'levy' ? 0.48 : E.tax === 'relief' ? 0.06 : 0.24;
    let received = 0;
    for (const v of E.villages) {
      const n = Math.floor(v.bins * t * v.loyalty); v.bins -= n; received += n;
      v.loyalty = clamp(v.loyalty + patron + (E.tax === 'levy' ? -0.09 : E.tax === 'relief' ? 0.09 : 0.02));
      if (v.bins >= 10 && v.loyalty > 0.4) v.pop = Math.min(v.cap, v.pop + 2);
    }
    const cityDue = Math.round((E.census.耕户 + E.census.工户 * 0.6) * t);
    if (cityDue && foodTotal(sim) > sim.alive.length * 6 && spendGrain(sim, cityDue)) received += cityDue;
    E.treasury += received; E.grainTax += received;
    E.unrest = clamp(E.unrest + (E.tax === 'levy' ? 0.14 : E.tax === 'relief' ? -0.07 : -0.02) - patron - (E.law === 'peace' || E.law === 'ritual' ? 0.06 : 0));
    if (E.unrest > 0.67) {
      E.revolts++; E.treasury = Math.floor(E.treasury * 0.62); E.guards = Math.max(0, E.guards - 3); E.unrest *= 0.74;
      log(sim, '城内起了叛乱，税仓蒙损。减赋、祭祀、立安民令都能缓和民心。', 'danger', { big: true });
    }
    if (age >= YEAR_DAYS && season === 1 && (sim.seed + Math.floor(age / YEAR_DAYS)) % 3 !== 1) {
      E.droughts++; E.droughtUntil = sim.t + days(6);
      sim.weather.drought = true;
      log(sim, '城邦遭旱。接通的水渠能护田，村里的谷产会下降。', 'danger');
    }
    if (age >= YEAR_DAYS && season === 3 && !sim.plague && foodTotal(sim) < sim.alive.length * 10) startPlague(sim, '城里');
    if (age >= YEAR_DAYS && season === 2 && !E.trial && E.patrolUntil <= sim.t && E.law !== 'patrol' && E.rivals.some(r => r.mood < -0.24)) {
      E.raids++; E.treasury = Math.max(0, E.treasury - 6); E.unrest = clamp(E.unrest + 0.06);
      log(sim, '邻邦来犯，抢走村路上的税粮。派守卒巡逻可护住运粮。', 'danger');
    }
    if (season === 0 && tribeKnows(sim, 'astronomy')) log(sim, '天官观星察年：夏旱可能压低村粮，先存粮、疏渠。', 'season');
  }
  if (!E.done) {
    const lead = (tribeKnows(sim, 'post') ? 2 : 1) * SEASON_DAYS;
    if (sim.t >= E.trialAt - days(lead) && !E.warnedAt) {
      E.warnedAt = sim.t;
      log(sim, `诸邦正在结盟，约 ${Math.ceil((E.trialAt - sim.t) / DAY)} 天后动身${tribeKnows(sim, 'divination') ? '；先守住两波，再以钟声定民心' : ''}`, 'danger', { big: true });
    }
    if (!E.trial && sim.t >= E.trialAt) startCoalition(sim);
    siegeTick(sim);
  }
}
