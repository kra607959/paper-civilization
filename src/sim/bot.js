// 机器人玩家：照一套规则当神，拿来测「机器人能不能活过两年」，也当游戏里的「托管」。
// 它和玩家受一样的限制：写符要过真的识别器（合成笔迹 + 手抖），拿不准就从候选里挑、
// 认错了就撤回重写；图纸照淡影加手抖一步步画；墨、木头、石头、人手都和玩家一样紧。
import { DAY, TECHS, K, ERA3_TECH_IDS, ERA3_DESIGNS } from './config.js';
import { dist, known, mainFire, FOG, inFlood, localBuildings, foodTotal } from './util.js';
import { command, targetAt, unlockedCands, verbOf, isLocked, placeDesign, placeFenceLine, scoutRoute, migrate, planField, digCanal, placeCityLine } from './commands.js';
import { RIVER_HALF, nearestRiverPoint } from './mapgen.js';
import { setResearch, techState, tribeKnows } from './tech.js';
import { designLock, altarInk } from './era.js';
import { validateFieldPoly, sowSeasonOk } from './farming.js';
import { grandCanalLock, CANAL_NEEDS } from './era2.js';
import { citySeat, enactCityLaw, repairCityWall, ringCityBell, setCityTax } from './era3.js';
import { BRONZE_GLYPHS, recognizeBronze } from '../recog/bronze.js';
import { BlueprintSession } from '../recog/blueprint.js';
import { symbolById } from '../recog/symbols.js';
import { augment } from '../recog/synth.js';
import { makeRng, hashSeed } from '../recog/rng.js';

const RESERVE = 4; // 留着救急（驱兽、传火）的墨

export function createBot(sim, opts = {}) {
  return {
    sim, rec: opts.recognizer || null, noise: opts.noise ?? 0.8, every: opts.every ?? 30,
    rng: makeRng(hashSeed('bot', sim.seed, opts.salt || 0)), last: -Infinity, fence: null, scoutAt: -Infinity, lostAt: {}, aweAt: -Infinity, marryAt: -Infinity, routeAt: -Infinity, lightAt: -Infinity,
    stats: { writes: 0, accept: 0, pick: 0, reject: 0, elsewhere: 0, wrong: 0, gaveUp: 0, cmds: {}, cmdFail: 0, designs: {}, steps: 0, stepFails: 0, scouts: 0, research: 0, marches: 0 },
  };
}

// 每隔 every 分钟（游戏时间）看一眼局面
export function botTick(bot) {
  const sim = bot.sim;
  if (!sim.alive.length || sim.t - bot.last < bot.every) return;
  bot.last = sim.t;
  if (sim.era3?.active) { botTickEra2(bot); botTickEra3(bot); return; }
  if (sim.era2?.active) { botTickEra2(bot); return; }
  danger(bot);
  fireAndSky(bot);
  research(bot);
  trial(bot);
  const between = sim.era.flooded && !sim.era.done; // 大水冲了旧营地、还没走到新河谷：不在临时营地盖房
  if (!sim.march) { if (!between) build(bot); economy(bot); scout(bot); }
  threats(bot);
  band(bot);
  surplus(bot);
}
// 墨快满了：别浪费。像真人一样，谁闲着就派点活，再降道圣光让大家干活起劲
function surplus(bot) {
  const sim = bot.sim, N = sim.now, P = sim.plan;
  if (N.dark || N.bed || sim.ink < sim.inkMax * 0.55) return;
  if (P.foodDays < 6 || sim.beasts.some(b => !b.dead && !b.gone && b.state === 'stalk' && sim.idx[b.target]?.name)) return; // 吃的不够、有兽在盯人：墨留着
  if (sim.buffs.light < sim.t && sim.t - bot.lightAt >= DAY) {
    bot.lightAt = sim.t;
    // 照在正琢磨手艺的人身上：顺带让他琢磨快些
    const r = sim.research.id && sim.idx[sim.research.by];
    const at = r && r.alive && !r.lost && r.job?.kind === 'study' ? r : sim.camp;
    const t = targetAt(sim, at.x, at.y);
    if (t.ctx === 'folk' && write(bot, { ...t, x: at.x, y: at.y }, 'guang')) return;
  }
  const free = sim.alive.filter(p => p.age >= 14 && !p.order && !(p.sick > 0) && !p.lost).length;
  if (free < 4) return;
  // 派人去干最缺的：打猎晾肉、囤柴、囤石头、拾坚果
  const wants = [];
  if (P.foodDays < 25 && sim.now.season !== 3) wants.push(['hunt', 25 - P.foodDays]);
  if (sim.stock.wood < 150) wants.push(['chop', (150 - sim.stock.wood) / 6]);
  if (sim.stock.stone < 80) wants.push(['quarry', (80 - sim.stock.stone) / 4]);
  if (sim.now.season === 2) wants.push(['gather', 6]);
  wants.sort((a, b) => b[1] - a[1]);
  for (const [job] of wants) {
    if (ordered(sim, job)) continue;
    let t = null;
    if (job === 'hunt') { const h = nearestKnown(sim, sim.herds, h => h.n >= 3 && dist(h, sim.camp) < 1200); if (h) t = targetAt(sim, h.x, h.y); if (t && !(t.ctx === 'beast' && t.kind === 'herd')) t = null; }
    if (job === 'chop') { const f = nearestKnown(sim, sim.map.forests, f => f.trees.some(t => t.alive) && !sim.bans.some(b => b.ref === f.id)); if (f) t = targetAt(sim, f.x, f.y); if (t && t.ctx !== 'wood') t = null; }
    if (job === 'quarry') { const r = nearestKnown(sim, sim.map.rocks, r => r.stone >= 1); if (r) t = targetAt(sim, r.x, r.y); if (t && t.ctx !== 'rock') t = null; }
    if (job === 'gather') { const f = nearestKnown(sim, sim.map.forests, f => f.nuts >= 3); if (f) t = targetAt(sim, f.x, f.y); if (t && t.ctx !== 'wood') t = null; }
    if (t && write(bot, t, job === 'gather' ? 'shu' : 'jian')) return;
  }
}

// 跑一段：模拟和机器人交替
export function runWithBot(sim, bot, minutes, advance) {
  const end = sim.t + minutes;
  while (sim.t < end && sim.alive.length) {
    advance(sim, Math.min(bot.every, end - sim.t));
    botTick(bot);
  }
}

// ---------------- 写符：过识别器 ----------------
// 想写 sym，落在 tgt 上（targetAt 的结果，或天上的 {ctx:'sky', x, y}）。办成了返回 command 的结果
// 界面上「托管」时，bot.onWrite 把每一笔符画出来给人看
function write(bot, tgt, sym) {
  const sim = bot.sim, v = verbOf(tgt.ctx, sym);
  if (!v || sim.ink < v.ink || isLocked(tgt.ctx, sym, sim)) return null;
  const a = { ctx: tgt.ctx, sym, ref: tgt.ref ?? null, x: tgt.x, y: tgt.y };
  if (!bot.rec) { const r = issue(bot, a); bot.onWrite?.({ tgt, sym, strokes: null, decision: 'direct', ok: !!r, r }); return r; }
  const cands = unlockedCands(tgt.ctx, sim), S = bot.stats;
  for (let tries = 0; tries < 3; tries++) {
    const bronze = BRONZE_GLYPHS[sym];
    const strokes = augment(bronze?.strokes || symbolById(sym).make(bot.rng), bot.rng, bot.noise);
    const res = bronze ? recognizeBronze(strokes, cands) : bot.rec.recognize(strokes, { cands });
    S.writes++;
    const shown = (ok, r = null) => bot.onWrite?.({ tgt, sym, strokes, decision: res.decision, top: res.top, choices: res.choices, ok, r });
    if (res.decision === 'accept') {
      if (res.top === sym) { S.accept++; bot.rec.addPersonal(sym, strokes); const r = issue(bot, a); shown(!!r, r); return r; }
      shown(false);
      // 认错了：要确认的（雷火、烧荒）在确认框里就取消了；别的生效了再撤回
      S.wrong++;
      if (!verbOf(tgt.ctx, res.top)?.confirm) { const r = command(sim, { ...a, sym: res.top }); if (r.ok && r.undo) r.undo(); }
      continue;
    }
    if (res.decision === 'pick' && res.choices.includes(sym)) { S.pick++; bot.rec.addPersonal(sym, strokes); const r = issue(bot, a); shown(!!r, r); return r; }
    shown(false);
    if (res.decision === 'elsewhere') S.elsewhere++; else S.reject++;
  }
  S.gaveUp++;
  return null;
}
function issue(bot, a) {
  const r = command(bot.sim, a);
  if (r.ok) bot.stats.cmds[r.key] = (bot.stats.cmds[r.key] || 0) + 1;
  else { bot.stats.cmdFail++; const k = `${a.ctx}:${a.sym} ${String(r.msg || r.why || "").slice(0, 24)}`; (bot.stats.failWhy ||= {})[k] = (bot.stats.failWhy[k] || 0) + 1; }
  return r.ok ? r : null;
}
const spare = (bot, ink) => bot.sim.ink >= ink + RESERVE;

// ---------------- 救急 ----------------
function danger(bot) {
  const sim = bot.sim;
  for (const b of sim.beasts) {
    if (b.dead || b.gone || b.state !== 'stalk' || !known(sim, b.x, b.y)) continue;
    const prey = sim.idx[b.target];
    if (!prey || !prey.name || !prey.alive) continue;
    // 虎吃过人、或在营地附近转：有墨就劈死它（旁边没人才劈）
    const nearCamp = dist(b, sim.march ? sim.march.c : sim.camp) < 700;
    if (b.kind === 'tiger' && sim.ink >= 6 + 2 && (nearCamp || sim.stats.deaths.some(d => d.cause === '虎')) && !sim.alive.some(p => dist(p, b) < 60)) {
      if (write(bot, { ctx: 'sky', x: b.x, y: b.y }, 'huo')) continue;
    }
    const t = targetAt(sim, b.x, b.y);
    if (t.ctx === 'beast') write(bot, t, 'huo');
  }
}

function fireAndSky(bot) {
  const sim = bot.sim, N = sim.now;
  // 营火灭了一个钟头还没人点着，天黑或冷了就传火
  const f = sim.fires.find(x => x.kind !== 'field' && dist(x, sim.camp) < sim.camp.r + 80);
  if (f && !f.lit && sim.t - f.outSince > 60 && (N.dark || N.temp < 10)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'huo');
  if (!f && (N.dark || N.temp < 10)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'huo');
  // 旱了就降雨
  if (sim.weather.drought && !sim.weather.wet) write(bot, { ctx: 'sky' }, 'yu');
  // 人心散了、病倒一片：圣光
  const avg = sim.alive.reduce((s, p) => s + p.morale, 0) / sim.alive.length, sick = sim.alive.filter(p => p.sick > 0).length;
  if (sim.buffs.light < sim.t && (avg < 0.36 || sick >= 3 || (sim.plague && sick >= 2)) && spare(bot, 5)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'guang');
}

// ---------------- 图纸 ----------------
function draw(bot, id) {
  const s = new BlueprintSession(id);
  let fails = 0;
  while (!s.done) {
    const res = s.submit(augment(s.step.ghost, bot.rng, bot.noise));
    bot.stats.steps++;
    if (!res.ok) { bot.stats.stepFails++; if (++fails > 8) return null; }
  }
  return { params: s.params(), strokes: s.strokes };
}
const RING = { hearth: [46, 60], shack: [70, 135], rack: [60, 150], bench: [70, 150], altar1: [150, 240] };
function placePoint(bot, id, d) {
  const sim = bot.sim, c = mainFire(sim) || sim.camp, [r0, r1] = RING[id];
  const a0 = bot.rng() * Math.PI * 2;
  for (let r = r0; r <= r1; r += 14) for (let k = 0; k < 12; k++) {
    const a = a0 + k / 12 * Math.PI * 2;
    const res = placeDesign(sim, id, d.params, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, d.strokes);
    if (res.ok) return res;
  }
  return null;
}
// 陷阱：放在营地外头、林子边上
function placeTrap(bot, d) {
  const sim = bot.sim;
  const fs = sim.map.forests.filter(f => known(sim, f.x, f.y) && dist(f, sim.camp) > 220 && dist(f, sim.camp) < 700).sort((a, b) => dist(a, sim.camp) - dist(b, sim.camp));
  for (const f of fs) {
    const a0 = Math.atan2(sim.camp.y - f.y, sim.camp.x - f.x);
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5, r = f.r + 30;
      const res = placeDesign(sim, 'trap', d.params, f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, d.strokes);
      if (res.ok) return res;
    }
  }
  return null;
}
function placeRing(bot, d) {
  const sim = bot.sim, c = mainFire(sim) || sim.camp, pts = [];
  for (let k = 0; k <= 20; k++) {
    const a = (k % 20) / 20 * Math.PI * 2;
    let r = sim.camp.r + 40;
    while (r > 90 && sim.map.riverDist(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r) < RIVER_HALF + 14) r -= 10;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return placeFenceLine(sim, d.params, pts, d.strokes);
}
function build(bot) {
  const sim = bot.sim, P = sim.plan;
  const has = t => sim.buildings.filter(b => b.type === t).length + sim.sites.filter(s => s.type === t).length;
  const open = sim.sites.filter(s => s.type !== 'fenceSeg').length;
  if (open >= 2) return;
  const cap = list => list.filter(s => s.type === 'shack').reduce((s, x) => s + (x.cap ?? x.params.cap), 0);
  const housing = cap(sim.buildings) + cap(sim.sites);
  let want = null;
  if (!has('hearth')) want = 'hearth';
  else if (housing < sim.alive.length + 1 && has('shack') < 6) want = 'shack';
  else if (has('rack') < 1 && sim.day >= 3) want = 'rack';
  else if (has('rack') < 2 && sim.day >= 9) want = 'rack';
  else if (!bot.fence && sim.day >= 12 && sim.stock.wood >= 25 && (sim.now.season !== 2 || P.foodDays >= 8)) want = 'fence';
  else if (has('rack') < 3 && sim.alive.length >= 13 && sim.day >= 30) want = 'rack';
  // 第一代后半：石器台、陷阱、祭坛三段
  const altarBusy = sim.sites.some(s => s.type.startsWith('altar'));
  if (!want && !has('bench') && !designLock(sim, 'bench') && sim.day >= 10 && P.foodDays >= 5) want = 'bench';
  if (!want && has('trap') < 2 && !designLock(sim, 'trap') && sim.stock.wood >= 10) want = 'trap';
  // 祭坛是大工程：头一年先顾吃住，开春以后、存粮够吃几天才动工
  if (!want && !altarBusy && sim.alive.length >= 7 && sim.day >= 28 && sim.now.season !== 3 && P.foodDays >= 4) {
    for (const id of ['altar1', 'altar2', 'altar3']) if (!designLock(sim, id) && spare(bot, altarInk(id))) { want = id; break; }
  }
  if (!want) return;
  const d = draw(bot, want);
  if (!d) return;
  const res = want === 'fence' ? placeRing(bot, d) : want === 'trap' ? placeTrap(bot, d) : want === 'altar2' || want === 'altar3' ? placeDesign(sim, want, d.params, 0, 0, d.strokes) : placePoint(bot, want, d);
  if (res && res.ok) {
    bot.stats.designs[want] = (bot.stats.designs[want] || 0) + 1;
    if (want === 'fence') bot.fence = res.fence;
    bot.onDesign?.({ id: want, params: d.params, strokes: d.strokes, res });
  }
}

// ---------------- 吃的、柴、石头 ----------------
const ordered = (sim, job) => sim.orders.some(o => o.job === job && !o.done);
function nearestKnown(sim, list, ok = () => true) {
  let best = null, bd = Infinity;
  for (const x of list) {
    if (!ok(x) || !known(sim, x.x, x.y)) continue;
    const d = dist(x, sim.camp);
    if (d < bd) { bd = d; best = x; }
  }
  return best;
}
function riverSpot(sim) {
  const pts = sim.map.river;
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length; i += 3) { const d = dist(pts[i], sim.camp); if (d < bd && known(sim, pts[i].x, pts[i].y)) { bd = d; best = pts[i]; } }
  return best;
}
function economy(bot) {
  const sim = bot.sim, P = sim.plan, season = sim.now.season, N = sim.now;
  if (N.dark || N.bed) return; // 夜里不派活
  const racks = sim.buildings.filter(b => b.type === 'rack');
  // 打猎：架子空着就去打，晾成干肉过冬；冬天缺吃的也去打（鹿跑远了）
  const herdOk = h => h.n >= (season === 3 ? 2 : 4) && dist(h, sim.camp) < 1400;
  if (!ordered(sim, 'hunt') && ((racks.length && P.rackFree >= 8 && season !== 3 && P.foodDays < 20) || (season === 2 && P.foodDays < 12) || (season === 3 && P.foodDays < 3) || P.foodDays < 1)) {
    const h = nearestKnown(sim, sim.herds, herdOk);
    if (h) {
      const t = targetAt(sim, h.x, h.y);
      if (t.ctx === 'beast' && t.kind === 'herd') {
        if (!(season >= 1 && racks.length && spare(bot, 3) && write(bot, t, 'qi'))) if (spare(bot, 2)) write(bot, t, 'jian');
      }
    }
  }
  // 秋天拾坚果（能放二十天）
  if (season === 2 && !ordered(sim, 'gather') && spare(bot, 1)) {
    const f = nearestKnown(sim, sim.map.forests, f => f.nuts >= 3);
    if (f) { const t = targetAt(sim, f.x, f.y); if (t.ctx === 'wood') write(bot, t, 'shu'); }
  }
  // 冬天、或吃的见底：叉鱼；秋天存粮不够过冬也去叉（鱼也能晾成干）
  if ((season === 3 ? P.foodDays < 3 : season === 2 ? P.foodDays < 12 : P.foodDays < 1.2) && !ordered(sim, 'fish') && spare(bot, 1)) {
    const r = riverSpot(sim);
    if (r) { const t = targetAt(sim, r.x, r.y); if (t.ctx === 'river') write(bot, t, 'jian'); }
  }
  // 吃的见底、不是冬天：近处采集
  if (season !== 3 && P.foodDays < 1.2 && !ordered(sim, 'gather') && spare(bot, 1)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'shu');
  // 柴：工地缺木头、或入冬前柴不够
  const woodWant = Math.min(60, (P.siteNeed?.wood || 0)) + (season >= 2 ? 30 : 12);
  if (sim.stock.wood < woodWant && !ordered(sim, 'chop') && spare(bot, 1)) {
    const f = nearestKnown(sim, sim.map.forests, f => f.trees.some(t => t.alive) && !sim.bans.some(b => b.ref === f.id));
    if (f) { const t = targetAt(sim, f.x, f.y); if (t.ctx === 'wood') write(bot, t, 'jian'); }
  }
  // 河堤：会编筐了，营地离河近，就在最近的河岸筑一道
  if (tribeKnows(sim, 'basket') && !sim.levees.length && !sim.sites.some(s => s.type === 'levee') && sim.map.riverDist(sim.camp.x, sim.camp.y) < 300 && spare(bot, 3) && sim.day >= 20) {
    const q = nearestRiverPoint(sim.map, sim.camp);
    if (q && known(sim, q.x, q.y)) { const t = targetAt(sim, q.x, q.y); if (t.ctx === 'river') write(bot, t, 'shan'); }
  }
  // 石头：工地缺石头
  if (P.stoneNeed > 0 && !ordered(sim, 'quarry') && spare(bot, 1)) {
    const r = nearestKnown(sim, sim.map.rocks, r => r.stone >= 1);
    if (r) { const t = targetAt(sim, r.x, r.y); if (t.ctx === 'rock') write(bot, t, 'jian'); }
  }
}

// ---------------- 探路（铅笔，不费墨） ----------------
function unknownAlong(sim, a, d0, d1) {
  let n = 0, m = 0;
  for (let d = d0; d <= d1; d += 50) {
    const x = sim.camp.x + Math.cos(a) * d, y = sim.camp.y + Math.sin(a) * d;
    if (x < 0 || y < 0 || x > sim.map.w || y > sim.map.h) continue;
    m++;
    if (!known(sim, x, y)) n++;
  }
  return m ? n / m : 0;
}
function scout(bot) {
  const sim = bot.sim;
  if (sim.now.dark || sim.now.bed || ordered(sim, 'scout')) return;
  const every = sim.day < 6 ? DAY * 0.8 : 6 * DAY;
  if (sim.t - bot.scoutAt < every || sim.revealed / (FOG.cols * FOG.rows) > 0.8) return;
  let best = null, bs = 0.25;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, s = unknownAlong(sim, a, 400, 1100);
    if (s > bs) { bs = s; best = a; }
  }
  if (best == null) return;
  const c = sim.camp, at = (a, d) => ({ x: Math.max(30, Math.min(sim.map.w - 30, c.x + Math.cos(a) * d)), y: Math.max(30, Math.min(sim.map.h - 30, c.y + Math.sin(a) * d)) });
  const res = scoutRoute(sim, [at(best - 0.25, 300), at(best - 0.2, 750), at(best + 0.15, 1050), at(best + 0.35, 700), at(best + 0.3, 300)]);
  bot.scoutAt = sim.t;
  if (res.ok) bot.stats.scouts++;
}

// ---------------- 研究：照一张单子挑；快入冬还没有皮衣就先学兽皮衣，闹热病就先学草药 ----------------
const ORDER = ['knap', 'hide', 'keepfire', 'forage', 'drive', 'basket', 'burial', 'smoke', 'harpoon', 'mural', 'herb', 'dance', 'needle', 'longhouse', 'trap', 'dog', 'raft', 'stars'];
function research(bot) {
  const sim = bot.sim, R = sim.research;
  if (R.id && !R.auto) return;
  const open = ORDER.filter(id => techState(sim, id) === 'open');
  if (!open.length) return;
  let pick = open[0];
  if (open.includes('hide') && sim.now.season >= 1) pick = 'hide';
  if (open.includes('herb') && sim.plague) pick = 'herb';
  if (R.id === pick) { R.auto = false; return; }
  const r = setResearch(sim, pick);
  if (r.ok) bot.stats.research++;
}

// ---------------- 天灾：蝗虫、走失 ----------------
function threats(bot) {
  const sim = bot.sim;
  for (const b of sim.beasts) {
    if (b.kind !== 'swarm' || b.dead || b.gone || !known(sim, b.x, b.y) || b.state === 'flee') continue;
    if (dist(b, sim.camp) > 1000) continue;
    if (spare(bot, 6) && !sim.alive.some(p => dist(p, b) < 60)) { if (write(bot, { ctx: 'sky', x: b.x, y: b.y }, 'huo')) continue; }
    const t = targetAt(sim, b.x, b.y);
    if (t.ctx === 'beast' && t.ref === b.id && spare(bot, 2)) write(bot, t, 'huo');
  }
  // 有人走失：铅笔画一条探路的线，绕着他最后出现的地方走一圈
  if (sim.now.dark || sim.now.bed) return;
  for (const p of sim.alive) {
    if (!p.lost || sim.t - (bot.lostAt[p.id] || -Infinity) < DAY * 0.6) continue;
    bot.lostAt[p.id] = sim.t;
    const L = p.lost, c = sim.march ? sim.march.c : sim.camp, r = 160;
    const pts = [{ x: c.x, y: c.y }];
    for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI * 2; pts.push({ x: Math.max(30, Math.min(sim.map.w - 30, L.x + Math.cos(a) * r)), y: Math.max(30, Math.min(sim.map.h - 30, L.y + Math.sin(a) * r)) }); }
    pts.push({ x: c.x, y: c.y });
    const res = scoutRoute(sim, pts);
    if (res.ok) bot.stats.scouts++;
    break;
  }
}

// ---------------- 外族：送火、结亲、显灵；夜里来偷的赶走 ----------------
function band(bot) {
  const sim = bot.sim, B = sim.band;
  if (!B || !B.met || B.merged || B.gone) return;
  const camp = known(sim, B.x, B.y) ? targetAt(sim, B.x, B.y) : null;
  const ask = sim.strangers.find(z => z.task === 'ask' && z.state === 'go');
  const tgtOf = z => { const t = targetAt(sim, z.x, z.y); return t.ctx === 'band' ? t : null; };
  // 来偷的：赶走
  const thief = sim.strangers.find(z => (z.task === 'fire' || z.task === 'food') && z.state === 'go' && dist(z, sim.camp) < 500 && known(sim, z.x, z.y));
  if (thief && spare(bot, 2)) { const t = tgtOf(thief); if (t && write(bot, t, 'jian')) return; }
  // 他们的火灭了：送火
  if (!B.fire && (ask || sim.t - B.fireOut > DAY * 0.4) && spare(bot, 2)) {
    const t = (ask && tgtOf(ask)) || (camp?.ctx === 'band' ? camp : null);
    if (t && write(bot, t, 'huo')) return;
  }
  if (!camp || camp.ctx !== 'band' || sim.now.dark) return;
  // 关系还行：结亲（一年一回）
  if (B.mood >= 0.25 && B.marriages < 2 && sim.t - bot.marryAt > 20 * DAY && sim.day >= 30 && spare(bot, 3)) {
    bot.marryAt = sim.t;
    if (write(bot, camp, 'qi')) return;
  }
  // 墨多：显灵拉近关系（一季一回）
  if (B.mood < 0.75 && sim.ink >= sim.inkMax * 0.75 && spare(bot, 5) && sim.t - bot.aweAt > 7 * DAY && sim.day >= 21) {
    bot.aweAt = sim.t;
    write(bot, camp, 'guang');
  }
}

// ---------------- 时代考验：大水之后画路去新河谷 ----------------
function trial(bot) {
  const sim = bot.sim, E = sim.era;
  if (!E.flooded || E.done || sim.march || !E.valleyKnown || sim.now.dark || sim.now.bed) return;
  if (sim.t - bot.routeAt < DAY * 0.5) return;
  bot.routeAt = sim.t;
  const V = sim.map.valley;
  if (dist(sim.camp, V) < 170) return;
  const pts = planRoute(sim, sim.camp, V);
  const res = migrate(sim, pts);
  if (res.ok) bot.stats.marches++;
}
// 离水边不到 70 步也算水里（人走的是直线，贴着水边走会踩进去）
function nearFlood(sim, x, y) {
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (inFlood(sim, x + Math.cos(a) * 70, y + Math.sin(a) * 70)) return true; }
  return false;
}
// 在地图上按 40 步一格找一条路：绕开大水、河、虎窝、虎和狼，白纸的地方少走
export function planRoute(sim, a, b) {
  const C = 40, W = Math.ceil(sim.map.w / C), H = Math.ceil(sim.map.h / C);
  const avoid = [];
  if (sim.map.lair) avoid.push({ x: sim.map.lair.x, y: sim.map.lair.y, r: 480, c: 8 });
  for (const w of sim.beasts) if (!w.dead && !w.gone && w.kind !== 'swarm' && known(sim, w.x, w.y)) avoid.push({ x: w.x, y: w.y, r: w.kind === 'tiger' ? 420 : 320, c: w.kind === 'tiger' ? 12 : 8 });
  const cost = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x * C + C / 2, py = y * C + C / 2;
    let c = 1;
    if (sim.flood && sim.map.riverDist(px, py) < 28 + sim.flood.w + 70 && (inFlood(sim, px, py) || nearFlood(sim, px, py))) c = Infinity;
    else {
      const rd = sim.map.riverDist(px, py);
      if (rd < RIVER_HALF + 40) c += 40;
      for (const o of avoid) { const d = Math.hypot(px - o.x, py - o.y); if (d < o.r) c += o.c * (1 - d / o.r) + 2; }
      if (!known(sim, px, py)) c += 1.5;
    }
    cost[y * W + x] = c;
  }
  const cell = q => [Math.max(0, Math.min(W - 1, Math.floor(q.x / C))), Math.max(0, Math.min(H - 1, Math.floor(q.y / C)))];
  const [sx, sy] = cell(a), [gx, gy] = cell(b);
  const S = sy * W + sx, G = gy * W + gx;
  cost[S] = Math.min(cost[S], 1); cost[G] = Math.min(cost[G], 1);
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), shut = new Uint8Array(W * H);
  const heap = [];
  const push = (i, f) => { heap.push([f, i]); let n = heap.length - 1; while (n > 0) { const m = (n - 1) >> 1; if (heap[m][0] <= heap[n][0]) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
  const hx = i => Math.hypot(i % W - gx, Math.floor(i / W) - gy);
  g[S] = 0; push(S, hx(S));
  while (heap.length) {
    const [, i] = pop();
    if (shut[i]) continue;
    shut[i] = 1;
    if (i === G) break;
    const x = i % W, y = Math.floor(i / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
      const j = ny * W + nx, c = cost[j];
      if (c === Infinity || shut[j]) continue;
      const ng = g[i] + c * (dx && dy ? 1.414 : 1);
      if (ng < g[j]) { g[j] = ng; from[j] = i; push(j, ng + hx(j)); }
    }
  }
  if (from[G] < 0) return [a, b]; // 找不到路：硬走直线
  const cells = [];
  for (let i = G; i >= 0; i = from[i]) { cells.push(i); if (i === S) break; }
  cells.reverse();
  const pts = [{ x: a.x, y: a.y }];
  for (let n = 3; n < cells.length - 1; n += 3) pts.push({ x: (cells[n] % W) * C + C / 2, y: Math.floor(cells[n] / W) * C + C / 2 });
  pts.push({ x: b.x, y: b.y });
  return pts;
}

// ---------------- 第二代（农耕时代）机器人 ----------------
const ORDER_ERA2 = ['plow', 'pottery', 'sow', 'irrigate', 'bridge', 'granary', 'husbandry', 'weave', 'calendar', 'rotation', 'mill', 'timberhouse', 'brew', 'knot', 'villageRule', 'net', 'canoe', 'herbgarden'];

function botTickEra2(bot) {
  const sim = bot.sim;
  danger(bot);
  fireAndSky(bot);
  if (!sim.era3?.active) researchEra2(bot);
  if (!sim.march) {
    buildEra2(bot);
    farmAndCanalEra2(bot);
    economy(bot);
    scout(bot);
  }
  threats(bot);
  raidersEra2(bot);
  villageEra2(bot);
  surplusEra2(bot);
}

function researchEra2(bot) {
  const sim = bot.sim, R = sim.research;
  if (R.id && !R.auto) return;
  const open = ORDER_ERA2.filter(id => techState(sim, id) === 'open');
  if (!open.length) return;
  let pick = open[0];
  if (open.includes('irrigate') && (sim.era2.drought || sim.weather.drought)) pick = 'irrigate';
  if (open.includes('granary') && sim.fields.some(f => f.harvests > 0)) pick = 'granary';
  if (R.id === pick) { R.auto = false; return; }
  const r = setResearch(sim, pick);
  if (r.ok) bot.stats.research++;
}

const RING2 = { hearth: [46, 80], shack: [75, 165], timberhouse: [75, 195], rack: [65, 175], bench: [70, 175], kiln: [80, 210], granary: [80, 210], pen: [130, 260] };
function placeLocalPoint(bot, id, d) {
  const sim = bot.sim, c = mainFire(sim) || sim.camp, [r0, r1] = RING2[id] || [70, 190];
  const a0 = bot.rng() * Math.PI * 2;
  for (let r = r0; r <= (ERA3_DESIGNS.includes(id) ? 375 : r1); r += 16) for (let k = 0; k < 14; k++) {
    const a = a0 + k / 14 * Math.PI * 2;
    const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
    if (sim.fields.some(f => Math.hypot(f.cx - x, f.cy - y) < 85)) continue;
    const res = placeDesign(sim, id, d.params, x, y, d.strokes);
    if (res.ok) return res;
  }
  return null;
}

function buildEra2(bot) {
  const sim = bot.sim, P = sim.plan;
  const hasLocal = t => localBuildings(sim, t).length + sim.sites.filter(s => s.type === t && dist(s, sim.camp) <= K.campActiveR).length;
  const open = sim.sites.filter(s => s.type !== 'fenceSeg').length;
  if (open >= 2) return;
  const cap = list => list.filter(s => (s.type === 'shack' || s.type === 'timberhouse') && dist(s, sim.camp) <= K.campActiveR).reduce((s, x) => s + (x.cap ?? x.params?.cap ?? 4), 0);
  const housing = cap(sim.buildings) + cap(sim.sites);
  let want = null;
  if (!hasLocal('hearth')) want = 'hearth';
  else if (housing < sim.alive.length + 2) want = !designLock(sim, 'timberhouse') ? 'timberhouse' : 'shack';
  else if (!hasLocal('rack')) want = 'rack';
  else if (!hasLocal('bench') && !designLock(sim, 'bench')) want = 'bench';
  else if (!hasLocal('kiln') && !designLock(sim, 'kiln')) want = 'kiln';
  else if (!hasLocal('granary') && !designLock(sim, 'granary')) want = 'granary';
  else if (!hasLocal('pen') && !designLock(sim, 'pen')) want = 'pen';
  else if (!sim.buildings.concat(sim.sites).some(b => b.type === 'bridge' && dist(b, sim.camp) < 700) && !designLock(sim, 'bridge') && sim.stock.wood >= 12) want = 'bridge';
  if (!want) return;
  const d = draw(bot, want);
  if (!d) return;
  let res = null;
  if (want === 'bridge') {
    const q = nearestRiverPoint(sim.map, sim.camp);
    if (q && known(sim, q.x, q.y)) res = placeDesign(sim, 'bridge', d.params, q.x, q.y, d.strokes);
  } else res = placeLocalPoint(bot, want, d);
  if (res && res.ok) {
    bot.stats.designs[want] = (bot.stats.designs[want] || 0) + 1;
    bot.onDesign?.({ id: want, params: d.params, strokes: d.strokes, res });
  }
}

// 避开石堆找一条挖水渠路径
function planCanalRoute(sim, a, b) {
  const C = 40, W = Math.ceil(sim.map.w / C), H = Math.ceil(sim.map.h / C);
  const cost = new Float32Array(W * H).fill(1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x * C + C / 2, py = y * C + C / 2;
    if (!known(sim, px, py)) { cost[y * W + x] = Infinity; continue; }
    for (const r of sim.map.rocks) if (Math.hypot(px - r.x, py - r.y) < r.r + 22) { cost[y * W + x] = Infinity; break; }
  }
  const cell = q => [Math.max(0, Math.min(W - 1, Math.floor(q.x / C))), Math.max(0, Math.min(H - 1, Math.floor(q.y / C)))];
  const [sx, sy] = cell(a), [gx, gy] = cell(b), S = sy * W + sx, G = gy * W + gx;
  cost[S] = 1; cost[G] = 1;
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), shut = new Uint8Array(W * H);
  const q = [[0, S]];
  g[S] = 0;
  while (q.length) {
    q.sort((u, v) => u[0] - v[0]);
    const [, i] = q.shift();
    if (shut[i]) continue;
    shut[i] = 1;
    if (i === G) break;
    const x = i % W, y = Math.floor(i / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
      const j = ny * W + nx;
      if (cost[j] === Infinity || shut[j]) continue;
      const ng = g[i] + (dx && dy ? 1.414 : 1);
      if (ng < g[j]) { g[j] = ng; from[j] = i; q.push([ng + Math.hypot(nx - gx, ny - gy), j]); }
    }
  }
  if (from[G] < 0) return [a, b];
  const cells = [];
  for (let i = G; i >= 0; i = from[i]) { cells.push(i); if (i === S) break; }
  cells.reverse();
  const pts = [{ x: a.x, y: a.y }];
  for (let n = 2; n < cells.length - 1; n += 2) pts.push({ x: (cells[n] % W) * C + C / 2, y: Math.floor(cells[n] / W) * C + C / 2 });
  pts.push({ x: b.x, y: b.y });
  return pts;
}

function farmAndCanalEra2(bot) {
  const sim = bot.sim, c = sim.camp;
  // 河鱼太远、粮日不够时扩田，不用一套固定的三块田养所有河谷。
  const remote = sim.map.riverDist(c.x, c.y) > 520;
  const targetFields = remote && sim.plan.foodDays < 10 ? 6 : 3;
  if (sim.fields.length < targetFields && (!bot.fieldAt || sim.t - bot.fieldAt > 8 * 60)) {
    bot.fieldAt = sim.t;
    const baseA = (sim.fields.length * 1.9) + 0.6;
    for (let k = 0; k < (remote ? 36 : 10); k++) {
      const a = baseA + k * 0.62, r = 135 + (k % 3) * 45 + (remote ? Math.floor(k / 12) * 60 : 0);
      const cx = c.x + Math.cos(a) * r, cy = c.y + Math.sin(a) * r, hw = remote && sim.fields.length >= 3 && k < 24 ? 63 : 48;
      const pts = [{ x: cx - hw, y: cy - hw }, { x: cx + hw, y: cy - hw }, { x: cx + hw, y: cy + hw }, { x: cx - hw, y: cy + hw }, { x: cx - hw, y: cy - hw }];
      if (validateFieldPoly(sim, pts).ok) {
        const res = planField(sim, pts);
        if (res.ok) { bot.stats.fields = (bot.stats.fields || 0) + 1; break; }
      }
    }
  }
  // 2. 从泉/河往田边修一条普通引水渠
  if (sim.fields.length >= 1 && !sim.canals.some(cn => !cn.grandStage) && (!bot.canalAt || sim.t - bot.canalAt > DAY)) {
    bot.canalAt = sim.t;
    const f = sim.fields[0];
    const sp = sim.map.springs?.[0];
    const src = sp && known(sim, sp.x, sp.y) && dist(sp, f) < 420 ? sp : nearestRiverPoint(sim.map, f);
    if (src && known(sim, src.x, src.y)) {
      const pts = planCanalRoute(sim, src, { x: f.cx, y: f.cy });
      digCanal(sim, pts);
    }
  }
  // 3. 大渠三段时代工程
  const nextStage = (sim.era2.canal.stage || 0) + 1;
  if (nextStage <= 3 && !grandCanalLock(sim, nextStage) && spare(bot, K.era2.canalInk[nextStage - 1])) {
    const N = sim.era2.canal.nodes, V = sim.map.valley || c;
    const [p0, p1] = nextStage === 1 ? [N.intake, N.hub] : nextStage === 2 ? [N.hub, V] : [V, N.outfall];
    if (p0 && p1 && known(sim, p0.x, p0.y) && known(sim, p1.x, p1.y)) {
      const pts = planCanalRoute(sim, p0, p1);
      const r = digCanal(sim, pts, { grandStage: nextStage });
      if (r.ok) bot.stats.grandCanals = (bot.stats.grandCanals || 0) + 1;
    }
  }
  // 4. 农事写符：播种、收割、驱虫、浇灌
  if (sim.now.dark || sim.now.bed) return;
  for (const f of sim.fields) {
    const tgt = { ctx: 'field', ref: f.id, x: f.cx, y: f.cy, name: f.name };
    if (f.state === 'ripe' && !f.harvested && !ordered(sim, 'harvestField') && spare(bot, 1)) {
      if (write(bot, tgt, 'jian')) return;
    }
    if (f.state === 'fallow' && sowSeasonOk(sim) && !ordered(sim, 'sowField') && spare(bot, 1)) {
      if (write(bot, tgt, 'shu')) return;
    }
    if (remote && sim.plan.foodDays < 6 && tribeKnows(sim, 'calendar') && spare(bot, verbOf('field', 'guang').ink) &&
        (f.state === 'fallow' && !sowSeasonOk(sim) || f.state === 'growing' && f.growth >= 0.35)) {
      if (write(bot, tgt, 'guang')) return;
    }
    if (f.pest > 0.25 && spare(bot, 2)) {
      if (write(bot, tgt, 'huo')) return;
    }
    if (f.state === 'growing' && f.moisture < 0.42 && spare(bot, 2)) {
      if (write(bot, tgt, 'shui')) return;
    }
  }
}

function raidersEra2(bot) {
  const sim = bot.sim;
  if (!sim.raiders?.length) return;
  const rd = sim.raiders.find(r => !r.dead && !r.gone && r.state === 'go');
  if (!rd) return;
  if (spare(bot, 2)) write(bot, { ctx: 'beast', ref: rd.id, x: rd.x, y: rd.y, name: rd.name, kind: 'raider' }, 'huo');
}

function villageEra2(bot) {
  const sim = bot.sim, V = sim.village;
  if (!V || sim.now.dark) return;
  const tgt = { ctx: 'village', ref: 'village', x: V.x, y: V.y, name: V.name };
  if (V.damming && spare(bot, 2) && (!bot.vWaterAt || sim.t - bot.vWaterAt > 3 * DAY)) {
    bot.vWaterAt = sim.t;
    if (V.mood >= 0) { if (write(bot, tgt, 'shui')) return; }
    else if (spare(bot, 5) && write(bot, tgt, 'guang')) return;
  }
  if ((!bot.vTradeAt || sim.t - bot.vTradeAt > 12 * DAY) && foodTotal(sim) >= 12 && spare(bot, 2)) {
    bot.vTradeAt = sim.t;
    write(bot, tgt, 'qi');
  }
}

function surplusEra2(bot) {
  const sim = bot.sim, N = sim.now;
  if (N.dark || N.bed || sim.ink < sim.inkMax * 0.65) return;
  if (sim.buffs.light < sim.t && sim.t - bot.lightAt >= DAY) {
    bot.lightAt = sim.t;
    const r = sim.research.id && sim.idx[sim.research.by];
    const at = r && r.alive && !r.lost && r.job?.kind === 'study' ? r : sim.camp;
    const t = targetAt(sim, at.x, at.y);
    if (t.ctx === 'folk' && write(bot, { ...t, x: at.x, y: at.y }, 'guang')) return;
  }
  surplus(bot);
}

// 第三代托管：沿用农耕保供，自动照青铜图纸建造，写新符也先经过识别。
const CITY_BUILD_ORDER = ['furnace', 'cartway', 'workshop', 'citywall', 'market', 'palace', 'temple', 'bell'];
const CITY_RESEARCH = ['smelt', 'wheel', 'alloy', 'bronzeWalls', 'script', 'measure', 'law', 'rites', 'chariot', 'post', 'tribute', 'astronomy', 'divination'];
function botTickEra3(bot) {
  const sim = bot.sim, E = sim.era3, N = sim.now;
  if (N.dark || N.bed) return;
  if (!sim.research.id || sim.research.auto) {
    const id = CITY_RESEARCH.find(id => techState(sim, id) === 'open');
    if (id) setResearch(sim, id);
    else researchEra2(bot);
  }
  if ((!bot.cityBuildAt || sim.t >= bot.cityBuildAt) && sim.sites.filter(s => ERA3_DESIGNS.includes(s.type)).length < 2) {
    bot.cityBuildAt = sim.t + DAY / 2;
    for (const id of CITY_BUILD_ORDER) {
      if (designLock(sim, id) || (id === 'bell' && sim.stock.bronze < 20)) continue;
      const d = draw(bot, id);
      if (!d) continue;
      let r;
      if (id === 'citywall') {
        for (const rad of [135, 105, 85]) {
          const pts = Array.from({ length: 17 }, (_, i) => {
            const a = (i % 16) / 16 * Math.PI * 2;
            return { x: sim.camp.x + rad * Math.cos(a), y: sim.camp.y + rad * Math.sin(a) };
          });
          r = placeCityLine(sim, id, d.params, pts, d.strokes);
          if (r.ok) break;
        }
      } else if (id === 'cartway') {
        for (const ward of E.villages) {
          scoutCityRoad(sim, ward);
          r = placeCityLine(sim, id, d.params, [{ ...sim.camp }, ward], d.strokes);
          if (r.ok) break;
        }
      } else r = placeLocalPoint(bot, id, d);
      if (r?.ok) {
        bot.stats.designs[id] = (bot.stats.designs[id] || 0) + 1;
        bot.onDesign?.({ id, params: d.params, strokes: d.strokes, res: r });
        break;
      }
    }
  }
  const c = localBuildings(sim, 'palace')[0] || citySeat(sim);
  const target = { ctx: 'city', ref: 'city', x: c.x, y: c.y, name: '城务台' };
  const trial = !!E.trial || E.trialAt - sim.t <= 7 * DAY;
  const order = id => !(E.next[id] > sim.t) && spare(bot, BRONZE_GLYPHS[id].ink) && write(bot, target, id);
  if (E.guards < (trial ? 24 : 10) && E.treasury >= 4 && order('recruit')) return;
  if (trial) {
    const wall = localBuildings(sim, 'citywall')[0];
    if (wall && wall.integrity < 0.87) repairCityWall(sim);
    if (E.bellUntil < sim.t + DAY) ringCityBell(sim);
    if (E.guardUntil < sim.t + DAY && order('guard')) return;
    if (E.ritualUntil < sim.t + DAY && order('ritual')) return;
    if (E.law !== 'guard' && E.scripture.guard) enactCityLaw(sim, 'guard');
  } else {
    if (E.bell && E.bellUntil <= sim.t && sim.ink >= sim.inkMax * 0.72) ringCityBell(sim);
    if (E.patrolUntil < sim.t + DAY && order('patrol')) return;
    if (E.unrest > 0.35 && order('ritual')) return;
    if (E.unrest > 0.42 && E.tax !== 'relief') setCityTax(sim, 'relief');
    if (sim.t >= (bot.cityTradeAt || 0) && localBuildings(sim, 'market').length) {
      bot.cityTradeAt = sim.t + 2 * DAY;
      const target = [...E.rivals].filter(r => r.mood < 0.84 && !E.convoys.some(q => q.ref === r.id)).sort((a, b) => a.mood - b.mood)[0];
      if (target) write(bot, { ctx: 'polis', ref: target.id, x: target.x, y: target.y, name: target.name }, 'trade');
    }
  }
}

function scoutCityRoad(sim, ward) {
  const c = sim.camp;
  // 托管同样要探路：路中仍有白纸，就派人沿线走一趟。
  if (sim.orders.some(o => o.job === 'scout' && !o.done)) return;
  const need = Array.from({ length: 9 }, (_, i) => ({ x: c.x + (ward.x - c.x) * i / 8, y: c.y + (ward.y - c.y) * i / 8 }));
  if (need.some(p => !known(sim, p.x, p.y))) scoutRoute(sim, need);
}
