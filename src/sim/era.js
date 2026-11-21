// 时代工程：大祭坛与墨池，分三段，每段照图纸画一部分；三段修完，墨的上限翻倍，墨池里映出远方的河谷。
// 时代考验：大水冲毁旧营地；用铅笔画一条路，带全族穿过兽群，走到新的河谷。走到了，这一代就算过了。
import { K, DAY, YEAR_DAYS, SEASON_DAYS, DESIGN_NEEDS, ERA2_DESIGNS, ERA3_DESIGNS, TECHS } from './config.js';
import { dist, clamp, log, reveal, known, inFlood, dryPoint, mainFire, foodTotal, takeFood, recalcLocalBonuses } from './util.js';
import { yearOf } from './calendar.js';
import { tribeKnows } from './tech.js';
import { startFlood, } from './events.js';
import { makeBeast } from './beasts.js';
import { addFire } from './build.js';
import { setJob } from './people.js';
import { RIVER_HALF } from './mapgen.js';

export function initEra(sim) {
  sim.era = {
    altar: null,            // { id, x, y, stage, strokes: {1,2,3}, params }
    floodAt: K.era.floodForceDay * DAY, floodSoon: false, flooded: false, vision: false, valleyKnown: false,
    trialAt: 0, autoAt: 0, done: false, doneAt: 0, result: null,
  };
  sim.march = null;
}
export const altarStage = sim => sim.era.altar?.stage || 0;
const nameOf = id => `「${TECHS[id].name}」`;

// 这张图纸现在能不能画；不能就说为什么
export function designLock(sim, id) {
  if (ERA2_DESIGNS.includes(id) && !sim.era2?.active) return '进入第二代（农耕）后才能画';
  if (ERA3_DESIGNS.includes(id)) {
    if (!sim.era3?.active) return '进入第三代（青铜）后才能画';
    if ([...sim.buildings, ...sim.sites].some(b => b.type === id && dist(b, sim.camp) <= K.campActiveR)) return '城里已经有了，或正在修';
  }
  const need = DESIGN_NEEDS[id];
  if (need && !tribeKnows(sim, need)) return `要先学会${nameOf(need)}`;
  const st = altarStage(sim), busy = sim.sites.some(s => s.type.startsWith('altar'));
  if (id === 'altar1' && (st >= 1 || busy)) return st >= 1 ? '台基已经修好了' : '祭坛正在修';
  if (id === 'altar2' && (st < 1 || busy || st >= 2)) return st >= 2 ? '立石已经立好了' : busy ? '祭坛正在修' : '先修好台基';
  if (id === 'altar3' && (st < 2 || busy || st >= 3)) return st >= 3 ? '墨池已经修好了' : busy ? '祭坛正在修' : '先立好立石';
  return null;
}
export const altarInk = id => K.era.ink[Number(id.slice(-1)) - 1];
// 开工付 altarInk；修的时候墨再一点点流进去开光（神留四成墨应急），合计 altarInk + altarBless
export const altarBless = id => K.era.bless[Number(id.slice(-1)) - 1];

// 祭坛修好一段
export function altarBuilt(sim, s, who) {
  const stage = Number(s.type.slice(-1));
  const A = sim.era.altar || (sim.era.altar = { id: `A${sim.nextId++}`, x: s.x, y: s.y, stage: 0, strokes: {}, params: {} });
  A.stage = stage; A.strokes[stage] = s.strokes || null; A.params[stage] = s.params;
  let b = sim.buildings.find(x => x.type === 'altar');
  if (!b) { b = { id: A.id, n: sim.nextId++, type: 'altar', name: '大祭坛', x: A.x, y: A.y, built: true, t: sim.t, strokes: null }; sim.buildings.push(b); sim.idx[b.id] = b; }
  b.stage = stage; b.altar = A;
  sim.stats.altar = stage;
  if (stage === 1) {
    sim.altarDev = s.params.dev || 0.15;
    log(sim, `${who}垒好了祭坛的台基（${s.params.tiers} 层）：族人有了拜神的地方，信仰多 ${Math.round(sim.altarDev * 100)}%`, 'build');
  } else if (stage === 2) {
    for (const p of sim.alive) { p.love = clamp(p.love + 0.05); p.fear = clamp(p.fear + (s.params.awe || 0.05)); }
    sim.altarWard = s.params.ward || 300;
    log(sim, `${who}在台基上立起了 ${s.params.stones} 块立石：虎不大敢靠近营地了`, 'build');
  } else {
    const before = sim.inkMax;
    sim.inkMax = Math.round(K.ink.max * 2 + (s.params.bonus || 0));
    sim.inkRegen = 1 + (s.params.flow || 0);
    sim.ink = Math.min(sim.inkMax, sim.ink + 10);
    vision(sim);
    log(sim, `墨池修好了：神的墨从 ${before} 涨到 ${sim.inkMax}`, 'god', { big: true });
  }
  sim.dirty.buildings = true;
}

// 墨池里映出新河谷；定下大水的日子
function vision(sim) {
  const E = sim.era, V = sim.map.valley;
  E.vision = true; E.valleyKnown = true;
  reveal(sim, V.x, V.y, K.era.valleyR + 60);
  E.floodAt = Math.min(E.floodAt, floodDay(sim.day) * DAY);
  const d = Math.round(E.floodAt / DAY), y = Math.floor(d / YEAR_DAYS) + 1, q = Math.floor((d % YEAR_DAYS) / SEASON_DAYS);
  log(sim, `墨池的水面晃了晃，映出一片远方的河谷：在营地${dirWord(sim.camp, V)}边，草深、有泉。又映出大水漫过营地——第 ${y} 年${SEASON_START[q]}，大水要来`, 'god', { big: true, valley: true });
}
// 大水的日子：墨池修好后过两周、不早于第五年开春，落在下一季的头一天；冬天不发大水，挪到开春；最晚第六年开春
const SEASON_START = ['开春', '入夏', '入秋', '入冬'];
export function floodDay(day) {
  let d = Math.max(day + K.era.floodAfter, K.era.floodMinDay);
  d = Math.ceil(d / SEASON_DAYS) * SEASON_DAYS;
  if (Math.floor((d % YEAR_DAYS) / SEASON_DAYS) === 3) d += SEASON_DAYS;
  return Math.min(d, K.era.floodForceDay);
}
const DIRS = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
const dirWord = (a, b) => DIRS[((Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) % 8) + 8) % 8];

// ---------------- 每天 ----------------
export function dailyEra(sim) {
  const E = sim.era;
  if (E.done) return;
  const left = E.floodAt - sim.t;
  // 大水前：观星的人提前一季看出来；前两天大雨下个不停
  if (!E.flooded && left <= 7 * DAY && left > 6 * DAY && tribeKnows(sim, 'stars')) log(sim, '观星的人说：七天之内，大水要来', 'danger');
  if (!E.flooded && left <= 2 * DAY && !E.floodSoon) {
    E.floodSoon = true;
    sim.weather.wet = true; sim.weather.kind = sim.now.season === 3 ? 'snow' : 'rain'; sim.weather.until = E.floodAt + 6 * 60;
    sim.weather.next = null;
    log(sim, '大雨下个不停，河水一天比一天高', 'danger');
  }
  if (!E.flooded && sim.t >= E.floodAt) greatFlood(sim);
  // 河谷被探到了
  const V = sim.map.valley;
  if (!E.valleyKnown && known(sim, V.x, V.y)) { E.valleyKnown = true; log(sim, `探路的人看见一片好河谷：草深、有泉水、林子近（营地${dirWord(sim.camp, V)}边）`, 'season', { valley: true }); }
  // 大水过后迟迟不走：首领自己带着往河谷走（直直地走，不认路）
  if (E.flooded && !sim.march && E.valleyKnown && sim.t >= E.autoAt && dist(sim.camp, V) > K.era.valleyR) {
    const r = startMarch(sim, [{ x: sim.camp.x, y: sim.camp.y }, { x: V.x, y: V.y }], { auto: true });
    if (r.ok) log(sim, `等不来神的指引，${sim.idx[sim.roles.chief]?.name || '族人'}领着大家直直地往河谷走`, 'season');
  }
}

export function greatFlood(sim) {
  const E = sim.era;
  if (E.flooded) return;
  E.flooded = true; E.trialAt = sim.t; E.autoAt = sim.t + 6 * DAY;
  sim.floodPlan = null;
  startFlood(sim, K.era.floodW, 12 * DAY, true);
  // 营地在新河谷就躲过了
  if (!sim.march && dist(sim.camp, sim.map.valley) < K.era.valleyR) {
    log(sim, '旧营地被大水冲平了。幸好族人早就照墨池里看见的，搬到了河谷', 'season');
    finishEra(sim, { startPop: sim.alive.length, deaths: sim.stats.deaths.length, auto: false, early: true });
    return;
  }
  if (sim.march && dist(sim.march.route.at(-1), sim.map.valley) < K.era.valleyR) sim.march.trial = true;
  // 逃到高处：临时营地
  const hp = dryPoint(sim, sim.camp, 150);
  sim.camp.x = hp.x; sim.camp.y = hp.y;
  addFire(sim, hp.x, hp.y, { kind: 'camp', name: '营火', fuel: 10 });
  reveal(sim, hp.x, hp.y, 260);
  for (const p of sim.alive) setJob(sim, p, null);
  sim.assignBeds();
  // 被大水赶出来的狼群，守在去河谷的路上
  const V = sim.map.valley, mx = (hp.x + V.x) / 2, my = (hp.y + V.y) / 2, a = Math.atan2(V.y - hp.y, V.x - hp.x) + Math.PI / 2;
  const off = sim.rng.range(-160, 160);
  const home = { x: clamp(mx + Math.cos(a) * off, 60, sim.map.w - 60), y: clamp(my + Math.sin(a) * off, 60, sim.map.h - 60) };
  for (let i = 0; i < 4; i++) makeBeast(sim, 'wolf', home.x + sim.rng.range(-40, 40), home.y + sim.rng.range(-40, 40), { home, stay: true, hunger: 0.6 });
  sim.stats.trialWolves = 4;
  log(sim, E.valleyKnown ? '族人逃到了高处。用铅笔从营地画一条路到新河谷，带全族过去——路上有被大水赶出来的狼' : '族人逃到了高处。旧营地待不下去了：派人去探路，找一片新的河谷', 'danger', { big: true, trial: true });
}

// ---------------- 迁徙：沿着铅笔画的路走 ----------------
function resample(pts, step = 40) {
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let L = dist(a, b);
    while (acc + L >= step) {
      const k = (step - acc) / L, q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      out.push(q); a = q; L = dist(a, b); acc = 0;
    }
    acc += L;
  }
  const last = pts[pts.length - 1];
  if (dist(out.at(-1), last) > 8 || out.length === 1) out.push({ x: last.x, y: last.y });
  else out[out.length - 1] = { x: last.x, y: last.y };
  return out;
}
export function startMarch(sim, pts, { auto = false } = {}) {
  if (sim.march) return { ok: false, msg: '已经在路上了' };
  if (pts.length < 2) return { ok: false, msg: '路太短了' };
  const end = pts[pts.length - 1];
  if (!known(sim, end.x, end.y)) return { ok: false, msg: '终点还是白纸：先派人去探' };
  if (sim.map.riverDist(end.x, end.y) < RIVER_HALF + 60 || inFlood(sim, end.x, end.y)) return { ok: false, msg: '终点扎不了营（离河太近或在水里）' };
  if (dist(pts[0], sim.camp) > sim.camp.r + 100) pts = [{ x: sim.camp.x, y: sim.camp.y }, ...pts];
  const len = Math.round(pts.slice(1).reduce((n, p, i) => n + dist(pts[i], p), 0));
  if (!len) return { ok: false, msg: '路太短了' };
  const route = resample(pts);
  const V = sim.map.valley, toValley = dist(end, V) < K.era.valleyR;
  const trial = toValley && sim.era.flooded && !sim.era.done;
  const members = sim.alive.filter(p => !p.lost).map(p => p.id);
  if (!members.length) return { ok: false, msg: '没人能上路' };
  sim.march = { route, members, start: sim.t, c: { x: sim.camp.x, y: sim.camp.y }, minI: 0, trial, auto, startPop: members.length, from: { x: sim.camp.x, y: sim.camp.y }, fire: null, deaths: sim.stats.deaths.length };
  sim.stock.water = Math.max(sim.stock.water, members.length * 3);
  for (const id of members) { const p = sim.idx[id]; p.order = null; setJob(sim, p, null); }
  sim.stats.marches = (sim.stats.marches || 0) + 1;
  log(sim, `全族带着火种上路了：${trial ? '去新河谷' : '去新营地'}，路长约 ${len} 步${auto ? '' : '（铅笔画的路）'}`, 'god');
  return { ok: true, march: sim.march, len };
}
// 每一步：队伍的中心、最慢的人走到哪了；到了就安营
export function marchTick(sim) {
  const M = sim.march;
  if (!M) return;
  const ms = M.members.map(id => sim.idx[id]).filter(p => p && p.alive && !p.lost);
  if (!ms.length) { sim.march = null; return; }
  let cx = 0, cy = 0, minI = Infinity, n = 0;
  for (const p of ms) {
    if (p.age < 5) continue;
    cx += p.x; cy += p.y; n++;
    const i = p.job?.kind === 'march' ? p.job.i : null;
    if (i != null) minI = Math.min(minI, i);
  }
  if (n) { M.c.x = cx / n; M.c.y = cy / n; }
  if (minI !== Infinity) M.minI = minI;
  // 路过河边、泉边或下雨：把带的水灌满
  const nearWater = sim.map.riverDist(M.c.x, M.c.y) < RIVER_HALF + 90 || (sim.map.springs || []).some(sp => dist(sp, M.c) < 90) || sim.weather.wet;
  if (nearWater) sim.stock.water = Math.max(sim.stock.water, ms.length * 3);
  // 一路就着带的水和干粮吃喝，不离队；小孩被大人抱着走
  for (const p of ms) {
    if (p.hunger > 0.55) { const f = takeFood(sim, false); if (f) p.hunger = Math.max(0, p.hunger - f.val); }
    if (p.thirst > 0.55 && sim.stock.water >= 1) { sim.stock.water -= 1; p.thirst = 0; }
    if (p.age >= 5) continue;
    const m = p.parents.map(id => sim.idx[id]).find(q => q && q.alive && !q.lost) || ms.find(q => q.age >= 14);
    if (m && !sim.now.bed) { p.x = m.x + 6; p.y = m.y + 4; }
    if (m && p.thirst > m.thirst + 0.1) p.thirst = m.thirst + 0.1; // 大人喝水时也喂抱着的孩子
  }
  const end = M.route[M.route.length - 1];
  const there = ms.filter(p => p.age >= 5 && dist(p, end) < 70).length;
  if (there >= Math.max(1, Math.ceil(n * 0.8))) arrive(sim);
}
// 队伍夜里歇脚：生一堆火
export function marchCampFire(sim) {
  const M = sim.march;
  if (!M) return;
  if (M.fire && dist(M.fire, M.c) < 90) { if (!M.fire.lit) { M.fire.lit = true; M.fire.fuel = 8; } return; }
  if (M.fire) { sim.fires = sim.fires.filter(f => f !== M.fire); delete sim.idx[M.fire.id]; }
  M.fire = addFire(sim, M.c.x, M.c.y, { kind: 'field', name: '篝火', fuel: 10 });
}
function arrive(sim) {
  const M = sim.march, end = M.route[M.route.length - 1];
  if (M.fire) { sim.fires = sim.fires.filter(f => f !== M.fire); delete sim.idx[M.fire.id]; }
  const old = mainFire(sim);
  sim.camp.x = end.x; sim.camp.y = end.y;
  addFire(sim, end.x, end.y, { kind: 'camp', name: '营火', fuel: Math.max(16, old?.fuel || 0) });
  reveal(sim, end.x, end.y, 320);
  sim.march = null;
  recalcLocalBonuses(sim);
  sim.dirty.buildings = true;
  sim.assignBeds();
  for (const p of sim.alive) setJob(sim, p, null);
  const lost = sim.stats.deaths.length - M.deaths, days = Math.round((sim.t - M.start) / DAY * 10) / 10;
  sim.stats.marchDays = days; sim.stats.marchLost = lost;
  log(sim, `走了 ${days} 天，到了${M.trial ? '新河谷' : '新营地'}，生起营火${lost ? `；路上没了 ${lost} 个人` : '，一个人也没少'}`, 'season');
  if (M.trial) finishEra(sim, M);
}
function finishEra(sim, M) {
  const E = sim.era;
  if (sim.alive.length < Math.max(2, M.startPop * K.era.arrive)) {
    log(sim, '到是到了，可一族只剩这几个人……考验没过，再撑下去吧', 'danger');
    E.result = { ok: false, pop: sim.alive.length, startPop: M.startPop };
    return;
  }
  E.done = true; E.doneAt = sim.t;
  E.result = {
    ok: true, day: sim.day, years: +(sim.day / YEAR_DAYS).toFixed(1), pop: sim.alive.length, startPop: M.startPop, lost: sim.stats.deaths.length - M.deaths,
    births: sim.stats.births, deaths: sim.stats.deaths.length, techs: Object.keys(sim.known).filter(k => sim.known[k] > 0).length,
    painted: Object.keys(sim.murals).length, altar: altarStage(sim), merged: !!sim.band?.merged, ink: Math.round(sim.stats.inkSpent),
    geniuses: sim.alive.filter(p => p.genius).length, auto: M.auto, early: !!M.early,
  };
  log(sim, `第一代 · 部落篇：${M.early ? '大水来时，全族已经在新河谷安了家' : '全族走到了新的河谷，在这里扎下了营'}。活下来 ${sim.alive.length} 人`, 'god', { big: true, era: true });
}
