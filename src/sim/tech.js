// 技艺长在人身上：谁会什么（p.knows）、当前研究由最合适的人去琢磨、傍晚火边师傅带徒弟、
// 会的人死光就失传（画进壁画的能照着学回来）。还有首领、猎手、火守、草药师这些名分，和少见的天才。
import { K, DAY, TECHS, TECH_IDS, ERA1_TECH_IDS, GENIUS, GENIUS_ERA1, GENIUS_ERA2, eraNum } from './config.js';
import { dist, log, localBuildings } from './util.js';
import { factor } from './people.js';

const T = id => TECHS[id];
const nameOf = id => `「${TECHS[id].name}」`;
export const activeTechIds = sim => eraNum(sim) === 1 ? ERA1_TECH_IDS : TECH_IDS.filter(id => (TECHS[id].era || 1) <= eraNum(sim));
export const knows = (p, id) => !!(p && p.knows && p.knows[id]);
export const tribeKnows = (sim, id) => (sim.known?.[id] || 0) > 0 || sim.era3?.archive?.[id] != null;
export const knowerCount = (sim, id) => sim.known?.[id] || 0;
export function refreshKnown(sim) {
  const k = {};
  for (const p of sim.alive) if (p.knows) for (const id in p.knows) k[id] = (k[id] || 0) + 1;
  sim.known = k;
}

export function initTech(sim) {
  sim.known = {};
  sim.research = { id: null, by: null, progress: {}, since: sim.t, idle: 0, auto: false };
  sim.murals = {};          // 画上石壁的技艺 → 什么时候画的
  sim.lostTech = {};        // 失传过的技艺 → 什么时候失传的
  sim.roles = { chief: null, hunter: null, fire: null, herb: null };
  sim.techLog = [];         // { id, t, by, how }
}

// ---------------- 研究 ----------------
// known：族里有人会；open：前置都会了，能琢磨；locked：前置还没会
export function techState(sim, id) {
  if (!T(id) || (T(id).era || 1) > eraNum(sim)) return 'locked';
  if (tribeKnows(sim, id)) return 'known';
  return T(id).pre.every(q => tribeKnows(sim, q)) ? 'open' : 'locked';
}
// 失传过、又没画上壁画的，重新琢磨只要一半工夫（学会结绳只要三成）
export const workOf = (sim, id) => T(id).work * (sim.lostTech[id] != null ? (tribeKnows(sim, 'knot') ? 0.3 : K.tech.relearn) : 1);
export const daysOf = h => Math.round(h / 8 * 10) / 10;
// 照眼下这个人的手艺、天分，还要琢磨几天（一天约琢磨 11 个钟头）
export function etaDays(sim, id, p = sim.idx[sim.research.by]) {
  const left = workOf(sim, id) - (sim.research.progress[id] || 0);
  if (!p) return null;
  const rate = 11 * K.tech.rate * factor(sim, p, T(id).skill) * studyMul(sim, p, id);
  return Math.max(0.5, Math.round(left / rate * 2) / 2);
}
export const openTechs = sim => activeTechIds(sim).filter(id => techState(sim, id) === 'open');

export function setResearch(sim, id, auto = false) {
  const R = sim.research;
  if (id == null) { R.id = null; R.by = null; return { ok: true, msg: '不琢磨了' }; }
  if (!T(id) || T(id).era > eraNum(sim)) return { ok: false, msg: '这一代还不能研究这门手艺' };
  const st = techState(sim, id);
  if (st === 'known') return { ok: false, msg: `族里已经有人会${nameOf(id)}了` };
  if (st === 'locked') return { ok: false, msg: `要先会${T(id).pre.filter(q => !tribeKnows(sim, q)).map(nameOf).join('、')}` };
  if (R.id === id) return { ok: true, msg: '已经在琢磨了', by: sim.idx[R.by] };
  R.id = id; R.auto = auto; R.since = sim.t; R.idle = 0;
  const p = pickResearcher(sim);
  const left = etaDays(sim, id, p) ?? '?';
  log(sim, auto
    ? `你没定研究，${chiefName(sim)}拿了主意：让${p ? p.name : '大家'}琢磨${nameOf(id)}（约 ${left} 天）`
    : `定下研究：${nameOf(id)}，由${p ? p.name : '（眼下没人能做）'}去琢磨（约 ${left} 天）`, auto ? 'work' : 'god', { tech: id });
  return { ok: true, msg: `${p ? p.name : '没人'}去琢磨${nameOf(id)}`, by: p };
}
const chiefName = sim => sim.idx[sim.roles.chief]?.name || '族人';

export function researchScore(sim, p, id) {
  if (!p.alive || p.age < 14 || p.lost) return -9;
  const t = T(id);
  let s = t.skill ? (p.skills[t.skill] || 0) : 0.3 + (p.age >= 40 ? 0.12 : 0) + 0.1 * p.morale;
  if (p.genius) s += p.genius === t.domain ? 0.8 : 0.15;
  if (p.temper === '勤') s += 0.05; else if (p.temper === '懒') s -= 0.06;
  if (p.sick > 0 || p.health < 0.4) s -= 0.6;
  if (p.pregnant && p.pregnant - sim.t < 3 * DAY) s -= 0.4;
  return s;
}
export function pickResearcher(sim) {
  const R = sim.research;
  if (!R.id) { R.by = null; return null; }
  let best = null, bs = -1;
  for (const p of sim.alive) { const s = researchScore(sim, p, R.id); if (s > bs) { bs = s; best = p; } }
  R.by = best ? best.id : null;
  return best;
}
// 琢磨的快慢：天才在自己那一行快得多；会前置手艺的人越多越快；石器台让做手艺的快
export function studyMul(sim, p, id) {
  const t = T(id);
  let m = 1;
  if (p.genius) m *= p.genius === t.domain ? K.tech.geniusMul : K.tech.geniusOther;
  const helpers = t.pre.reduce((s, q) => s + Math.min(4, knowerCount(sim, q)), 0);
  m *= 1 + 0.06 * Math.min(6, helpers);
  if (t.domain === 'craft' || t.domain === 'potter') { const b = localBuildings(sim, 'bench')[0]; if (b) m *= 1 + b.research; }
  if (sim.buffs?.inspire > sim.t && sim.research.by === p.id) m *= 1.8;
  return m;
}
// 研究进度（钟头）。琢磨成了就学会，返回 true
export function addProgress(sim, p, id, h) {
  const R = sim.research;
  if (R.id !== id) return false;
  R.progress[id] = (R.progress[id] || 0) + h;
  if (R.progress[id] < workOf(sim, id)) return false;
  const days = Math.max(1, Math.round((sim.t - R.since) / DAY));
  delete R.progress[id];
  const again = sim.lostTech[id] != null;
  R.id = null; R.by = null; R.idle = 0;
  learn(sim, p, id, 'invent');
  log(sim, again ? `${p.name}把失传的${nameOf(id)}又琢磨回来了` : `${p.name}琢磨出了${nameOf(id)}：${T(id).what}`, 'build', { who: p.id, tech: id, days });
  return true;
}

// 学会一项；族里第一个会的人还要报一声解锁了什么
export function learn(sim, p, id, how = 'teach') {
  if (!p.knows) p.knows = {};
  if (p.knows[id]) return false;
  p.knows[id] = sim.t;
  const first = !sim.known[id];
  sim.known[id] = (sim.known[id] || 0) + 1;
  if (first && how !== 'tablet') {
    sim.techLog.push({ id, t: sim.t, by: p.name, how });
    if (sim.lostTech[id] != null) delete sim.lostTech[id];
    if (sim.research.id === id) { delete sim.research.progress[id]; sim.research.id = null; sim.research.by = null; }
    sim.dirty.tech = true;
  }
  return true;
}

// 有人死了（或走了）：他会的手艺还有没有别人会
export function checkLoss(sim, gone) {
  if (!gone.knows) return;
  refreshKnown(sim);
  for (const id in gone.knows) {
    if (tribeKnows(sim, id)) continue;
    sim.lostTech[id] = sim.t;
    sim.stats.lostTechs = (sim.stats.lostTechs || 0) + 1;
    log(sim, sim.murals[id] != null
      ? `会${nameOf(id)}的人都不在了。好在石壁上画着，照着还能学回来`
      : `会${nameOf(id)}的人都不在了，这门手艺失传了`, 'danger', { tech: id });
  }
  if (sim.research.by === gone.id) pickResearcher(sim);
  for (const k in sim.roles) if (sim.roles[k] === gone.id) sim.roles[k] = null;
}

// ---------------- 傍晚火边：师傅带徒弟；照着壁画学回失传的 ----------------
export function teachEvening(sim) {
  const camp = sim.march ? sim.march.c : sim.camp, R = (sim.march ? 160 : sim.camp.r + 40);
  const here = sim.alive.filter(p => !p.lost && Math.abs(p.x - camp.x) < R && dist(p, camp) < R);
  const learnt = [], busy = new Set();
  // 一个师傅一晚带一个徒弟：挑自己会、徒弟不会、徒弟用得上的；自家人先教
  const masters = here.filter(p => p.age >= 14 && p.knows && Object.keys(p.knows).length).sort((a, b) => (b.genius ? 1 : 0) - (a.genius ? 1 : 0) || a.n - b.n);
  for (const m of masters) {
    let best = null, bs = 0;
    for (const id of Object.keys(m.knows)) {
      const t = T(id);
      for (const q of here) {
        if (q === m || busy.has(q.id) || q.age < 10 || knows(q, id)) continue;
        const kin = q.id === m.partner || q.parents.includes(m.id) || m.parents.includes(q.id);
        const sameHouse = !!(m.houseId && m.houseId === q.houseId);
        if (q.age < 14 && !kin) continue;                       // 小孩跟自家大人学
        const fit = t.skill ? 0.4 + (q.skills[t.skill] || 0) : 0.8;
        const rare = 1 / (1 + knowerCount(sim, id));            // 会的人少的先教
        const s = fit * (kin ? 1.4 : sameHouse ? 1.25 : 1) * (0.5 + rare);
        if (s > bs) { bs = s; best = { q, id, kin, sameHouse, fit }; }
      }
    }
    if (!best) continue;
    busy.add(best.q.id);
    const t = T(best.id);
    let ch = K.tech.teach * (m.genius === t.domain ? K.tech.teachGenius : 1) * (sim.murals[best.id] != null ? 1.3 : 1) * (best.kin ? 1.3 : 1) * (best.sameHouse ? 1.35 : 1) * (tribeKnows(sim, 'knot') ? 1.25 : 1) * best.fit * (best.q.genius === t.domain ? 1.6 : 1) * (best.q.age < 14 ? 0.6 : 1);
    if (sim.rng() < ch) { learn(sim, best.q, best.id); learnt.push(`${best.q.name}跟${m.name}学会了${nameOf(best.id)}`); }
  }
  // 照着壁画学回失传的
  for (const id of Object.keys(sim.lostTech)) {
    if (sim.murals[id] == null || tribeKnows(sim, id)) continue;
    const art = here.some(p => p.genius === 'art');
    for (const q of here) {
      if (busy.has(q.id) || q.age < 14) continue;
      if (sim.rng() < K.tech.muralTeach * (art ? 2 : 1)) { learn(sim, q, id, 'mural'); busy.add(q.id); learnt.push(`${q.name}照着壁画学回了${nameOf(id)}`); break; }
    }
  }
  if (learnt.length) log(sim, `火边：${learnt.slice(0, 3).join('，')}${learnt.length > 3 ? ` 等 ${learnt.length} 人` : ''}`, 'work');
  return learnt.length;
}

// ---------------- 壁画 ----------------
// 还没画上石壁的技艺（族里有人会的）
export const unpainted = sim => activeTechIds(sim).filter(id => tribeKnows(sim, id) && sim.murals[id] == null);
export function muralSpot(sim) {
  if (sim.muralAt && dist(sim.muralAt, sim.camp) < 500) return sim.muralAt;
  const r = sim.map.rocks.filter(r => dist(r, sim.camp) < 480).sort((a, b) => dist(a, sim.camp) - dist(b, sim.camp))[0];
  const a = Math.atan2(sim.camp.y - (r?.y ?? sim.camp.y), sim.camp.x - (r?.x ?? sim.camp.x - 1));
  sim.muralAt = r ? { x: r.x + Math.cos(a) * (r.r + 8), y: r.y + Math.sin(a) * (r.r + 8), rock: r.id } : { x: sim.camp.x + 80, y: sim.camp.y - 70, rock: null };
  return sim.muralAt;
}
export function paintOne(sim, p) {
  const id = unpainted(sim)[0];
  if (!id) return null;
  sim.murals[id] = sim.t;
  sim.dirty.tech = true;
  for (const q of sim.alive) q.morale = Math.min(1, q.morale + 0.02);
  log(sim, `${p.name}把${nameOf(id)}画上了石壁`, 'build', { who: p.id, tech: id });
  return id;
}

// ---------------- 名分：首领、猎手、火守、草药师（二代加：陶匠、治水人、历算人、司祭） ----------------
export const ROLE_NAME = {
  chief: '首领', hunter: '猎手', fire: '火守', herb: '草药师',
  potter: '陶匠', hydro: '治水人', calendar: '历算人', priest: '司祭',
  smith: '铸匠', scribe: '史官', general: '将领',
};
export const ROLE_ERA1 = ['chief', 'hunter', 'fire', 'herb'];
export function assignRoles(sim, quiet = false) {
  const R = sim.roles, ad = sim.alive.filter(p => p.age >= 16 && !p.lost);
  const best = (f, ok = () => true) => ad.filter(ok).reduce((m, p) => (m && f(m) >= f(p) ? m : p), null);
  const prevChief = R.chief;
  const standing = p => (p.age >= 28 ? 0.25 : 0) + Math.min(p.age, 50) / 200 + 0.15 * p.love + Object.values(p.skills).reduce((a, b) => a + b, 0) / 7 + (p.id === prevChief ? 0.2 : 0) + (p.genius ? 0.05 : 0);
  const c = best(standing);
  R.chief = c ? c.id : null;
  if (c && prevChief !== c.id && !quiet) log(sim, prevChief ? `众人推举${c.name}做了首领` : `${c.name}是这一族的首领`, 'season', { who: c.id });
  const h = best(p => p.skills.hunt, p => p.skills.hunt >= 0.45 && p.age < 50);
  R.hunter = h ? h.id : null;
  const prevFire = R.fire, f = best(p => p.skills.fire + (p.genius === 'fire' ? 0.5 : 0), p => knows(p, 'keepfire'));
  R.fire = f ? f.id : null;
  if (f && prevFire !== f.id && !quiet) log(sim, `${f.name}做了火守：火交给他看着`, 'season', { who: f.id });
  const prevHerb = R.herb, g = best(p => p.skills.gather + (p.genius === 'herb' ? 0.5 : 0), p => knows(p, 'herb'));
  R.herb = g ? g.id : null;
  if (g && prevHerb !== g.id && !quiet) log(sim, `${g.name}做了草药师`, 'season', { who: g.id });
  if (!sim.era2?.active) return;
  const prevPot = R.potter, pt = best(p => p.skills.fire + (p.genius === 'potter' ? 0.6 : 0), p => knows(p, 'pottery'));
  R.potter = pt ? pt.id : null;
  if (pt && prevPot !== pt.id && !quiet) log(sim, `${pt.name}做了陶匠：管着陶窑与陶器`, 'season', { who: pt.id });
  const prevHyd = R.hydro, hy = best(p => p.skills.build + (p.genius === 'hydro' ? 0.6 : 0), p => knows(p, 'irrigate') || knows(p, 'bridge'));
  R.hydro = hy ? hy.id : null;
  if (hy && prevHyd !== hy.id && !quiet) log(sim, `${hy.name}成了治水人：引水挖渠由他统筹`, 'season', { who: hy.id });
  const prevCal = R.calendar, cal = best(p => (p.age >= 24 ? 0.2 : 0) + (p.genius === 'astro' ? 0.6 : 0) + p.morale * 0.2, p => knows(p, 'calendar'));
  R.calendar = cal ? cal.id : null;
  if (cal && prevCal !== cal.id && !quiet) log(sim, `${cal.name}成了懂历法的人，推算农时与水期`, 'season', { who: cal.id });
  const prevPr = R.priest, pr = best(p => p.love + (p.genius === 'art' || p.genius === 'astro' ? 0.5 : 0), p => knows(p, 'villageRule'));
  R.priest = pr ? pr.id : null;
  if (pr && prevPr !== pr.id && !quiet) log(sim, `${pr.name}立为司祭：稳住村里的信仰与神谕`, 'season', { who: pr.id });
  if (!sim.era3?.active) return;
  for (const [role, id, skill] of [['smith', 'smelt', 'fire'], ['scribe', 'script', 'gather'], ['general', 'bronzeWalls', 'hunt']]) {
    const p = best(q => q.skills[skill] + (q.genius === role ? 0.8 : 0), q => knows(q, id) || q.genius === role);
    if (p && R[role] !== p.id && !quiet) log(sim, `${p.name}被推举为${ROLE_NAME[role]}`, 'season', { who: p.id });
    R[role] = p?.id || null;
  }
}
export function titleOf(sim, p) {
  const t = [];
  for (const k in sim.roles) if (sim.roles[k] === p.id) t.push(ROLE_NAME[k]);
  if (p.genius && (p.geniusShown ?? true)) t.push(GENIUS[p.genius]);
  return t;
}
export const roleAlive = (sim, k) => { const p = sim.idx[sim.roles[k]]; return p && p.alive && !p.lost && !(p.sick > 0) ? p : null; };

// ---------------- 天才 ----------------
const DOMAIN_OF_SKILL = { fire: 'fire', gather: 'herb', hunt: 'hunt', fish: 'hunt', chop: 'craft', build: 'craft', quarry: 'craft' };
export function bestDomain(p, r) {
  if (r && r() < 0.25) return 'art';
  const [k] = Object.entries(p.skills).sort((a, b) => b[1] - a[1])[0];
  return DOMAIN_OF_SKILL[k] || 'craft';
}
// 开局：一个创族的大人天生就是天才
export function seedGenius(sim) {
  const pool = sim.alive.filter(p => p.age >= 18 && p.age <= 47);
  if (!pool.length) return;
  const p = pool[sim.rng.int(pool.length)];
  p.genius = bestDomain(p, sim.rng);
  p.geniusShown = true;
}
// 新生儿偶尔是天才，长到 8 岁才看得出来（第一代只出第一代五行，不扰动 RNG）
export function maybeGenius(sim, baby) {
  const pool = sim.era3?.active ? GENIUS : sim.era2?.active ? GENIUS_ERA2 : GENIUS_ERA1;
  if (sim.rng() < K.tech.geniusBirth) { baby.genius = sim.rng.pick(Object.keys(pool)); baby.geniusShown = false; }
}

// ---------------- 每天 ----------------
export function dailyTech(sim) {
  refreshKnown(sim);
  assignRoles(sim);
  for (const p of sim.alive) if (p.genius && !p.geniusShown && p.age >= 8) {
    p.geniusShown = true;
    log(sim, `${p.name}才 ${Math.floor(p.age)} 岁，大家都看出来了：是个${GENIUS[p.genius]}`, 'birth', { who: p.id });
  }
  const R = sim.research;
  if (R.id) {
    const by = sim.idx[R.by];
    if (!by || researchScore(sim, by, R.id) < 0 || !by.alive) pickResearcher(sim);
    return;
  }
  // 你没定研究：过几天族人自己拿主意，挑最省事的
  const open = openTechs(sim);
  if (!open.length) return;
  if (++R.idle < K.tech.autoPickDays) return;
  const c = sim.idx[sim.roles.chief];
  const dom = c ? bestDomain(c) : null;
  open.sort((a, b) => workOf(sim, a) - workOf(sim, b) || (T(b).domain === dom) - (T(a).domain === dom));
  setResearch(sim, open[0], true);
}

export const techSummary = sim => {
  const ids = activeTechIds(sim);
  return {
    known: ids.filter(id => tribeKnows(sim, id)).length,
    total: ids.length,
    painted: Object.keys(sim.murals).length,
    lost: Object.keys(sim.lostTech).length,
  };
};
