// 第二代 · 农耕时代（彩陶）：
// 换代不清空、户籍体系、大渠三段时代工程、青陶村交涉、旱涝鼠虫劫掠与「鲧堵禹疏」大水分洪考验。
import { K, DAY, YEAR_DAYS, SEASON_DAYS, TECHS, GENIUS } from './config.js';
import { dist, clamp, log, reveal, known, foodTotal, addFood, recalcLocalBonuses, localBuildings, inFlood } from './util.js';
import { seasonOf, yearOf } from './calendar.js';
import { RIVER_HALF, nearestRiverPoint } from './mapgen.js';
import { makeRng, hashSeed } from '../recog/rng.js';
import { tribeKnows, learn } from './tech.js';
import { addCanal, updateCanalNetwork, startSowField } from './farming.js';
import { addBarrier, removeBarrier, makeBeast } from './beasts.js';
import { setJob, die, injure } from './people.js';
import { segIntersect, pointInPolygon } from '../recog/geom.js';

export const CANAL_STAGE_NAMES = { 1: '大渠·引水干渠', 2: '大渠·谷中灌渠', 3: '大渠·分洪尾渠' };
export const CANAL_NEEDS = { 1: 'irrigate', 2: 'granary', 3: 'calendar' };

export function initEra2(sim) {
  sim.era2 = {
    active: false, startedAt: 0, startDay: 0,
    canal: { stage: 0, nodes: null, stages: { 1: null, 2: null, 3: null } },
    floodAt: 0, floodSoon: false, flooded: false, floodActive: false, floodUntil: 0, diverted: false,
    drought: false, droughtUntil: 0, waterlog: false, waterlogUntil: 0,
    ev: { drought: 0, waterlog: 0, rat: 0, pest: 0, raid: 0, fest: 0 },
    done: false, doneAt: 0, result: null,
  };
  sim.households = [];
  sim.village = null;
  sim.raiders = [];
}

export const canEnterEra2 = sim => !!(sim.era?.done && sim.era?.result?.ok && !sim.era2?.active);

// 从第一代顺利迈入第二代（不重建世界、不重置时间与人员）
export function enterEra2(sim) {
  if (sim.era2?.active) return { ok: false, msg: '已经在第二代农耕时代了' };
  if (!sim.era?.done || !sim.era?.result?.ok) return { ok: false, msg: '要先通过第一代大水考验，带全族来到新河谷' };
  const E2 = sim.era2;
  E2.active = true;
  E2.startedAt = sim.t;
  E2.startDay = sim.day;
  E2.floodAt = (sim.day + K.era2.floodForceYears * YEAR_DAYS) * DAY;
  sim.dirty.tech = true;
  sim.dirty.buildings = true;

  // 如果新河谷里还没安营，确保营地基准位置合理
  const r = makeRng(hashSeed('era2', sim.seed));
  const V = sim.map.valley || sim.camp;

  // 计算大渠三节点：上游引水口(intake) → 谷中枢纽(hub) → 下游分洪口(outfall)
  const avoidRock = p => {
    let px = p.x, py = p.y;
    for (const rk of sim.map.rocks) {
      const d = Math.hypot(px - rk.x, py - rk.y);
      if (d < rk.r + 36) {
        const a = Math.atan2(py - rk.y, px - rk.x) || 0.4;
        px = rk.x + Math.cos(a) * (rk.r + 42);
        py = rk.y + Math.sin(a) * (rk.r + 42);
      }
    }
    return { x: clamp(px, 60, sim.map.w - 60), y: clamp(py, 60, sim.map.h - 60) };
  };
  const intakeY = clamp(V.y - r.range(240, 360), 120, sim.map.h - 240);
  const intakeR = nearestRiverPoint(sim.map, { x: V.x, y: intakeY });
  const intake = avoidRock({ x: intakeR.x + RIVER_HALF + 32, y: intakeR.y });

  const hubDir = Math.atan2(intake.y - V.y, intake.x - V.x);
  const hub = avoidRock({ x: V.x + Math.cos(hubDir) * 165, y: V.y + Math.sin(hubDir) * 165 });

  const outfallY = clamp(V.y + r.range(240, 360), 240, sim.map.h - 110);
  const outfallR = nearestRiverPoint(sim.map, { x: V.x, y: outfallY });
  const outfall = avoidRock({ x: outfallR.x + RIVER_HALF + 32, y: outfallR.y });

  E2.canal.nodes = { intake, hub, outfall };
  reveal(sim, intake.x, intake.y, 130);
  reveal(sim, hub.x, hub.y, 140);
  reveal(sim, outfall.x, outfall.y, 130);

  // 河对岸邻村：青陶村
  const vy = clamp(V.y + r.range(-180, 180), 180, sim.map.h - 180);
  const vr = nearestRiverPoint(sim.map, { x: V.x, y: vy });
  const vx = clamp(vr.x - r.range(220, 340), 110, sim.map.w - 110);
  sim.village = {
    name: '青陶村', x: vx, y: vy,
    pop: K.era2.villagePop, mood: 0.15, met: true,
    damming: false, trades: 0, waterAgreed: false, raided: 0,
    genius: r() < 0.55 ? 'potter' : 'hydro',
    geniusName: r() < 0.5 ? '陶青' : '禹生',
    invited: false, faith: 0,
  };
  reveal(sim, vx, vy, 150);

  // 若族里还没有二代领域天才，挑一位年轻族人显现农耕/制陶/治水才气
  const hasEra2Genius = sim.alive.some(p => p.genius && !['fire', 'art', 'hunt', 'herb', 'craft'].includes(p.genius));
  if (!hasEra2Genius) {
    const cand = sim.alive.filter(p => !p.genius && p.age >= 10 && p.age <= 34);
    if (cand.length) {
      const g = cand[r.int(cand.length)];
      g.genius = r.pick(['potter', 'hydro', 'astro']);
      g.geniusShown = true;
      log(sim, `走进新河谷后，大家看出${g.name}竟是个${GENIUS[g.genius]}`, 'birth', { who: g.id });
    }
  }

  syncHouseholds(sim);
  recalcLocalBonuses(sim);
  sim.assignBeds();
  log(sim, `迈入第二代 · 农耕时代（彩陶）：全族 ${sim.alive.length} 人在新河谷定居。铅笔可划田、挖水渠，筑牢丰年与大渠根基`, 'god', { big: true, era: true });
  return { ok: true, era2: E2 };
}

// ---------------- 户籍管理 ----------------
export function syncHouseholds(sim) {
  const byId = new Map();
  const list = [];
  const used = new Set();
  const alive = sim.alive.filter(p => !p.lost);
  // 夫妻和孩子先成户
  for (const p of [...alive].sort((a, b) => a.n - b.n)) {
    if (used.has(p.id) || p.age < 14) continue;
    const pt = p.partner && sim.idx[p.partner];
    const head = pt && pt.alive && pt.n < p.n ? pt : p;
    if (used.has(head.id)) continue;
    const members = [head];
    used.add(head.id);
    if (pt && pt.alive && !used.has(pt.id)) { members.push(pt); used.add(pt.id); }
    for (const q of alive) {
      if (used.has(q.id)) continue;
      if (q.parents.includes(head.id) || (pt && q.parents.includes(pt.id))) {
        if (q.age < 17 || !q.partner) { members.push(q); used.add(q.id); }
      }
    }
    const hid = `H${head.n}`;
    const h = { id: hid, name: `${head.name}户`, head: head.id, members: members.map(m => m.id), house: head.bed || null };
    list.push(h);
    byId.set(hid, h);
    for (const m of members) { m.houseId = hid; m.houseName = h.name; }
  }
  // 孤儿或落单未成年人归入第一户
  for (const q of alive) {
    if (used.has(q.id)) continue;
    if (list.length) {
      const h = list[0];
      h.members.push(q.id);
      q.houseId = h.id; q.houseName = h.name;
    } else {
      const hid = `H${q.n}`;
      const h = { id: hid, name: `${q.name}户`, head: q.id, members: [q.id], house: q.bed || null };
      list.push(h);
      q.houseId = hid; q.houseName = h.name;
    }
  }
  sim.households = list;
  return list;
}

// ---------------- 大渠三段时代工程 ----------------
export function grandCanalLock(sim, stage) {
  if (!sim.era2?.active) return '进入第二代（农耕）后才能修大渠';
  const cur = sim.era2.canal.stage;
  if (stage <= cur) return `大渠第 ${stage} 段已经修通了`;
  if (stage > cur + 1) return `先修通大渠第 ${cur + 1} 段`;
  if (sim.canals.some(c => c.grandStage === stage && !c.built)) return `大渠第 ${stage} 段正在施工`;
  const need = CANAL_NEEDS[stage];
  if (need && !tribeKnows(sim, need)) return `要先学会「${TECHS[need].name}」`;
  return null;
}

export function matchGrandCanalStage(sim, pts) {
  const E2 = sim.era2;
  if (!E2?.active || !E2.canal.nodes || pts.length < 2) return 0;
  const st = E2.canal.stage + 1;
  if (st > 3 || grandCanalLock(sim, st)) return 0;
  const N = E2.canal.nodes, V = sim.map.valley || sim.camp;
  const a = pts[0], b = pts[pts.length - 1];
  const between = (p, q, r1 = 150, r2 = 160) =>
    (dist(a, p) <= r1 && dist(b, q) <= r2) || (dist(b, p) <= r1 && dist(a, q) <= r2);
  if (st === 1 && between(N.intake, N.hub, 150, 165)) return 1;
  if (st === 2 && between(N.hub, V, 165, 220)) return 2;
  if (st === 3 && (between(N.hub, N.outfall, 240, 165) || between(V, N.outfall, 240, 165))) return 3;
  return 0;
}

export function startGrandCanal(sim, pts, stage) {
  const lock = grandCanalLock(sim, stage);
  if (lock) return { ok: false, msg: lock };
  if (matchGrandCanalStage(sim, pts) !== stage) return { ok: false, msg: '大渠要沿图上的工程标记连接两端' };
  const ink = K.era2.canalInk[stage - 1] || 12;
  if (sim.ink < ink) return { ok: false, msg: `墨不够（大渠第 ${stage} 段开工要 ${ink} 墨）` };
  const res = addCanal(sim, pts, {
    grandStage: stage,
    name: CANAL_STAGE_NAMES[stage],
    bless: K.era2.canalBless[stage - 1] || 20,
  });
  if (!res.ok) return res;
  sim.ink -= ink;
  sim.stats.inkSpent += ink;
  log(sim, `大渠工程第 ${stage} 段「${CANAL_STAGE_NAMES[stage]}」开工（付 ${ink} 墨，沿途开光共 ${res.canal.bless} 墨）`, 'god', { canal: res.canal.id });
  return { ok: true, canal: res.canal, ink };
}

export function era2FloodDay(sim, day) {
  const start = sim.era2.startDay || 0;
  let d = Math.max(day + K.era2.floodAfter, start + K.era2.floodMinYears * YEAR_DAYS);
  d = Math.ceil(d / SEASON_DAYS) * SEASON_DAYS;
  if (Math.floor((d % YEAR_DAYS) / SEASON_DAYS) === 3) d += SEASON_DAYS; // 冬天挪到开春
  return Math.min(d, start + K.era2.floodForceYears * YEAR_DAYS);
}

export function completeGrandCanalStage(sim, canal) {
  const st = canal.grandStage;
  if (!st || !sim.era2?.active) return;
  const C = sim.era2.canal;
  if (st <= C.stage) return;
  C.stage = st;
  C.stages[st] = canal.id;
  sim.stats.grandCanal = st;
  if (st === 1) {
    for (const f of sim.fields) f.moisture = Math.max(f.moisture, 0.72);
    log(sim, '大渠第一段「引水干渠」贯通：河水引到枢纽旁，河谷墒情大好', 'build', { big: true });
  } else if (st === 2) {
    log(sim, '大渠第二段「谷中灌渠」贯通：河谷各田增产两成，也帮着疏水排涝', 'build', { big: true });
  } else if (st === 3) {
    const before = sim.inkMax;
    sim.inkMax += 20;
    sim.ink = Math.min(sim.inkMax, sim.ink + 12);
    const fd = era2FloodDay(sim, sim.day);
    sim.era2.floodAt = Math.min(sim.era2.floodAt, fd * DAY);
    const y = Math.floor(fd / YEAR_DAYS) + 1, q = Math.floor((fd % YEAR_DAYS) / SEASON_DAYS);
    log(sim, `大渠第三段「分洪尾渠」修通！神的墨上限涨到 ${sim.inkMax}。第 ${y} 年${['开春', '入夏', '入秋', '入冬'][q]}上游将发滔天大水，大渠已备好分洪`, 'god', { big: true });
  }
  updateCanalNetwork(sim);
}

export function isDiversionReady(sim) {
  const E2 = sim.era2;
  return !!(E2?.active && E2.canal.stage === 3);
}

// ---------------- 邻村交互（青陶村） ----------------
export const villageMood = V => (V.mood >= 0.6 ? '亲善' : V.mood >= 0.2 ? '和气' : V.mood > -0.2 ? '猜忌' : '交恶');

export const villageH = {
  trade(sim) {
    const V = sim.village;
    if (!sim.era2?.active || !V) return { ok: false, msg: '还没碰到邻村' };
    if (V.mood < -0.25) return { ok: false, msg: `${V.name}与我们交恶，不肯做买卖（先显灵或议水）` };
    if (foodTotal(sim) < 6 && sim.stock.wood < 8) return { ok: false, msg: '备礼至少要 6 份吃的或 8 根木头' };
    if (foodTotal(sim) >= 8) {
      let left = 6;
      for (const b of [...sim.stock.food].sort((a, c) => c.n - a.n)) { const n = Math.min(b.n, left); b.n -= n; left -= n; if (left <= 0) break; }
      sim.stock.food = sim.stock.food.filter(b => b.n > 0.01);
      sim.stock.pottery = (sim.stock.pottery || 0) + 3;
      sim.stats.pottery = (sim.stats.pottery || 0) + 3;
    } else {
      sim.stock.wood -= 8;
      addFood(sim, 'grain', 10);
      sim.stock.pottery = (sim.stock.pottery || 0) + 2;
      sim.stats.pottery = (sim.stats.pottery || 0) + 2;
    }
    V.trades++;
    V.mood = clamp(V.mood + 0.15, -1, 1);
    sim.stats.villageTrades = (sim.stats.villageTrades || 0) + 1;
    // 关系够好、交易过两次，请来他们的巧手天才
    if (V.mood >= 0.5 && V.trades >= 2 && !V.invited) {
      V.invited = true;
      const g = sim.alive.find(p => p.age >= 16 && !p.genius);
      if (g) {
        g.genius = V.genius;
        g.geniusShown = true;
        return { ok: true, msg: `与${V.name}换来陶罐；他们派${V.geniusName}住过来传艺，${g.name}成了${GENIUS[V.genius]}` };
      }
    }
    return { ok: true, msg: `与${V.name}以物易物：换回 3 只陶罐（好感：${villageMood(V)}）` };
  },
  water(sim) {
    const V = sim.village;
    if (!sim.era2?.active || !V) return { ok: false, msg: '还没碰到邻村' };
    if (!V.damming && V.waterAgreed) return { ok: false, msg: `${V.name}已经照水约放水过来了` };
    if (V.mood < 0) return { ok: false, msg: `${V.name}不肯让水（好感：${villageMood(V)}）：先换物、显灵，或写「剑」破坝` };
    V.damming = false;
    V.waterAgreed = true;
    V.mood = clamp(V.mood + 0.12, -1, 1);
    updateCanalNetwork(sim);
    return { ok: true, msg: `与${V.name}议定水约：上游开闸分水，水渠恢复通畅` };
  },
  breakDam(sim) {
    const V = sim.village;
    if (!sim.era2?.active || !V) return { ok: false, msg: '还没碰到邻村' };
    if (!V.damming) return { ok: false, msg: `${V.name}眼下没拦水` };
    V.damming = false;
    V.mood = clamp(V.mood - 0.35, -1, 1);
    for (const p of sim.alive) p.fear = clamp(p.fear + 0.04);
    updateCanalNetwork(sim);
    return { ok: true, msg: `强行拆了${V.name}上游拦水坝：渠水哗哗流进河谷，${V.name}怨气冲天` };
  },
  awe(sim) {
    const V = sim.village;
    if (!sim.era2?.active || !V) return { ok: false, msg: '还没碰到邻村' };
    V.mood = clamp(V.mood + 0.25, -1, 1);
    V.faith += 0.3;
    sim.effects.push({ kind: 'light', x: V.x, y: V.y, t: sim.t });
    return { ok: true, msg: `一道神光落在${V.name}陶窑上，村民纷纷叩首（关系：${villageMood(V)}）` };
  },
};

// ---------------- 第二代游牧劫掠 ----------------
export function spawnRaiders(sim, n = 3) {
  const c = sim.camp, W = sim.map.w, H = sim.map.h;
  const edge = [
    { x: 45, y: c.y + sim.rng.range(-200, 200) },
    { x: W - 45, y: sim.rng.range(80, H - 80) },
    { x: sim.rng.range(200, W - 120), y: 45 },
    { x: sim.rng.range(200, W - 120), y: H - 45 },
  ][sim.rng.int(4)];
  for (let i = 0; i < n; i++) {
    const r = {
      id: `rd${sim.nextId++}`, kind: 'raider', name: '劫掠骑手',
      x: clamp(edge.x + sim.rng.range(-30, 30), 30, W - 30),
      y: clamp(edge.y + sim.rng.range(-30, 30), 30, H - 30),
      hp: 40, state: 'go', wx: edge.x, wy: edge.y,
      until: sim.t + 2.5 * DAY, looted: false, dead: false, gone: false,
    };
    sim.raiders.push(r);
    sim.idx[r.id] = r;
  }
  sim.stats.raids2 = (sim.stats.raids2 || 0) + 1;
  log(sim, `远处尘土飞扬：${n} 个游牧骑手冲着新河谷来抢粮了`, 'danger', { big: true });
}

function raiderHitBarrier(sim, b, nx, ny) {
  const a = { x: b.x, y: b.y }, c = { x: nx, y: ny };
  for (const w of sim.barriers) {
    if (w.kind === 'guard') {
      if (Math.hypot(nx - w.x, ny - w.y) < w.r && Math.hypot(a.x - w.x, a.y - w.y) >= w.r - 0.5) return w;
      continue;
    }
    const P = w.pts;
    if (!P) continue;
    for (let i = 1; i < P.length; i++) if (segIntersect(a, c, P[i - 1], P[i])) return w;
    if (w.closed && P.length > 2 && segIntersect(a, c, P[P.length - 1], P[0])) return w;
    if (w.kind === 'zone' && pointInPolygon(c, P) && !pointInPolygon(a, P)) return w;
  }
  return null;
}

export function raidersTick(sim, dt) {
  if (!sim.raiders?.length) return;
  for (const b of [...sim.raiders]) {
    if (b.dead || b.gone) continue;
    if (sim.t > b.until && b.state === 'go') b.state = 'flee';
    if (b.state === 'flee') {
      const dx = b.wx - b.x, dy = b.wy - b.y, d = Math.hypot(dx, dy);
      if (d < 20) { b.gone = true; continue; }
      b.x += dx / d * 7 * dt; b.y += dy / d * 7 * dt;
      continue;
    }
    const target = sim.camp;
    const dx = target.x - b.x, dy = target.y - b.y, d = Math.hypot(dx, dy);
    if (d > 26) {
      const s = 5.4 * dt, nx = b.x + dx / d * s, ny = b.y + dy / d * s;
      const hit = sim.barriers.length ? raiderHitBarrier(sim, b, nx, ny) : null;
      if (hit) {
        hit.hp -= 12 * dt / 60;
        if (hit.hp <= 0) {
          removeBarrier(sim, hit);
          sim.dirty.barriers = true;
          log(sim, '游牧骑手冲垮了封锁线', 'danger');
        }
        continue;
      }
      b.x = nx; b.y = ny;
      // 顺手迎战守夜/巡逻的人
      const guard = sim.alive.find(p => p.age >= 15 && !p.asleep && !p.lost && dist(p, b) < 28);
      if (guard && sim.rng() < 0.04 * dt) {
        b.hp -= 14 + (guard.skills.hunt || 0) * 16;
        if (b.hp <= 0) { b.dead = true; log(sim, `${guard.name}击倒了一名游牧骑手`, 'work'); continue; }
        if (sim.rng() < 0.3) injure(sim, guard, 0.22, '阻挡劫掠骑手时受了伤', '伤');
      }
      continue;
    }
    // 冲进营地抢走一点谷物/肉后逃走
    if (!b.looted) {
      b.looted = true;
      let took = 0;
      for (const f of [...sim.stock.food].sort((x, y) => y.n - x.n)) {
        const take = Math.min(f.n, 6 - took);
        f.n -= take; took += take;
        if (took >= 6) break;
      }
      sim.stock.food = sim.stock.food.filter(x => x.n > 0.01);
      if (took >= 1) log(sim, `游牧骑手冲进营地抢走 ${Math.round(took)} 份粮食后策马逃了`, 'danger');
    }
    b.state = 'flee';
  }
  sim.raiders = sim.raiders.filter(b => !b.gone && !b.dead);
}

// ---------------- 每天 & 每小时（第二代事件与分洪大水） ----------------
export function dailyEra2(sim, newSeason) {
  const E2 = sim.era2;
  if (!E2?.active) return;
  syncHouseholds(sim);

  const s = seasonOf(sim.t), y = yearOf(sim.t);
  const eraYear = Math.floor((sim.day - E2.startDay) / YEAR_DAYS) + 1;

  // 到期结束旱/涝标记
  if (E2.drought && sim.t >= E2.droughtUntil) {
    E2.drought = false;
    log(sim, '这轮久旱总算过去了', 'season');
  }
  if (E2.waterlog && sim.t >= E2.waterlogUntil) {
    E2.waterlog = false;
    log(sim, '连绵阴雨止住，积水退去了', 'season');
  }

  // 春秋季节祭（有酿酒翻倍）
  if (newSeason && (s === 0 || s === 2) && (tribeKnows(sim, 'calendar') || tribeKnows(sim, 'villageRule')) && E2.ev.fest < sim.day - 6) {
    E2.ev.fest = sim.day;
    const brew = tribeKnows(sim, 'brew');
    sim.buffs.seasonFest = sim.t + SEASON_DAYS * DAY;
    for (const p of sim.alive) {
      p.love = clamp(p.love + (brew ? 0.05 : 0.025));
      p.morale = clamp(p.morale + (brew ? 0.12 : 0.06));
    }
    log(sim, `族人办了${s === 0 ? '春祈' : '秋报'}季节祭${brew ? '，摆上新酿的谷酒' : ''}：人欢神喜`, 'season');
  }

  // 青陶村好感缓回与自解拦水
  if (sim.village) {
    const V = sim.village;
    V.mood += (0.15 - V.mood) * 0.015;
    if (V.damming && !E2.drought && sim.rng() < 0.25) { V.damming = false; updateCanalNetwork(sim); }
  }

  // 旱年、涝年（第二代起）
  if (eraYear >= 1 && newSeason && (s === 0 || s === 1) && !E2.drought && !E2.waterlog && !E2.floodActive && !E2.floodSoon) {
    if (E2.ev.drought < y && sim.rng() < K.era2.droughtChance) {
      E2.ev.drought = y;
      E2.drought = true;
      E2.droughtUntil = sim.t + 8 * DAY;
      sim.weather.drought = true;
      sim.weather.dry = Math.max(sim.weather.dry, 6);
      if (sim.village && sim.village.mood < 0.45 && !sim.village.waterAgreed) {
        sim.village.damming = true;
        updateCanalNetwork(sim);
      }
      log(sim, `${tribeKnows(sim, 'calendar') ? '通历法的人算出' : ''}今年碰上旱年：天久不雨，没引水的农田要干枯减产${sim.village?.damming ? '（青陶村也在上游拦水）' : ''}`, 'danger', { big: true });
    } else if (E2.ev.waterlog < y && sim.rng() < K.era2.waterlogChance) {
      E2.ev.waterlog = y;
      E2.waterlog = true;
      E2.waterlogUntil = sim.t + 5 * DAY;
      sim.weather.wet = true;
      sim.weather.kind = 'rain';
      sim.weather.until = sim.t + 2.5 * DAY;
      log(sim, '遇上涝年：连日大雨不停，没通排涝渠的农田容易积水烂根', 'danger', { big: true });
    }
  }

  // 农田虫害
  if ((s === 1 || s === 2) && sim.fields.some(f => f.state === 'growing') && E2.ev.pest < sim.day - 8 && sim.rng() < K.era2.pestChance / 7) {
    E2.ev.pest = sim.day;
    const f = sim.fields.find(x => x.state === 'growing');
    if (f) {
      f.pest = clamp(f.pest + 0.5, 0, 1);
      log(sim, `${f.name}闹起了虫害！用墨笔在田上写「火」可驱虫`, 'danger', { field: f.id });
    }
  }

  // 鼠患：囤粮多时偶发
  const grainStock = sim.stock.food.filter(b => b.kind === 'grain').reduce((a, b) => a + b.n, 0);
  if (grainStock >= 28 && E2.ev.rat < sim.day - 12 && sim.rng() < K.era2.ratChance / 10) {
    E2.ev.rat = sim.day;
    let lossRate = 0.22;
    if (sim.granaryCap > 0) lossRate *= 0.45;
    if ((sim.stock.pottery || 0) >= 3) lossRate *= 0.55;
    if (tribeKnows(sim, 'villageRule')) lossRate *= 0.65;
    let lost = 0;
    for (const b of sim.stock.food) if (b.kind === 'grain') { const k = b.n * lossRate; b.n -= k; lost += k; }
    sim.stock.food = sim.stock.food.filter(b => b.n > 0.05);
    if (lost >= 1) log(sim, `仓里闹鼠患：啃掉了 ${Math.round(lost)} 份谷物${sim.granaryCap > 0 || sim.stock.pottery > 0 ? '（有公共粮仓和陶罐护着，损得少）' : '（建公共粮仓和陶罐能防鼠）'}`, 'waste');
  }

  // 游牧劫掠
  if (eraYear >= 2 && (s === 1 || s === 2) && !sim.raiders.length && !E2.floodActive && E2.ev.raid < y && sim.rng() < K.era2.raidChance / 12) {
    E2.ev.raid = y;
    spawnRaiders(sim, sim.alive.length >= 25 ? 4 : 3);
  }

  // 第二代大水倒计时
  if (!E2.done && !E2.floodActive) {
    const left = E2.floodAt - sim.t;
    if (left <= 7 * DAY && left > 6 * DAY && (tribeKnows(sim, 'calendar') || tribeKnows(sim, 'stars'))) {
      log(sim, `通历法的人报信：七天之内，上游将发滔天大水${isDiversionReady(sim) ? '——大渠分洪段已经备好了' : '——快挖通大渠第三段分洪尾渠！'}`, 'danger', { big: true });
    }
    if (left <= 2 * DAY && !E2.floodSoon) {
      E2.floodSoon = true;
      sim.weather.wet = true;
      sim.weather.kind = s === 3 ? 'snow' : 'rain';
      sim.weather.until = E2.floodAt + 12 * 60;
      sim.weather.next = null;
      log(sim, '上游暴雨压境，河水一天天猛涨！', 'danger');
    }
    if (sim.t >= E2.floodAt) startEra2Flood(sim);
  }
}

export function startEra2Flood(sim) {
  const E2 = sim.era2;
  if (!E2?.active || E2.floodActive || E2.done) return;
  sim.floodPlan = null; // 此次洪峰接管水位，不能被旧山洪排程覆盖
  E2.flooded = true;
  E2.floodActive = true;
  E2.floodUntil = sim.t + K.era2.floodPeakDays * DAY;
  E2.diverted = isDiversionReady(sim);
  sim.flood = { start: sim.t, until: E2.floodUntil, w: 340, great: false, era2: true };
  // 确保每道本地河堤有耐久值（鲧堵：堵只顶得住一时）
  for (const L of sim.levees) if (!L.broken && L.hp == null) L.hp = K.era2.leveeHp;
  sim.effects.push({ kind: 'flood', t: sim.t });
  if (E2.diverted) {
    log(sim, '滔天大水压向河谷！三段大渠齐齐泄洪入下游，农田村落安然保全（禹疏之功）', 'god', { big: true });
  } else {
    log(sim, '滔天大水来了！仅靠河堤顶不住几天就会溃堤——快修通大渠第三段「分洪尾渠」疏导洪水！', 'danger', { big: true });
  }
}

export function hourlyEra2(sim) {
  const E2 = sim.era2;
  if (!E2?.active || !E2.floodActive) return;
  if (isDiversionReady(sim)) E2.diverted = true;

  if (!E2.diverted) {
    // 没修通分洪渠：河堤每小时被水冲刷掉血，迟早溃堤
    for (const L of sim.levees) {
      if (L.broken) continue;
      L.hp = (L.hp ?? K.era2.leveeHp) - 1;
      if (L.hp <= 0) {
        L.broken = true;
        log(sim, '大水顶塌了一道河堤！洪水漫进田里（堵不住，要靠大渠分洪）', 'danger', { big: true });
        for (const f of sim.fields) {
          if (f.state === 'growing' && !f.drained && sim.rng() < 0.65) {
            f.state = 'fallow'; f.growth = 0; f.missReason = '溃堤淹毁了庄稼';
          }
        }
        sim.dirty.fields = true;
      }
    }
    // 水未疏导时再伤一些未护粮木
    if (sim.rng() < 0.16 && !sim.levees.some(L => !L.broken)) {
      for (const b of sim.stock.food) b.n *= 0.96;
      sim.stock.food = sim.stock.food.filter(b => b.n > 0.05);
    }
  }

  if (sim.t >= E2.floodUntil) {
    E2.floodActive = false;
    E2.floodSoon = false;
    sim.flood = null;
    if (E2.diverted && sim.alive.length >= 6) {
      finishEra2(sim);
    } else {
      // 没分洪硬扛过去：继续修通分洪渠，下一年春再战洪峰
      E2.floodAt = Math.max(sim.t + 14 * DAY, (sim.day + YEAR_DAYS) * DAY);
      log(sim, '这一波洪水退去了，可田里受损惨重——把大渠第三段「分洪尾渠」挖通，才能真正安居', 'danger');
    }
  }
}

export function finishEra2(sim) {
  const E2 = sim.era2;
  if (E2.done) return;
  E2.done = true;
  E2.doneAt = sim.t;
  syncHouseholds(sim);
  E2.result = {
    ok: true,
    days: sim.day - E2.startDay,
    years: +((sim.day - E2.startDay) / YEAR_DAYS).toFixed(1),
    totalYears: +(sim.day / YEAR_DAYS).toFixed(1),
    pop: sim.alive.length,
    households: sim.households.length,
    grain: sim.stats.grainHarvested || 0,
    pottery: sim.stock.pottery || 0,
    canalStage: E2.canal.stage,
    diverted: !!E2.diverted,
    villageMood: sim.village ? Math.round(sim.village.mood * 100) : 0,
    techs: Object.keys(sim.known).filter(k => sim.known[k] > 0).length,
    ink: Math.round(sim.stats.inkSpent),
  };
  log(sim, `第二代 · 农耕篇：大渠贯通、疏导大水！${sim.alive.length} 口人（${sim.households.length} 户）在新河谷安居乐业`, 'god', { big: true, era2: true });
}
