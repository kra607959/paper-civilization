// 纸上文明 · 第一代：部落。纸面地图上，十个有名有姓的族人自己过日子；你是神，用三支笔管他们。
//   看：拖动看地图，点一下看族人。滚轮 / 两指缩放；右键、中键拖也能挪。
//   墨笔：在目标上写符 → 号令（要墨）。天上那一条写「雨」「火」。
//   铅笔：画线 → 探路 / 修路 / 迁徙；从图纸照着修的篱笆也用铅笔画走向。
//   朱笔：长线封锁、圈起来禁区、✕ 禁、○ 护、一刀划破启封。
//   图纸：火塘、窝棚、晾肉架、篱笆、石器台、陷阱、祭坛三段——照淡影一步步画，量出的数值就是房子的本事。
import { createSim, tick, summary } from '../sim/sim.js';
import { GAME_MIN_PER_SEC, STEP, DAY, YEAR_DAYS, DESIGNS, ERA2_DESIGNS, ERA3_DESIGNS, eraNum, K } from '../sim/config.js';
import { command, targetAt, unlockedCands, verbOf, lockOf, redLine, redGuard, redBan, unseal, scoutRoute, buildRoad, migrate, placeDesign, placeFenceLine, placeCityLine, planField, digCanal } from '../sim/commands.js';
import { createBot, botTick } from '../sim/bot.js';
import { designLock, altarStage, altarInk, altarBless, greatFlood } from '../sim/era.js';
import { canEnterEra2, enterEra2, matchGrandCanalStage, CANAL_STAGE_NAMES } from '../sim/era2.js';
import { canEnterEra3, enterEra3, enactCityLaw, repairCityWall, ringCityBell, setCityTax } from '../sim/era3.js';
import { bronzeIds, BRONZE_GLYPHS, recognizeBronze } from '../recog/bronze.js';
import { makeCityPanel, cityFocus, playCityBell } from './city.js';
import { fieldStateText, validateFieldPoly, updateCanalNetwork } from '../sim/farming.js';
import { known, mainFire, addFood, reveal, recalcLocalBonuses } from '../sim/util.js';
import { setResearch, learn, refreshKnown } from '../sim/tech.js';
import { symbolById, classIndex } from '../recog/symbols.js';
import { InkGrouper } from '../recog/group.js';
import { tooSmall } from '../recog/recognizer.js';
import { classifyRedStroke, classifyRedSymbol } from '../recog/redpen.js';
import { length, bbox, pointInPolygon } from '../recog/geom.js';
import { BLUEPRINTS } from '../recog/blueprint.js';
import { fitCanvas, paper, inkStroke, pencilStroke, ring, ghostText, polyline, COLORS } from '../ui/ink.js';
import { attachPen } from '../ui/pointer.js';
import { loadRecognizer, savePersonal } from '../ui/store.js';
import { openSheet } from '../sandbox/sheet.js';
import { createCamera, toScreen, toWorld, clampCamera, zoomAt, drawWorld, drawFog, drawNight, drawSky, drawWeather, drawEffects, drawLabels, sheetToMap, place } from './render.js';
import { renderTop, pushLog, renderLog, setFilter, renderWho, renderTech, renderVillage } from './hud.js';

const $ = s => document.querySelector(s);
const canvas = $('#map');
const NOW = () => performance.now();
const nameOf = id => (symbolById(id) || BRONZE_GLYPHS[id])?.name || id;
const SKY_H = 58;

let sim, bot = null, rec = null, seed = 0;
let speed = 1, lastSpeed = 1, sheetOpen = false, pen = 'look', selected = null, over = false, milestone = false, techOpen = false, villageOpen = false, eraShown = false, era2Shown = false, trialKey = '';
let cityOpen = false, era3Shown = false;
const cam = createCamera();
const stamps = [], fx = [];
let fxSeen = new WeakSet(), ghost = null, aim = null, placing = null, hover = null, skyTop = 60, bannerTimer = null;

// ---------------- 开局 ----------------
function newGame(s) {
  closePop();
  clearPending();
  $('#toast').replaceChildren();
  setPen('look');
  setSpeed(1);
  acc = 0;
  seed = s;
  sim = createSim(seed);
  sim.onLog = e => {
    pushLog(e);
    if (e.kind === 'death' || (e.kind === 'danger' && (e.big || e.band || /虎|狼|蝗|大水|大雨|山洪/.test(e.text)))) toast(e.text, 'warn');
    else if (e.kind === 'birth' || e.kind === 'build' || e.big) toast(e.text, 'good');
  };
  bot = null; selected = null; over = false; milestone = false; aim = null; placing = null; eraShown = false; era2Shown = false; trialKey = '';
  ghost = hover = lastOk = null;
  era3Shown = false;
  stamps.length = 0; fx.length = 0; fxSeen = new WeakSet();
  cam.x = sim.camp.x; cam.y = sim.camp.y + 40;
  cam.z = Math.max(0.45, Math.min(1.1, (innerWidth || 1200) / 1100));
  $('#over').hidden = true;
  $('#over').className = 'over';
  $('#eraBanner').hidden = true;
  clearTimeout(bannerTimer);
  renderWho(sim, null);
  toggleTech(false);
  toggleVillage(false);
  toggleCity(false);
  renderLog(sim);
  try { history.replaceState(null, '', `?seed=${seed}`); } catch {}
  say(`第 ${seed} 号纸：十个族人在河边落脚，四下还是白纸。先拖动看看营地，点一个族人看看在想什么。`);
}

// ---------------- 提示、吐司、弹框 ----------------
function say(html, cls = '') { const h = $('#hint'); h.innerHTML = html; h.className = `hud plate hint ${cls}`; }
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = `t ${cls}`;
  el.textContent = text;
  const box = $('#toast');
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.remove(), 5200);
}
let pop = null;
function closePop() {
  if (!pop) return;
  if (pop.stamp) pop.stamp.life = 0;
  pop.el.remove(); clearInterval(pop.timer); pop = null;
}
function showPop(at, html, kind, wire) {
  closePop();
  const el = document.createElement('div');
  el.className = 'pop plate';
  el.innerHTML = html;
  $('#pops').appendChild(el);
  const s = toScreen(cam, at), r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, s.x - r.width / 2))}px`;
  el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, s.y + 34))}px`;
  pop = { el, kind };
  wire?.(el);
  return pop;
}

// ---------------- 笔 ----------------
const HINTS = {
  look: '<b>看</b>：拖动挪地图，滚轮或两指缩放；点一个族人或农田看详情。<kbd>Q</kbd> 要写符，先换<b>墨笔</b>（<kbd>2</kbd>）',
  ink: () => `<b>墨笔</b>：在目标上写符，停笔一会儿就认。<b>天</b>：雨、火(雷)；<b>族人</b>：旗光火剑树；<b>树林/石堆/兽/河/空地</b>各有号令；${sim?.era2?.active ? '<b>农田</b>：树(播种) 剑(收割) 水(浇灌) 火(驱虫) 光(不季之穗)；<b>邻村</b>：旗(换陶) 水(议水) 剑(破坝) 光(显灵)。' : '<b>外族</b>：火旗剑光。'}<kbd>2</kbd>`,
  pencil: () => sim?.era2?.active
    ? '<b>铅笔</b>：画闭合圈可<b>划田</b>；画线靠近河泉可<b>挖水渠 / 修大渠</b>，也能<b>探路</b>、<b>修路</b>或<b>迁徙</b>。<kbd>1</kbd>'
    : '<b>铅笔</b>：画一条线，选<b>探路</b>（两人沿线走一趟，白纸变成地图）、<b>修路</b>或<b>迁徙</b>。<kbd>1</kbd>',
  red: '<b>朱笔</b>：长线是<b>封锁线</b>、首尾相接是<b>禁区</b>（挡野兽与劫掠者）；小 ✕ 是<b>禁</b>；小 ○ 是<b>护</b>；一刀划破自己的线是<b>启封</b>。<kbd>3</kbd>',
};
const hintText = p => (typeof HINTS[p] === 'function' ? HINTS[p]() : HINTS[p]);
const inkG = new InkGrouper(), redG = new InkGrouper({ pad: 18, minRadius: 30 });
const pending = new Set();
function clearPending() { for (const timer of pending) clearTimeout(timer); pending.clear(); }
let pencilCur = null, redCur = null, drag = null, mapTap = null;
function cancelStroke() { inkG.cancel(); redG.cancel(); pencilCur = redCur = drag = mapTap = null; }
function setPen(p) {
  pen = p;
  if (pop?.kind !== 'undo') closePop();
  cancelStroke();
  for (const b of document.querySelectorAll('[data-pen]')) b.classList.toggle('on', b.dataset.pen === p);
  if (!placing && !aim) say(hintText(p));
  canvas.style.cursor = p === 'look' ? 'grab' : 'crosshair';
}
for (const b of document.querySelectorAll('[data-pen]')) b.onclick = () => setPen(b.dataset.pen);
$('#bpBtn').onclick = () => openBlueprint();
$('#techBtn').onclick = () => toggleTech();
$('#villageBtn').onclick = () => toggleVillage();
$('#era2Btn').onclick = () => startEra2();
$('#era3Btn').onclick = () => startEra3();
$('#cityBtn').onclick = () => toggleCity();
$('#stats').addEventListener('click', e => { if (e.target.closest('[data-open="tech"]')) toggleTech(); });
$('#tech').addEventListener('click', e => {
  const r = e.target.closest('[data-research]');
  if (r) { const res = setResearch(sim, r.dataset.research || null); say(res.ok ? `技艺：${res.msg}` : `参谋：${res.msg}`, res.ok ? 'good' : 'warn'); renderTech(sim, true); return; }
  if (e.target.closest('[data-close]')) { toggleTech(false); return; }
  const a = e.target.closest('[data-sel]');
  if (a) select(a.dataset.sel, true);
});
$('#village').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) { toggleVillage(false); return; }
  const a = e.target.closest('[data-sel]');
  if (a) { select(a.dataset.sel, true); return; }
  const pan = e.target.closest('[data-pan-x]');
  if (pan) { cam.x = Number(pan.dataset.panX); cam.y = Number(pan.dataset.panY); clampCamera(cam); }
});
// 技艺、村务与小传在同一个左侧位置：开一个关另外两个
function toggleTech(on = !techOpen) {
  techOpen = on;
  if (on) {
    if (selected) { selected = null; renderWho(sim, null); }
    if (villageOpen) { villageOpen = false; renderVillage(sim, false); }
    if (cityOpen) toggleCity(false);
  }
  renderTech(sim, techOpen);
}
function toggleVillage(on = !villageOpen) {
  villageOpen = on;
  if (on) {
    if (selected) { selected = null; renderWho(sim, null); }
    if (techOpen) { techOpen = false; renderTech(sim, false); }
    if (cityOpen) toggleCity(false);
  }
  renderVillage(sim, villageOpen);
}
const renderCity = makeCityPanel($('#city'), { refresh: () => renderCity(sim, cityOpen), act: cityAction });
function toggleCity(on = !cityOpen) {
  cityOpen = !!(on && sim.era3?.active);
  if (cityOpen) {
    toggleTech(false); toggleVillage(false);
    selected = null; renderWho(sim, null);
  }
  $('#cityBtn').classList.toggle('on', cityOpen);
  renderCity(sim, cityOpen);
}
function cityAction(action, id) {
  if (!sim.era3?.active || over) return;
  let r;
  if (action === 'close') return toggleCity(false);
  if (action === 'plan' || (action === 'bell' && !sim.idx[sim.era3.bell])) return openBlueprint(id || 'bell');
  if (action === 'focus') {
    const p = cityFocus(sim, id);
    if (!p) return;
    toggleCity(false); cam.x = p.x; cam.y = p.y; clampCamera(cam); setPen('ink');
    say(`在${id === 'city' ? '城务台' : p.name + '的城印'}上照符谱写。按 <kbd>C</kbd> 可重开城务`);
    return;
  }
  if (action === 'cast') {
    const [sym, ref] = id.split(':'), p = cityFocus(sim, ref);
    if (!p) return;
    const ctx = ref === 'city' ? 'city' : 'polis', lk = lockOf(sim, ctx, sym);
    if (lk) { say(`「${nameOf(sym)}」：${lk}`, 'warn'); return; }
    intend(sym, { ctx, ref, x: p.x, y: p.y }, [], p);
    return;
  }
  if (action === 'repair') r = repairCityWall(sim);
  if (action === 'law') r = enactCityLaw(sim, id);
  if (action === 'tax') r = setCityTax(sim, id);
  if (action === 'bell') {
    r = ringCityBell(sim);
    if (r.ok) playCityBell(r.pitch, r.tone);
  }
  if (r) say(r.msg, r.ok ? 'good' : 'warn');
  renderCity(sim, cityOpen);
}
const setSpeed = v => { speed = v; if (v > 0) lastSpeed = v; };
for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => setSpeed(Number(b.dataset.speed));
for (const b of document.querySelectorAll('[data-filter]')) b.onclick = () => setFilter(sim, b.dataset.filter);
$('#homeBtn').onclick = () => { const f = mainFire(sim) || sim.camp; cam.x = f.x; cam.y = f.y + 40; clampCamera(cam); };
$('#newBtn').onclick = () => newGame(Math.floor(Math.random() * 99999) + 1);
$('#botBtn').onclick = () => toggleBot();
// 编年：点标题收起 / 展开（窄屏默认只露最新一条）
const chron = $('#chron');
if (innerWidth < 760) chron.classList.add('collapsed');
chron.querySelector('h3').onclick = () => chron.classList.toggle('collapsed');
$('#log').addEventListener('click', e => { const li = e.target.closest('[data-who]'); if (li) select(li.dataset.who, true); });
$('#who').addEventListener('click', e => {
  if (e.target.id === 'whoClose') select(null);
  const a = e.target.closest('[data-sel]');
  if (a) select(a.dataset.sel, true);
});

function select(id, center = false) {
  selected = id;
  if (id) {
    if (techOpen) { techOpen = false; renderTech(sim, false); }
    if (villageOpen) { villageOpen = false; renderVillage(sim, false); }
    if (cityOpen) toggleCity(false);
  }
  const p = id && sim.idx[id];
  if (p && center && p.alive) { cam.x = p.x; cam.y = p.y; clampCamera(cam); }
  renderWho(sim, selected);
}
// 点一下：族人（或农田）
function tapAt(w) {
  let best = null, bd = 28 / Math.min(1, cam.z);
  for (const p of sim.alive) { const d = Math.hypot(p.x - w.x, p.y - 15 - w.y); if (d < bd) { bd = d; best = p; } }
  if (best) { select(best.id); return; }
  select(null);
  const fld = (sim.fields || []).find(f => pointInPolygon(w, f.pts));
  if (fld) say(`<b>${fld.name}</b>：${fieldStateText(sim, fld)}（墨笔在田里写：树=播种，剑=收割，水=浇灌，火=驱虫）`);
}

// ---------------- 托管：机器人替你当神 ----------------
function toggleBot() {
  if (bot) { bot = null; toast('收回了：你来当神'); return; }
  if (!rec) { toast('识别模型还在载入', 'warn'); return; }
  bot = createBot(sim, { recognizer: rec });
  bot.onWrite = ({ tgt, sym, strokes, decision, ok }) => {
    if (!strokes) return;
    const at = tgt.ctx === 'sky' ? toWorld(cam, { x: cam.vw * 0.5, y: skyTop + SKY_H * 0.5 }) : { x: tgt.x, y: tgt.y - 30 };
    stamps.push({ strokes: place(strokes, at.x, at.y, 46 / Math.max(0.5, cam.z) * 0.9), color: ok ? COLORS.ink : COLORS.red, t0: NOW(), life: 1800 });
    ghost = { text: ok ? `${nameOf(sym)}·${verbOf(tgt.ctx, sym)?.verb || ''}` : decision === 'pick' ? '？' : '✗', x: at.x, y: at.y, t0: NOW(), color: ok ? COLORS.ink : COLORS.red };
  };
  bot.onDesign = ({ id }) => toast(`托管：照图纸开工 ${BLUEPRINTS[id].name}`, 'good');
  toast('托管：机器人替你当神（写符照样过识别器）。再点一下收回。', 'good');
}

// ---------------- 墨笔：写符 ----------------
function ringOf(strokes) {
  const b = bbox(strokes);
  return { cx: b.cx, cy: b.cy, r: Math.max(42 / cam.z, Math.hypot(b.w, b.h) / 2 + 26 / cam.z) };
}
function targetFor(c) {
  const s = toScreen(cam, c);
  if (s.y < skyTop + SKY_H) return { ctx: 'sky', name: '天' };
  return targetAt(sim, c.x, c.y);
}
const CTX_NAME = { sky: '天', folk: '族人', wood: '树林', rock: '石堆', beast: '兽', river: '河', land: '空地', band: '外族', field: '农田', village: '邻村', city: '城务台', polis: '邻邦' };
const verbsText = ctx => unlockedCands(ctx, sim).map(id => `${nameOf(id)}${verbOf(ctx, id).verb}`).join(' ');

// 刚生效的符（圈、时间）。紧跟着在它圈里补的一笔（比如雨写到第三笔就认出来了，第四点单独成了一组），没认出来也不报错
let lastOk = null;
function handleInk(group) {
  const strokes = group.strokes;
  if (tooSmall(strokes.map(s => s.map(p => toScreen(cam, p))))) { if (strokes.length === 1) tapAt(strokes[0][0]); return; }
  if (!rec) { say('识别模型还在载入，稍等一下', 'warn'); return; }
  const rg = ringOf(strokes), c = { x: rg.cx, y: rg.cy };
  const tgt = targetFor(c);
  const stamp = { strokes, color: COLORS.ink, t0: NOW(), life: 2500 };
  stamps.push(stamp);
  group.stamp = stamp;
  if (!tgt.ctx) { stamp.color = COLORS.red; ghost = { text: '？', x: c.x, y: c.y, t0: NOW(), color: COLORS.red }; say(`参谋：${tgt.why}`, 'warn'); inkG.park(group, NOW()); return; }
  const cands = unlockedCands(tgt.ctx, sim);
  const res = bronzeIds(tgt.ctx) ? recognizeBronze(strokes, cands) : rec.recognize(strokes, { cands });
  const p0 = strokes[0][0];
  if (res.decision !== 'accept' && lastOk && group.t0 - lastOk.t < 1500 && Math.hypot(p0.x - lastOk.rg.cx, p0.y - lastOk.rg.cy) <= lastOk.rg.r) {
    stamp.life = 700; lastOk.t = NOW();
    return;
  }
  const lock = res.pGlobal >= rec.tune.elsewhere && lockOf(sim, tgt.ctx, res.global);
  if (lock && (res.decision === 'reject' || res.decision === 'elsewhere')) {
    stamp.color = COLORS.red;
    ghost = { text: nameOf(res.global), x: c.x, y: c.y, t0: NOW(), color: COLORS.red };
    say(`参谋：「${nameOf(res.global)}·${verbOf(tgt.ctx, res.global).verb}」还没学会（${lock}）`, 'warn');
    inkG.park(group, NOW());
    return;
  }
  if (res.decision === 'reject') {
    stamp.color = COLORS.red;
    ghost = { text: '？', x: c.x, y: c.y, t0: NOW(), color: COLORS.red };
    say(`参谋：神意不明（${tgt.name || CTX_NAME[tgt.ctx]}上只认 ${verbsText(tgt.ctx)}；不扣墨）`, 'warn');
    inkG.park(group, NOW());
    return;
  }
  if (res.decision === 'elsewhere') {
    stamp.color = COLORS.red;
    ghost = { text: nameOf(res.global), x: c.x, y: c.y, t0: NOW(), color: COLORS.red };
    say(`参谋：认出是「${nameOf(res.global)}」，但${tgt.name || CTX_NAME[tgt.ctx]}上用不上（不扣墨）`, 'warn');
    inkG.park(group, NOW());
    return;
  }
  if (res.decision === 'pick') {
    stamp.life = 1e9;
    showPop(c, `<span class="lab">拿不准，是哪个？</span>${res.choices.map(id => `<button data-id="${id}">${nameOf(id)} · ${verbOf(tgt.ctx, id).verb}</button>`).join('')}<button data-id="">都不是</button>`, 'pick', el => {
      el.querySelectorAll('button').forEach(b => (b.onclick = () => {
        closePop();
        inkG.parked = null;
        if (b.dataset.id) intend(b.dataset.id, tgt, strokes, c);
        else say('参谋：那就当没写（不扣墨）');
      }));
    }).stamp = stamp;
    inkG.park(group, NOW());
    return;
  }
  lastOk = { rg: inkG.ring(strokes), t: NOW() };
  intend(res.top, tgt, strokes, c);
}
// 认定了：先显虚影；收不回来的要确认；雷火还要点在哪儿劈
function intend(sym, tgt, strokes, c) {
  const v = verbOf(tgt.ctx, sym);
  ghost = { text: `${nameOf(sym)}·${v.verb}`, x: c.x, y: c.y, t0: NOW(), color: COLORS.ink };
  if (sim.ink < v.ink) { say(`参谋：墨不够（「${v.verb}」要 ${v.ink} 墨，现有 ${Math.floor(sim.ink)}）`, 'warn'); return; }
  if (tgt.ctx === 'sky' && sym === 'huo') {
    aim = { sym, strokes };
    say('<b>雷火</b>：点地图上要劈的地方（收不回来；八十步内的野兽、四十五步内的树、三十步内的人都会被劈）。<kbd>Esc</kbd> 取消', 'warn');
    return;
  }
  if (v.confirm) {
    showPop(c, `<span class="lab">「${v.verb}」收不回来，确定？</span><button class="red" data-ok="1">${v.verb}（${v.ink} 墨）</button><button>算了</button>`, 'confirm', el => {
      el.querySelectorAll('button').forEach(b => (b.onclick = () => { closePop(); if (b.dataset.ok) execute(sym, tgt, strokes, c, false); else say(`参谋：收回了「${v.verb}」`); }));
    });
    return;
  }
  const timer = setTimeout(() => { pending.delete(timer); if (!over) execute(sym, tgt, strokes, c, true); }, 380);
  pending.add(timer);
}
function execute(sym, tgt, strokes, c, undoable, at = null) {
  const a = { ctx: tgt.ctx, sym, ref: tgt.ref ?? null, x: at ? at.x : tgt.x ?? c.x, y: at ? at.y : tgt.y ?? c.y };
  const r = command(sim, a);
  if (!r.ok) { say(`参谋：${r.msg}`, 'warn'); return; }
  if (strokes.length && !BRONZE_GLYPHS[sym]) {
    rec.addPersonal(sym, strokes); // 旧十符仍能学习玩家笔迹
    savePersonal(rec);
  }
  say(`${BRONZE_GLYPHS[sym] ? r.verb : `${nameOf(sym)}·${r.verb}`}（${r.cost} 墨）：${r.msg}`, 'good');
  if (!undoable || !r.undo) return;
  let left = 3;
  const p = showPop(c, `<button data-u="1">撤回 <span>${left}</span></button>`, 'undo', el => {
    el.querySelector('button').onclick = () => {
      closePop();
      if (!r.undo()) { say(`「${r.verb}」已不能撤回`, 'warn'); return; }
      const i = rec.personal[classIndex(sym)].findIndex(it => it.strokes === strokes);
      if (i >= 0) { rec.removePersonal(sym, i); savePersonal(rec); }
      say(`撤回了「${r.verb}」，墨退回`);
    };
  });
  p.timer = setInterval(() => { left--; if (left <= 0) closePop(); else p.el.querySelector('span').textContent = left; }, 1000);
}

// ---------------- 朱笔 ----------------
const walls = () => sim.barriers.filter(b => b.kind === 'red' || b.kind === 'zone');
function handleRedStroke(s) {
  const W = walls();
  const k = classifyRedStroke(s, W.map(b => ({ points: b.closed ? [...b.pts, b.pts[0]] : b.pts })), 1 / cam.z);
  if (k.kind === 'unseal') { unseal(sim, W[k.line].id); say('朱笔一刀：启封'); return true; }
  if (k.kind === 'line' || k.kind === 'zone') {
    const r = redLine(sim, s, { closed: k.kind === 'zone' });
    if (!r.ok) say(`参谋：${r.msg}`, 'warn');
    else say(k.kind === 'zone' ? `朱笔圈出禁区（${r.cost} 墨，承受 ${r.barrier.hp}）：野兽进不来，顶久了会破` : `朱笔封锁线（${r.cost} 墨，承受 ${r.barrier.hp}）：野兽过不去，顶久了会破`, r.ok ? 'good' : 'warn');
    return true;
  }
  return false;
}
function handleRedSymbol(group) {
  const strokes = group.strokes, b = bbox(strokes), c = { x: b.cx, y: b.cy };
  const k = classifyRedSymbol(strokes, 1 / cam.z);
  stamps.push({ strokes, color: COLORS.red, t0: NOW(), life: k.kind === 'unknown' ? 1500 : 900 });
  if (k.kind === 'unknown') { say(`参谋：${k.why}`, 'warn'); return; }
  const t = targetAt(sim, c.x, c.y);
  let r;
  if (k.kind === 'forbid') r = redBan(sim, t);
  else r = t.ctx === 'folk' && t.ref === 'camp' ? redGuard(sim, sim.camp.x, sim.camp.y, sim.camp.r + 40) : redGuard(sim, c.x, c.y, Math.max(70, Math.max(b.w, b.h) * 1.2));
  if (!r.ok) say(`参谋：${r.msg}`, 'warn');
  else say(k.kind === 'forbid' ? `朱笔 ✕：${t.name}禁了` : '朱笔 ○：护住这一圈，野兽进不来（承受 60）', 'good');
}

// ---------------- 铅笔 ----------------
const simplify = (s, d = 18) => { const out = [s[0]]; for (const p of s) if (Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) >= d) out.push(p); if (out.length < 2 || out[out.length - 1] !== s[s.length - 1]) out.push(s[s.length - 1]); return out.map(p => ({ x: p.x, y: p.y })); };
function handlePencil(s) {
  const L = length(s);
  if (L < 10 / cam.z) { tapAt(s[0]); return; }
  if (placing?.line) { placeFence(s); return; }
  if (L < 60) { say('参谋：线太短了', 'warn'); return; }
  const pts = simplify(s), z = pts[pts.length - 1];
  const intoFog = pts.some(p => !known(sim, p.x, p.y)), V = sim.map.valley;
  const toValley = sim.era.flooded && !sim.era.done && Math.hypot(z.x - V.x, z.y - V.y) < K.era.valleyR;
  const gap = Math.hypot(s[0].x - s[s.length - 1].x, s[0].y - s[s.length - 1].y);
  const perim = L + gap;
  const closedLike = !!sim.era2?.active && s.length >= 6 && gap <= Math.min(85, Math.max(36, 0.18 * perim));
  const grandSt = sim.era2?.active && !closedLike ? matchGrandCanalStage(sim, pts) : 0;
  const stamp = { strokes: [s], color: COLORS.pencil, t0: NOW(), life: 1e9, pencil: true };
  stamps.push(stamp);
  const era2Btns = sim.era2?.active
    ? `${closedLike ? '<button data-k="field" class="primary">划田（开垦农田）</button>' : ''}<button data-k="canal" class="${!closedLike && grandSt ? 'primary' : ''}">${grandSt ? `${CANAL_STAGE_NAMES[grandSt]}（${K.era2.canalInk[grandSt - 1]} 墨）` : '挖水渠（引水灌溉）'}</button>`
    : '';
  const roadPrimary = !intoFog && !toValley && !closedLike && !grandSt;
  const migrateButton = sim.era3?.active ? '' : `<button data-k="migrate" class="${toValley ? 'primary' : ''}">迁徙到终点</button>`;
  showPop(z, `<span class="lab">${closedLike ? '圈出这片地做什么？' : '这条线是？'}</span>${era2Btns}<button data-k="scout" class="${intoFog && !toValley && !closedLike ? 'primary' : ''}">探路（两人走一趟）</button><button data-k="road" class="${roadPrimary ? 'primary' : ''}">修路（走得快）</button>${migrateButton}<button data-k="">算了</button>`, 'confirm', el => {
    el.querySelectorAll('button').forEach(b => (b.onclick = () => {
      closePop();
      const k = b.dataset.k;
      if (k === 'field') { const r = planField(sim, s); say(r.ok ? `铅笔：划出${r.field.name}，族人会去开垦整地` : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); }
      else if (k === 'canal') { const r = digCanal(sim, pts); say(r.ok ? (r.grandStage ? `大渠第 ${r.grandStage} 段开工！` : `铅笔：挖水渠 ${r.canal.segs.length} 段`) : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); }
      else if (k === 'scout') { const r = scoutRoute(sim, pts); say(r.ok ? '铅笔：探路的人上路了，走过的白纸会变成地图' : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); }
      else if (k === 'road') { const r = buildRoad(sim, pts); say(r.ok ? `铅笔：修路，${r.road.segs.length} 段` : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); }
      else if (k === 'migrate') {
        showPop(z, `<span class="lab">全族带着火种沿这条线${toValley ? '去新河谷' : '搬过去'}，营地、房子都留在原地。确定？</span><button class="red" data-ok="1">迁徙</button><button>算了</button>`, 'confirm', el2 => {
          el2.querySelectorAll('button').forEach(b2 => (b2.onclick = () => { closePop(); if (b2.dataset.ok) { const r = migrate(sim, pts); say(r.ok ? `全族带着火种上路了：路长约 ${r.len} 步，大人背着孩子走得慢。路上照看着点（野兽、水）` : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); } }));
        });
      }
    }));
  }).stamp = stamp;
}

// ---------------- 图纸 ----------------
// 祭坛三段只摆眼下该修的那一段；第二代开放农耕时代 5 张新图纸
const altarNext = () => `altar${Math.min(3, altarStage(sim) + 1)}`;
const sheetIds = () => {
  const era1 = DESIGNS.filter(id => !id.startsWith('altar') || id === altarNext());
  return sim.era3?.active ? [...ERA3_DESIGNS, ...ERA2_DESIGNS, ...era1] : sim?.era2?.active ? [...ERA2_DESIGNS, ...era1] : era1;
};
const altarBackdrop = id => {
  const A = sim.era.altar, n = Number(id.slice(-1));
  if (!A || !id.startsWith('altar') || n < 2) return null;
  return [1, 2].filter(k => k < n && A.strokes[k]).flatMap(k => Object.values(A.strokes[k]).flat());
};
function openBlueprint(start = placing?.id || (sim.era3?.active ? 'furnace' : sim?.era2?.active ? 'granary' : 'hearth')) {
  if (sheetOpen || over) return;
  sheetOpen = true;
  closePop();
  cancelStroke();
  clearPending();
  if (start.startsWith('altar')) start = altarNext();
  openSheet($('#sheet'), {
    ids: sheetIds(), start, buildLabel: '照图建造：回地图点个地方',
    locked: id => designLock(sim, id),
    backdrop: altarBackdrop,
    buildText: bp => (bp.place === 'altar' ? `在祭坛上开工（${altarInk(bp.id)} 墨，修的时候再吸 ${altarBless(bp.id)} 墨）` : bp.id === 'altar1' ? `照图建造：回地图点个地方（开工 ${altarInk('altar1')} 墨）` : bp.place === 'river' ? '照图建桥：回地图点河岸附近' : bp.id === 'citywall' ? '回地图围城画圈' : bp.id === 'cartway' ? '回地图画线连城与村' : null),
    onClose: () => { sheetOpen = false; },
    onBuilt(S) {
      const bp = S.bp;
      if (bp.place === 'altar') {
        const r = placeDesign(sim, bp.id, S.params(), 0, 0, S.strokes);
        say(r.ok ? `照图纸在祭坛上开工：${bp.name}。族人会自己去备料；修的时候神的墨一点点流进去开光（留四成应急），墨不够就先停工` : `参谋：${r.msg}`, r.ok ? 'good' : 'warn');
        return;
      }
      placing = { id: bp.id, params: S.params(), strokes: S.strokes, line: bp.place === 'line', name: bp.name };
      if (cityOpen) toggleCity(false);
      setPen(placing.line ? 'pencil' : 'look');
      if (bp.id === 'citywall' || bp.id === 'cartway') {
        say(bp.id === 'citywall' ? '用铅笔沿想修墙的位置画一圈，把城心围在里面。<kbd>Esc</kbd> 取消' : '用铅笔画一条线，从城心连到禾汀或柳渡。<kbd>Esc</kbd> 取消', 'good');
        return;
      }
      say(placing.line ? `<b>${bp.name}</b>：用铅笔在地图上画出篱笆的走向（每 40 步一段，每段约 ${placing.params.woodPer40} 木）。<kbd>Esc</kbd> 取消` : bp.place === 'river' ? `<b>${bp.name}</b>：点地图上河岸附近要架桥的位置。<kbd>Esc</kbd> 取消` : `<b>${bp.name}</b>：点地图上要盖的地方（营地附近、别挨着别的房子和火）。<kbd>Esc</kbd> 取消`, 'good');
    },
  });
}
function placePoint(w) {
  const r = placeDesign(sim, placing.id, placing.params, w.x, w.y, placing.strokes);
  if (!r.ok) { say(`参谋：${r.msg}——换个地方点`, 'warn'); return; }
  const name = placing.name;
  placing = null;
  setPen('look');
  say(`照图纸开工：${name}（要${Object.entries(r.site.need).map(([k, n]) => `${{ wood: '木', stone: '石', grass: '草', bronze: '青铜' }[k]} ${n}`).join('、') || '人手'}${r.site.bless ? `；修的时候再吸 ${r.site.bless} 墨开光` : ''}）。族人会自己去备料、动工`, 'good');
}
function placeFence(s) {
  const pts = simplify(s, 12);
  if (placing.id === 'citywall' || placing.id === 'cartway') {
    const r = placeCityLine(sim, placing.id, placing.params, pts, placing.strokes);
    if (r.ok) { placing = null; setPen('look'); }
    say(r.ok ? `${r.site.name}开工，族人会沿你画的线修` : `参谋：${r.msg}`, r.ok ? 'good' : 'warn');
    return;
  }
  const r = placeFenceLine(sim, placing.params, pts, placing.strokes);
  if (!r.ok) { say(`参谋：${r.msg}`, 'warn'); return; }
  placing = null;
  setPen('look');
  say(`照图纸修篱笆：${r.fence.segs.length} 段，族人会一段段备料、立桩`, 'good');
}

// ---------------- 输入 ----------------
let pinch = null;
const touches = new Map();
attachPen(canvas, {
  toWorld: p => toWorld(cam, p),
  onDown(p, t, e) {
    if (pinch || over) return;
    if (pop && pop.kind !== 'undo') closePop();
    if (aim || (placing && !placing.line)) { mapTap = { x: e.clientX, y: e.clientY }; return; }
    if (pen === 'look') { drag = { sx: e.clientX, sy: e.clientY, x: cam.x, y: cam.y, moved: false, w: p, len: 0, lx: e.clientX, ly: e.clientY }; canvas.style.cursor = 'grabbing'; }
    else if (pen === 'ink') {
      const closed = inkG.down(p, t);
      if (closed) handleInk(closed);
      const r = inkG.group?.resumed;
      if (r && !r.taken) { r.taken = true; if (r.stamp) r.stamp.life = 0; ghost = null; say('接着写：和刚才没认出来的那几笔算一个符'); }
    }
    else if (pen === 'red') { redCur = [{ ...p, t }]; const closed = redG.down(p, t); if (closed) handleRedSymbol(closed); }
    else pencilCur = [{ ...p, t }];
  },
  onMove(p, t, e) {
    if (pinch) return;
    if (mapTap) { if (Math.hypot(e.clientX - mapTap.x, e.clientY - mapTap.y) > 8) mapTap.moved = true; return; }
    if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      drag.len += Math.hypot(e.clientX - drag.lx, e.clientY - drag.ly); drag.lx = e.clientX; drag.ly = e.clientY;
      cam.x = drag.x - dx / cam.z; cam.y = drag.y - dy / cam.z; clampCamera(cam);
    } else if (pen === 'ink') inkG.move(p, t);
    else if (pen === 'red') { redCur?.push({ ...p, t }); redG.move(p, t); }
    else pencilCur?.push({ ...p, t });
  },
  onUp(p, t, e) {
    if (mapTap) {
      const tap = mapTap;
      mapTap = null;
      if (tap.moved || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) return;
      if (aim) {
        if (!known(sim, p.x, p.y)) { say('参谋：那边还是白纸，劈不着', 'warn'); return; }
        const a = aim; aim = null;
        setPen(pen);
        execute(a.sym, { ctx: 'sky' }, a.strokes, p, false, p);
      } else if (placing && !placing.line) placePoint(p);
      return;
    }
    if (drag) { if (!drag.moved) tapAt(drag.w); else lookScribble(drag, t); drag = null; canvas.style.cursor = 'grab'; return; }
    if (pinch) return;
    if (pen === 'ink') inkG.up(t);
    else if (pen === 'red' && redCur) {
      const s = redCur;
      redCur = null;
      redG.up(t);
      if (handleRedStroke(s)) { const g = redG.group; if (g) { g.strokes.pop(); if (!g.strokes.length) redG.cancel(); } }
    } else if (pencilCur) { const s = pencilCur; pencilCur = null; handlePencil(s); }
  },
  onCancel() { cancelStroke(); canvas.style.cursor = pen === 'look' ? 'grab' : 'crosshair'; },
  onHover(p, t) {
    hover = p;
    if (pen === 'ink') inkG.hover(p, t);
    else if (pen === 'red') redG.hover(p, t);
  },
});
// 拿着「看」笔写符，只会把地图拖来拖去。拖的路比起点到终点长得多（绕圈、来回折），多半是在写：提醒换墨笔
let scribbleWarnAt = -1e9;
function lookScribble(d, t) {
  const net = Math.hypot(d.lx - d.sx, d.ly - d.sy);
  if (d.len < 60 || d.len < 2.2 * Math.max(net, 1) || t - scribbleWarnAt < 20000) return;
  scribbleWarnAt = t;
  toast('你拿的是「看」：拖动只会挪地图。写符先点下面的「墨笔」，或按 2', 'warn');
  say('拿着<b>看</b>拖动只会挪地图，不会写符。写符先换<b>墨笔</b>（<kbd>2</kbd>），再写在族人、树林、天上', 'warn');
  const b = document.querySelector('[data-pen="ink"]');
  b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
}
// 右键、中键拖：挪地图；滚轮：缩放
let rdrag = null;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      cancelStroke();
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    return;
  }
  if (e.button === 1 || e.button === 2) { rdrag = { sx: e.clientX, sy: e.clientY, x: cam.x, y: cam.y }; e.preventDefault(); }
});
addEventListener('pointermove', e => {
  if (rdrag) { cam.x = rdrag.x - (e.clientX - rdrag.sx) / cam.z; cam.y = rdrag.y - (e.clientY - rdrag.sy) / cam.z; clampCamera(cam); }
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      cam.x -= (cx - pinch.cx) / cam.z; cam.y -= (cy - pinch.cy) / cam.z;
      const r = canvas.getBoundingClientRect();
      zoomAt(cam, { x: cx - r.left, y: cy - r.top }, d / (pinch.d || d));
      pinch = { d, cx, cy };
    }
  }
});
const endTouch = e => { touches.delete(e.pointerId); if (touches.size === 0) pinch = null; };
addEventListener('pointerup', e => { rdrag = null; endTouch(e); });
addEventListener('pointercancel', e => { rdrag = null; endTouch(e); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(cam, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
addEventListener('keydown', e => {
  if (sheetOpen || e.target?.matches?.('input, select, textarea')) return;
  const k = e.key;
  if (k === '1') setPen('pencil');
  else if (k === '2') setPen('ink');
  else if (k === '3') setPen('red');
  else if (k === '4') openBlueprint();
  else if (k === 'q' || k === 'Q') setPen('look');
  else if (k === 't' || k === 'T') toggleTech();
  else if (k === 'v' || k === 'V') toggleVillage();
  else if (k === 'c' || k === 'C') toggleCity();
  else if (k === ' ') { e.preventDefault(); setSpeed(speed ? 0 : lastSpeed); }
  else if (k === 'Escape') { cancelStroke(); clearPending(); closePop(); if (aim || placing) { aim = null; placing = null; setPen(pen); say('取消了'); } else if (techOpen) toggleTech(false); else if (villageOpen) toggleVillage(false); else if (cityOpen) toggleCity(false); }
  else if (k === 'Enter') { const g = inkG.close(); if (g) handleInk(g); }
  else if (k === '+' || k === '=') zoomAt(cam, { x: cam.vw / 2, y: cam.vh / 2 }, 1.2);
  else if (k === '-') zoomAt(cam, { x: cam.vw / 2, y: cam.vh / 2 }, 1 / 1.2);
  else if (/^Arrow|^[wasdWASD]$/.test(k)) {
    const d = 120 / cam.z, m = { ArrowLeft: [-d, 0], a: [-d, 0], A: [-d, 0], ArrowRight: [d, 0], d: [d, 0], D: [d, 0], ArrowUp: [0, -d], w: [0, -d], W: [0, -d], ArrowDown: [0, d], s: [0, d], S: [0, d] }[k];
    if (m) { cam.x += m[0]; cam.y += m[1]; clampCamera(cam); e.preventDefault(); }
  } else if (k === 'h' || k === 'H') $('#homeBtn').click();
});

// ---------------- 主循环：真实时钟，一倍速一天约一分钟 ----------------
let lastT = NOW(), acc = 0, hudAt = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (!sheetOpen && speed > 0 && !over && sim.alive.length) {
    acc += dt * speed * GAME_MIN_PER_SEC;
    let n = 0;
    while (acc >= STEP && n < 600 && sim.alive.length) {
      tick(sim); acc -= STEP; n++;
      if ((!eraShown && sim.era.done) || (!era2Shown && sim.era2?.done) || (!era3Shown && sim.era3?.done)) { acc = 0; break; }
      if (bot) botTick(bot);
    }
    if (acc > STEP * 30) acc = 0;
  }
  for (const f of sim.effects) if (!fxSeen.has(f)) {
    fxSeen.add(f);
    fx.push({ ...f, t0: now, dur: f.kind === 'bolt' ? 900 : f.kind === 'light' ? 3200 : 2600 });
  }
  if (!over && !sim.alive.length) gameOver();
  if (!milestone && sim.day >= 2 * YEAR_DAYS && sim.alive.length) { milestone = true; toast(`两年了，部落还在：${sim.alive.length} 人。${altarStage(sim) < 3 ? '把祭坛三段修齐，墨池里能看见往后的事' : '大水要来了，早做打算'}`, 'good'); }
  trialHint();
  if (!eraShown && sim.era.done) { eraShown = true; victory(); }
  if (!era2Shown && sim.era2?.done) { era2Shown = true; victoryEra2(); }
  if (!era3Shown && sim.era3?.done) { era3Shown = true; victoryEra3(); }
  draw(now);
  if (now - hudAt > 180) { hudAt = now; renderTop(sim, { speed, bot: !!bot, villageOpen }); renderWho(sim, selected); renderTech(sim, techOpen); renderVillage(sim, villageOpen); renderCity(sim, cityOpen); }
  requestAnimationFrame(frame);
}
// 大水后：提示怎么带全族去新河谷（河谷知道没知道、上没上路，各说一次）
function trialHint() {
  const E = sim.era, k = E.flooded && !E.done ? `${E.valleyKnown}|${!!sim.march}` : '';
  if (k === trialKey) return;
  trialKey = k;
  if (!k || sim.march) return;
  say(E.valleyKnown
    ? '<b>大水</b>：旧营地淹了。用<b>铅笔</b>从营地画一条路到绿圈里的<b>新河谷</b>，选「迁徙到终点」。路上有被水赶出来的狼，绕着走；六天里不画，首领会自己直直地带人走。<kbd>1</kbd>'
    : '<b>大水</b>：旧营地淹了。用<b>铅笔</b>往白纸里画线、选「探路」，找到新河谷再画路迁过去。<kbd>1</kbd>', 'warn');
}
// 迈入第二代 · 农耕时代（彩陶）
function startEra2() {
  const res = enterEra2(sim);
  if (!res.ok) { toast(res.msg, 'warn'); return; }
  over = false;
  $('#over').hidden = true;
  $('#over').className = 'over';
  $('#toast').replaceChildren();
  if (speed === 0) setSpeed(lastSpeed || 1);
  cam.x = sim.camp.x; cam.y = sim.camp.y + 40;
  clampCamera(cam);
  const ban = $('#eraBanner');
  ban.hidden = false;
  ban.innerHTML = '<h2>第二代 · 农耕时代（彩陶）</h2><p>全族在新河谷定居。用铅笔画闭合圈划田、连河挖水渠；点开「村务」（V）可查看大渠三段与户籍。</p>';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { ban.hidden = true; }, 4800);
  renderTop(sim, { speed, bot: !!bot, villageOpen });
  say('<b>农耕时代开启</b>：拿<b>铅笔</b>（<kbd>1</kbd>）画闭合圈可划田，拉长线连河泉可挖水渠；在<b>图纸</b>（<kbd>4</kbd>）学建粮仓与陶窑，点<b>村务</b>（<kbd>V</kbd>）看大渠三段。', 'good');
}

// 第一代过了：收尾页
function victory() {
  const r = sim.era.result, st = sim.stats;
  over = true;
  closePop(); cancelStroke(); clearPending();
  const band = r.merged ? '并了过来，从此是一族' : st.marriages ? `结了 ${st.marriages} 门亲` : sim.band?.met ? '没走到一起' : '没碰过面';
  $('#over').hidden = false;
  $('#over').className = 'over';
  $('#over').innerHTML = `<div class="plate box"><div class="seal-head"><span class="seal-badge">第一代</span><h2>部落篇 · 大水过关</h2></div>
    <p>${r.early ? '大水来时，全族早已照着墨池里看见的，在新河谷安了家。' : `大水冲平了旧营地。全族沿着${r.auto ? '首领认的路' : '你画的路'}走到新的河谷，在这里扎下了营。`}</p>
    <div class="grid">
      <span>过了</span><span><b>${r.years}</b> 年（${r.day} 天）</span>
      <span>人</span><span>活下来 <b>${r.pop}</b> 人${r.early ? '' : `（出发时 ${r.startPop}，路上没了 ${r.lost}）`}</span>
      <span>生死</span><span>生了 <b>${r.births}</b> 个孩子，走了 ${r.deaths} 个人</span>
      <span>手艺</span><span>会 <b>${r.techs}</b> 门，石壁上画了 ${r.painted} 幅</span>
      <span>祭坛</span><span>修到第 <b>${r.altar}</b> 段${r.altar >= 3 ? '，有了墨池' : ''}</span>
      <span>苇族</span><span>${band}</span>
      <span>天才</span><span>${r.geniuses} 个</span>
      <span>神的墨</span><span>一共花了 <b>${r.ink}</b> 墨</span>
    </div>
    <p class="small muted">前路已开：保留人手、手艺、亲属与库存，直接进入同一个世界的农耕时代（彩陶）。</p>
    <div class="cta-row"><button class="primary" id="enterEra2Btn">迈入第二代 · 农耕时代（陶）</button><button id="goOnBtn">留在部落篇继续</button><button id="againBtn">再开一张纸</button><button id="sameBtn">同一张纸重来</button></div></div>`;
  $('#enterEra2Btn').onclick = () => startEra2();
  $('#goOnBtn').onclick = () => { over = false; $('#over').hidden = true; };
  $('#againBtn').onclick = () => newGame(Math.floor(Math.random() * 99999) + 1);
  $('#sameBtn').onclick = () => newGame(seed);
}

// 第二代过了：农耕篇收尾页
function victoryEra2() {
  const r = sim.era2.result;
  over = true;
  closePop(); cancelStroke(); clearPending();
  $('#over').hidden = false;
  $('#over').className = 'over era2';
  $('#over').innerHTML = `<div class="plate box"><div class="seal-head"><span class="seal-badge">第二代</span><h2>农耕篇 · 大渠安澜</h2></div>
    <p>三段大渠贯通南北，上游洪水顺渠分泄入下游。河谷稻谷盈仓、窑火不绝，族人从此定居耕织。</p>
    <div class="grid">
      <span>农耕历时</span><span><b>${r.years}</b> 年（${r.days} 天 · 累计第 ${r.totalYears} 年）</span>
      <span>人口户籍</span><span>活下来 <b>${r.pop}</b> 人 · 共 <b>${r.households}</b> 户</span>
      <span>稻谷收成</span><span>累计打粮 <b>${r.grain}</b> 份 · 陶罐 <b>${r.pottery}</b> 只</span>
      <span>时代工程</span><span>大渠修通第 <b>${r.canalStage}</b> 段 · 分洪成功</span>
      <span>手艺</span><span>共会 <b>${r.techs}</b> 门手艺</span>
      <span>青陶村</span><span>好感指数 <b>${r.villageMood}</b></span>
      <span>神的墨</span><span>累计用墨 <b>${r.ink}</b> 墨</span>
    </div>
    <div class="cta-row"><button class="primary" id="enterEra3Btn">迈入第三代 · 青铜城邦</button><button id="goOn2Btn">留在农耕篇</button><button id="againBtn">再开一张纸</button><button id="sameBtn">同一张纸重来</button></div></div>`;
  $('#enterEra3Btn').onclick = startEra3;
  $('#goOn2Btn').onclick = () => { over = false; $('#over').hidden = true; };
  $('#againBtn').onclick = () => newGame(Math.floor(Math.random() * 99999) + 1);
  $('#sameBtn').onclick = () => newGame(seed);
}
function startEra3() {
  const r = enterEra3(sim);
  if (!r.ok) { toast(r.msg, 'warn'); return; }
  over = false;
  $('#over').hidden = true; $('#over').className = 'over';
  if (!speed) setSpeed(lastSpeed || 1);
  cam.x = sim.camp.x; cam.y = sim.camp.y + 48; clampCamera(cam);
  renderTop(sim, { speed, bot: !!bot, villageOpen });
  toggleCity(true);
  $('#toast').replaceChildren(); // 换代消息已进编年，不在手机上盖住新开的城务面板
  clearTimeout(bannerTimer);
  $('#eraBanner').hidden = true;
  say('<b>青铜城邦开启</b>：在<b>技艺</b>研究冶铜与文字；在<b>城务（C）</b>看符谱、税粮与守城准备。', 'good');
}
function victoryEra3() {
  const r = sim.era3.result;
  over = true; closePop(); cancelStroke(); clearPending(); toggleCity(false);
  const el = $('#over');
  el.hidden = false; el.className = 'over era3';
  el.innerHTML = `<div class="plate box"><div class="seal-head"><span class="seal-badge">第三代</span><h2>青铜篇 · 钟定诸邦</h2></div>
    <p>诸邦撤军。钟声还在城郭与两村之间回荡，活着的人留下了可以传给后世的书简。</p>
    <div class="grid"><span>城与村</span><span><b>${r.pop}</b> 人，城内 ${r.residents} 人</span>
      <span>经过</span><span>${(r.days / YEAR_DAYS).toFixed(1)} 年</span><span>联盟来伐</span><span>第 ${r.attempts} 轮，守住 ${r.held}/3 波</span>
      <span>文字与邦交</span><span>${r.archive} 门技艺载册 · ${r.trades} 队商旅往返</span><span>大钟</span><span>${r.hz} Hz · ${r.followers} 名信众</span></div>
    <div class="cta-row"><button class="primary" id="goOn3Btn">留在青铜城邦</button><button id="againBtn">再开一张纸</button><button id="sameBtn">同一张纸重来</button></div></div>`;
  $('#goOn3Btn').onclick = () => { over = false; el.hidden = true; };
  $('#againBtn').onclick = () => newGame(Math.floor(Math.random() * 99999) + 1);
  $('#sameBtn').onclick = () => newGame(seed);
}
function gameOver() {
  over = true;
  closePop(); cancelStroke(); clearPending();
  const s = summary(sim);
  $('#over').hidden = false;
  $('#over').innerHTML = `<div class="plate box"><h2>部落没了</h2><p>第 ${seed} 号纸，撑了 ${s.day} 天（${(s.day / YEAR_DAYS).toFixed(1)} 年）。死因：${Object.entries(s.causes).map(([k, n]) => `${k} ${n}`).join('、')}。</p><p class="small muted">冬天最难：鲜肉三天就坏，入冬浆果全落、鹿跑远。晾肉架、秋天围猎、窝棚和火塘，是过冬的本钱。</p><div class="row"><button class="primary" id="againBtn">再开一张纸</button><button id="sameBtn">同一张纸重来</button></div></div>`;
  $('#againBtn').onclick = () => newGame(Math.floor(Math.random() * 99999) + 1);
  $('#sameBtn').onclick = () => newGame(seed);
}

// ---------------- 画 ----------------
let paperCache = null, paperKey = '';
function draw(now) {
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  cam.vw = w; cam.vh = h;
  const st = Math.round($('.hud-top').getBoundingClientRect().bottom + 6);
  if (st !== skyTop) { skyTop = st; document.body.style.setProperty('--below-sky', `${skyTop + SKY_H + 8}px`); }
  const key = `${canvas.width}x${canvas.height}`;
  if (paperKey !== key) {
    paperKey = key;
    paperCache = document.createElement('canvas');
    paperCache.width = canvas.width; paperCache.height = canvas.height;
    const pc = paperCache.getContext('2d');
    pc.scale(canvas.width / w, canvas.height / h);
    paper(pc, w, h, 5);
    clampCamera(cam);
  }
  ctx.drawImage(paperCache, 0, 0, w, h);
  const closedInk = inkG.tick(now);
  if (closedInk) handleInk(closedInk);
  const closedRed = redG.tick(now);
  if (closedRed) handleRedSymbol(closedRed);

  const world = () => { ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y); };
  const ui = { labels: [], t: now, selected };
  world();
  drawWorld(ctx, sim, cam, ui);
  drawEffects(ctx, fx, now);
  ctx.restore();
  drawFog(ctx, sim, cam, paperCache, w, h, dpr);
  drawNight(ctx, sim, cam, w, h, dpr);
  drawWeather(ctx, sim, w, h, now);
  // 正在写的、刚写过的：盖在白纸和夜色上面
  world();
  for (const st of stamps) {
    const age = now - st.t0, a = st.life > 1e8 ? 0.9 : Math.max(0, 1 - age / st.life);
    for (const x of st.strokes) (st.pencil ? pencilStroke(ctx, x, { width: 2 / cam.z }) : inkStroke(ctx, x, { width: 4 / cam.z, color: st.color, alpha: a }));
  }
  for (let i = stamps.length - 1; i >= 0; i--) if (stamps[i].life < 1e8 && now - stamps[i].t0 > stamps[i].life) stamps.splice(i, 1);
  if (inkG.group) for (const x of inkG.group.strokes) inkStroke(ctx, x, { width: 4 / cam.z });
  if (redG.group) for (const x of redG.group.strokes) inkStroke(ctx, x, { width: 3.4 / cam.z, color: COLORS.red });
  if (redCur) inkStroke(ctx, redCur, { width: 3.4 / cam.z, color: COLORS.red });
  if (pencilCur) pencilStroke(ctx, pencilCur, { width: 2 / cam.z });
  if (placing && !placing.line && hover) {
    const ok = known(sim, hover.x, hover.y);
    for (const s of sheetToMap(placing.id, placing.strokes, hover.x, hover.y)) pencilStroke(ctx, s, { width: 1.6 / cam.z, color: ok ? COLORS.blue : COLORS.red, alpha: 0.75 });
  }
  if (aim && hover) polyline(ctx, [{ x: hover.x - 20, y: hover.y }, { x: hover.x + 20, y: hover.y }], { width: 2 / cam.z, color: COLORS.red }), polyline(ctx, [{ x: hover.x, y: hover.y - 20 }, { x: hover.x, y: hover.y + 20 }], { width: 2 / cam.z, color: COLORS.red });
  ctx.restore();
  drawSky(ctx, sim, w, skyTop, SKY_H, now);
  drawLabels(ctx, cam, ui.labels);
  // 符圈、虚影：按屏幕像素画
  const scr = rg => { const s = toScreen(cam, { x: rg.cx, y: rg.cy }); return { cx: s.x, cy: s.y, r: rg.r * cam.z }; };
  inkG.pad = 26 / cam.z; inkG.minRadius = 42 / cam.z; inkG.tapLen = 7 / cam.z; inkG.hoverMin = 3 / cam.z;
  redG.pad = 18 / cam.z; redG.minRadius = 30 / cam.z; redG.tapLen = 7 / cam.z; redG.hoverMin = 3 / cam.z;
  if (inkG.group) {
    const rg = inkG.ring(), t = targetFor({ x: rg.cx, y: rg.cy });
    ring(ctx, scr(rg), { progress: inkG.progress(now), label: t.ctx ? `${t.name || CTX_NAME[t.ctx]}：${verbsText(t.ctx)}` : t.why, color: t.ctx ? COLORS.ink : COLORS.red });
  }
  if (redG.group && !redG.drawing) ring(ctx, scr(redG.ring()), { progress: redG.progress(now), color: COLORS.red, label: '✕ 禁 · ○ 护' });
  if (ghost) {
    const age = now - ghost.t0, g = toScreen(cam, ghost);
    if (age > 1500) ghost = null;
    else ghostText(ctx, ghost.text, g.x, g.y, { size: 32, alpha: 0.5 * (1 - age / 1500) + 0.08, color: ghost.color });
  }
}

// ---------------- 起 ----------------
const urlParams = new URLSearchParams(location.search);
function setupPreviewMode() {
  const mode = urlParams.get('era') === '3' ? 'era3' : urlParams.get('era') === '2' ? 'era2' : urlParams.get('won') === '1' ? 'won' : null;
  if (!mode) return;
  const V = sim.map.valley;
  reveal(sim, V.x, V.y, K.era.valleyR + 180);
  sim.camp.x = V.x; sim.camp.y = V.y;
  for (const p of sim.alive) { p.x = V.x + (p.n % 5) * 8 - 16; p.y = V.y + 18; }
  const f0 = sim.fires[0];
  if (f0) { f0.x = V.x; f0.y = V.y; f0.lit = true; f0.fuel = 120; }
  addFood(sim, 'dried', 180);
  sim.stock.wood += 90; sim.stock.stone += 90; sim.stock.grass += 50;
  greatFlood(sim);
  sim.flood = null;
  if (!sim.era.done) {
    sim.era.done = true;
    sim.era.doneAt = sim.t;
    sim.era.result = { ok: true, early: true, days: sim.day, years: 5, pop: sim.alive.length, startPop: sim.alive.length, lost: 0, births: 0, deaths: 0, techs: 12, painted: 4, altar: 3, merged: false, geniuses: 1, ink: 80 };
  }
  recalcLocalBonuses(sim);
  sim.assignBeds();
  eraShown = true;
  if (mode === 'won') {
    victory();
  } else {
    startEra2();
    for (const id of ['plow', 'pottery', 'sow', 'irrigate', 'granary', 'husbandry', 'timberhouse', 'bridge']) {
      if (sim.alive[0]) learn(sim, sim.alive[0], id);
    }
    const c = sim.camp;
    let field = null;
    for (let r = 115; r <= 240 && !field; r += 25) {
      for (let k = 0; k < 16 && !field; k++) {
        const a = k / 16 * Math.PI * 2, cx = c.x + Math.cos(a) * r, cy = c.y + Math.sin(a) * r, hw = 48;
        const pts = [{ x: cx - hw, y: cy - hw }, { x: cx + hw, y: cy - hw }, { x: cx + hw, y: cy + hw }, { x: cx - hw, y: cy + hw }, { x: cx - hw, y: cy - hw }];
        if (validateFieldPoly(sim, pts).ok) { const res = planField(sim, pts); if (res.ok) field = res.field; }
      }
    }
    if (field) {
      field.state = 'growing'; field.clearDone = field.clearWork; field.sowDone = field.sowWork; field.growth = 0.72;
      const sp = sim.map.springs?.[0];
      if (sp) {
        reveal(sim, sp.x, sp.y, 140);
        reveal(sim, (sp.x + field.cx) / 2, (sp.y + field.cy) / 2, 160);
        const cr = digCanal(sim, [{ x: sp.x, y: sp.y }, { x: field.cx, y: field.cy }]);
        if (cr.ok) { for (const sg of cr.canal.segs) { sg.built = true; sg.work = sg.need; } updateCanalNetwork(sim); }
      }
    }
    refreshKnown(sim);
    if (mode === 'era3') {
      sim.era2.done = true; sim.era2.result = { ok: true }; sim.era2.canal.stage = 3; era2Shown = true;
      addFood(sim, 'grain', 60);
      for (const id of ['smelt', 'script', 'alloy', 'bronzeWalls', 'wheel']) learn(sim, sim.alive[0], id);
      startEra3();
    }
  }
  cam.x = sim.camp.x; cam.y = sim.camp.y + 30;
  clampCamera(cam);
  renderTop(sim, { speed, bot: !!bot, villageOpen });
}
newGame(Number(urlParams.get('seed')) || Math.floor(Math.random() * 99999) + 1);
setupPreviewMode();
setPen('look');
requestAnimationFrame(t => { lastT = t; frame(t); });
loadRecognizer().then(r => {
  rec = r.rec;
  document.documentElement.dataset.ready = '1';
}).catch(err => say(`模型载入失败：${err.message}。请用 node serve.mjs 打开。`, 'warn'));
// 调试、截图、自动验证用
window.__game = {
  get sim() { return sim; }, cam, get rec() { return rec; }, get bot() { return bot; },
  setSpeed, toggleBot, newGame, select, setPen,
  handleInk: strokes => handleInk({ strokes, t0: NOW() }),
  openBlueprint, get placing() { return placing; }, placePoint: (x, y) => placing && placePoint({ x, y }),
  toggleTech, get techOpen() { return techOpen; }, toggleVillage, get villageOpen() { return villageOpen; },
  handlePencil: pts => handlePencil(pts), get over() { return over; },
  enterEra2: startEra2, get canEnterEra2() { return canEnterEra2(sim); },
  planField: pts => planField(sim, pts), digCanal: (pts, o) => digCanal(sim, pts, o),
  enterEra3: startEra3, get canEnterEra3() { return canEnterEra3(sim); },
  toggleCity, get eraNum() { return eraNum(sim); },
};
