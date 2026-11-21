// 三支笔沙盘：一张纸面地图，验证三支笔的输入分流。
//   墨笔：写符 → 符圈 → 按「画在什么上面」缩小候选 → 虚影 → 生效（3 秒内可撤回）/ 请选 / 神意不明 / 这里用不上；收不回来的要确认。
//   铅笔：画路；从营地拉一条长路可以迁徙（要确认）；图纸在「图纸」里画。
//   朱笔：长线是封锁线（虎过不去，顶久了会破）、圈起来是禁区、小 ✕ 禁、小 ○ 护、短刀划破自己的线是启封。
import { contextById, symbolById, classIndex } from '../recog/symbols.js';
import { InkGrouper } from '../recog/group.js';
import { tooSmall } from '../recog/recognizer.js';
import { classifyRedStroke, classifyRedSymbol, endurance } from '../recog/redpen.js';
import { length, crossings, pointInPolygon, bbox, line, arc, poly, curve } from '../recog/geom.js';
import { fitCanvas, paper, inkStroke, pencilStroke, polyline, ring, ghostText, COLORS } from '../ui/ink.js';
import { attachPen } from '../ui/pointer.js';
import { loadRecognizer, savePersonal } from '../ui/store.js';
import { createWorld, drawWorld, drawPeople, targetAt, handDrawn, W, H, SKY, WS } from './world.js';
import { openSheet } from './sheet.js';

const $ = s => document.querySelector(s);
const canvas = $('#map');
let world = createWorld();
const R = { 墨: 30, 上限: 30, 食: 20, 木: 6, 石: 2, 爱戴: 10, 敬畏: 4 };
let pen = 'ink', rec = null, sheetOpen = false;
const view = { s: 1, ox: 0, oy: 0 };
const toWorld = p => ({ x: (p.x - view.ox) / view.s, y: (p.y - view.oy) / view.s });
const toScreen = p => ({ x: p.x * view.s + view.ox, y: p.y * view.s + view.oy });
const inkG = new InkGrouper(), redG = new InkGrouper({ pad: 18, minRadius: 30 });
let pencilCur = null, redCur = null;
const stamps = [];   // 写过的符，慢慢淡去：{ strokes, color, t0, life, label }
const fx = [];       // 画面效果：{ kind, t0, dur, x, y, ... }
let ghost = null;    // 符圈上的虚影：{ text, x, y, t0, color }
const NOW = () => performance.now();
const nameOf = id => symbolById(id)?.name || id;

// ---------------- 参谋日志 ----------------
function log(text, cls = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  const ol = $('#log');
  ol.prepend(li);
  while (ol.children.length > 40) ol.lastChild.remove();
}

function renderStats() {
  $('#stats').innerHTML = `<span>墨 <b>${Math.floor(R.墨)}</b>/${R.上限}<span class="inkbar"><i style="width:${R.墨 / R.上限 * 100}%"></i></span></span>` +
    `<span>食 <b>${R.食}</b></span><span>木 <b>${R.木}</b></span><span>石 <b>${R.石}</b></span><span>爱戴 <b>${R.爱戴}</b></span><span>敬畏 <b>${R.敬畏}</b></span>` +
    `<span class="muted">${{ day: '晴', rain: '雨', night: '夜' }[world.sky]}</span>`;
}

const HINTS = {
  ink: '<b>墨笔</b>：在目标上写符，停笔约 0.45 秒（或点圈外）就认。画在<b>天</b>上只比雨日月火；画在<b>族人</b>身上只比旗光月火剑树；<b>树林</b>：剑树火旗；<b>兽</b>：剑火旗；<b>河</b>：水山剑旗；<b>空地</b>：树旗水山火。',
  pencil: '<b>铅笔</b>：画路。从营地拉一条长路到远处，可以<b>迁徙</b>（收不回来，要确认）。图纸在左下的「图纸」里。',
  red: '<b>朱笔</b>：长线是<b>封锁线</b>（虎过不去，顶久了会破）；首尾相接圈起来是<b>禁区</b>；小小的 ✕ 是<b>禁</b>、○ 是<b>护</b>；一刀划破自己的线是<b>启封</b>。',
};
function setPen(p) {
  pen = p;
  inkG.cancel(); redG.cancel(); pencilCur = redCur = null;
  for (const b of document.querySelectorAll('[data-pen]')) b.classList.toggle('on', b.dataset.pen === p);
  $('#hint').innerHTML = HINTS[p];
}
for (const b of document.querySelectorAll('[data-pen]')) b.onclick = () => setPen(b.dataset.pen);
$('#bpBtn').onclick = () => openBlueprint();

// ---------------- 弹出：请选、确认、撤回 ----------------
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
  const s = toScreen(at), r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, s.x - r.width / 2))}px`;
  el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, s.y + 40 * view.s + 20))}px`;
  pop = { el, kind };
  wire?.(el);
  return pop;
}

// ---------------- 墨笔：写符 ----------------
function ringOf(strokes) {
  const b = bbox(strokes);
  return { cx: b.cx, cy: b.cy, r: Math.max(42, Math.hypot(b.w, b.h) / 2 + 26) };
}

function handleInk(group) {
  if (tooSmall(group.strokes.map(s => s.map(p => toScreen(p))))) return; // 点一下、手抖一下：不认
  if (!rec) { log('参谋：识别模型还在载入，稍等一下', 'warn'); return; }
  const strokes = group.strokes, rg = ringOf(strokes), c = { x: rg.cx, y: rg.cy };
  const target = targetAt(world, c), ctx = contextById(target);
  const res = rec.recognize(strokes, { context: target });
  const stamp = { strokes, color: COLORS.ink, t0: NOW(), life: 2500 };
  stamps.push(stamp);
  const verbOf = id => ctx.verbs[id];
  if (res.decision === 'reject') {
    stamp.color = COLORS.red;
    ghost = { text: '？', x: c.x, y: c.y, t0: NOW(), color: COLORS.red };
    log(`参谋：神意不明（${ctx.name}上只认 ${Object.keys(ctx.verbs).map(nameOf).join('、')}；不扣墨）`, 'warn');
    return;
  }
  if (res.decision === 'elsewhere') {
    stamp.color = COLORS.red;
    ghost = { text: nameOf(res.global), x: c.x, y: c.y, t0: NOW(), color: COLORS.red };
    log(`参谋：认出是「${nameOf(res.global)}」，但${ctx.name}上用不上（不扣墨）`, 'warn');
    return;
  }
  if (res.decision === 'pick') {
    stamp.life = 1e9;
    showPop(c, `<span class="lab">拿不准，是哪个？</span>${res.choices.map(id => `<button data-id="${id}">${nameOf(id)} · ${verbOf(id).verb}</button>`).join('')}<button data-id="">都不是</button>`, 'pick', el => {
      el.querySelectorAll('button').forEach(b => (b.onclick = () => {
        closePop();
        stamp.life = 0;
        if (b.dataset.id) intend(b.dataset.id, target, strokes, c, stamp);
        else log('参谋：那就当没写（不扣墨）');
      }));
    }).stamp = stamp;
    log(`参谋：拿不准——${res.choices.map(nameOf).join(' / ')}？`);
    return;
  }
  intend(res.top, target, strokes, c, stamp);
}

// 认定了：先显虚影；收不回来的要确认；其余 0.5 秒后生效
function intend(id, target, strokes, c, stamp) {
  const v = contextById(target).verbs[id];
  ghost = { text: `${nameOf(id)}·${v.verb}`, x: c.x, y: c.y, t0: NOW(), color: COLORS.ink };
  if (v.confirm) {
    stamp.life = 1e9;
    showPop(c, `<span class="lab">「${v.verb}」收不回来，确定？</span><button class="red" data-ok="1">${v.verb}（${v.ink} 墨）</button><button>算了</button>`, 'confirm', el => {
      el.querySelectorAll('button').forEach(b => (b.onclick = () => {
        closePop();
        stamp.life = 0;
        if (b.dataset.ok) execute(id, target, strokes, c, false);
        else log(`参谋：收回了「${v.verb}」`);
      }));
    }).stamp = stamp;
    return;
  }
  setTimeout(() => execute(id, target, strokes, c, true), 450);
}

function execute(id, target, strokes, c, undoable) {
  const v = contextById(target).verbs[id];
  if (R.墨 < v.ink) { log(`参谋：墨不够（「${v.verb}」要 ${v.ink} 墨）`, 'warn'); return; }
  R.墨 -= v.ink;
  const fn = EFFECTS[`${target}:${id}`];
  const undo = fn ? fn(c) : null;
  if (undo === false) { R.墨 += v.ink; renderStats(); return; } // 没办成（下了禁令、没材料）：墨退回
  rec.addPersonal(id, strokes); // 生效的符记进个人原型：越写越认得你的笔迹（撤回就拿掉）
  savePersonal(rec);
  log(`${nameOf(id)}·${v.verb}（${v.ink} 墨）`, 'good');
  renderStats();
  if (!undoable) return;
  let left = 3;
  const p = showPop(c, `<button data-u="1">撤回 <span>${left}</span></button>`, 'undo', el => {
    el.querySelector('button').onclick = () => {
      closePop();
      R.墨 += v.ink;
      undo?.();
      const i = rec.personal[classIndex(id)].findIndex(it => it.strokes === strokes);
      if (i >= 0) { rec.removePersonal(id, i); savePersonal(rec); }
      log(`撤回了「${v.verb}」，墨退回`);
      renderStats();
    };
  });
  p.timer = setInterval(() => {
    left--;
    if (left <= 0) closePop();
    else p.el.querySelector('span').textContent = left;
  }, 1000);
}

// ---------------- 效果：每个「目标:符」做什么（返回撤回函数） ----------------
function addFx(kind, dur, extra = {}) { const f = { kind, t0: NOW(), dur, ...extra }; fx.push(f); return f; }
function addMark(kind, strokes, extra = {}) { const m = { kind, strokes, ...extra }; world.marks.push(m); return () => { const i = world.marks.indexOf(m); if (i >= 0) world.marks.splice(i, 1); }; }
function bump(k, d) { R[k] += d; return () => { R[k] -= d; }; }
const seq = (...fs) => () => fs.forEach(f => f && f());
function send(n, x, y, task, ms = 6000) {
  const ps = [...world.people].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).slice(0, n);
  ps.forEach((p, i) => { p.tx = x + Math.cos(i * 2.1) * 26; p.ty = y + Math.sin(i * 2.1) * 16; p.task = task; p.until = NOW() + ms; });
  return () => ps.forEach(p => { p.tx = p.hx; p.ty = p.hy; p.task = ''; });
}
function nearestTree(c) {
  let best = null;
  for (const t of world.trees) if (!t.cut && !t.burnt && (!best || Math.hypot(t.x - c.x, t.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y))) best = t;
  return best;
}
const forbidden = target => world.reds.some(r => r.kind === 'x' && r.target === target);
let seed = 100;
const EFFECTS = {
  'sky:yu': () => { const prev = world.sky; world.sky = 'rain'; addFx('rain', 5000); setTimeout(() => world.sky === 'rain' && (world.sky = 'day'), 5000); return seq(() => (world.sky = prev), bump('食', 3), bump('爱戴', 2)); },
  'sky:ri': () => { const prev = world.sky; world.sky = 'day'; addFx('sun', 2600); return seq(() => (world.sky = prev), bump('爱戴', 1)); },
  'sky:yue': () => { const prev = world.sky; world.sky = 'night'; setTimeout(() => world.sky === 'night' && (world.sky = 'day'), 7000); const u = send(8, world.camp.x, world.camp.y + 10, '回营', 7000); return seq(() => (world.sky = prev), u); },
  'sky:huo': c => {
    const b = world.beast, hitBeast = b.alive && Math.hypot(b.x - c.x, b.y - c.y) < 400;
    const at = hitBeast ? { x: b.x, y: b.y } : nearestTree(c) || { x: c.x, y: SKY + 120 };
    addFx('bolt', 900, { x: at.x, y: at.y });
    if (hitBeast) { b.flee = NOW() + 9000; log('雷火劈在虎身边，虎逃进了远山'); }
    else if (at.strokes) { at.burnt = true; log('雷火劈中一棵树，烧焦了'); }
    bump('敬畏', 3);
    return null;
  },
  'folk:qi': c => seq(send(8, c.x, c.y + 20, '集结', 5000)),
  'folk:guang': () => { addFx('light', 3200, { x: world.camp.x, y: world.camp.y }); log('圣光：范围内士气 +20%、劳作 +15%、恐惧 −50%，持续一天'); return bump('爱戴', 3); },
  'folk:yue': () => { world.people.forEach(p => (p.task = '歇息')); setTimeout(() => world.people.forEach(p => p.task === '歇息' && (p.task = '')), 4000); return bump('爱戴', 1); },
  'folk:huo': () => { addFx('flare', 2500, { x: world.camp.x, y: world.camp.y }); return null; },
  'folk:jian': () => { world.people.forEach(p => (p.pose = 1, p.task = '操练')); setTimeout(() => world.people.forEach(p => { p.pose = 0; if (p.task === '操练') p.task = ''; }), 4000); return () => world.people.forEach(p => { p.pose = 0; p.task = ''; }); },
  'folk:shu': () => seq(send(3, 1080, 420, '采集'), bump('食', 2)),
  'wood:jian': c => {
    if (forbidden('wood')) { log('参谋：林子下了禁令（朱笔 ✕），没人敢砍（墨退回）', 'warn'); return false; }
    const t = nearestTree(c);
    if (!t) { log('参谋：林子砍光了（墨退回）', 'warn'); return false; }
    t.cut = true;
    return seq(() => (t.cut = false), send(2, t.x, t.y + 20, '砍伐'), bump('木', 3));
  },
  'wood:shu': c => seq(send(3, c.x, c.y + 20, '采集'), bump('食', 2)),
  'wood:huo': c => { for (const t of world.trees) if (Math.hypot(t.x - c.x, t.y - c.y) < 130) t.burnt = true; addFx('burn', 2500, { x: c.x, y: c.y }); bump('木', 1); bump('敬畏', 2); log('烧荒：烧出一片空地，灰能肥田'); return null; },
  'wood:qi': c => send(8, c.x, c.y + 40, '集结', 5000),
  'rock:jian': c => seq(send(2, c.x, c.y, '采石'), bump('石', 3)),
  'rock:shan': c => addMark('cairn', handDrawn('shan', seed++, c.x, c.y, 46, 0.3)),
  'rock:qi': c => send(8, c.x, c.y + 40, '集结', 5000),
  'beast:jian': c => {
    if (forbidden('beast')) { log('参谋：你下过禁猎令（朱笔 ✕），墨退回', 'warn'); return false; }
    const b = world.beast, u = send(4, b.x - 30, b.y + 10, '狩猎', 4000);
    const timer = setTimeout(() => { if (b.alive) { b.alive = false; R.食 += 8; log('猎到了虎：食 +8', 'good'); renderStats(); } }, 3200);
    return seq(u, () => clearTimeout(timer));
  },
  'beast:huo': () => { world.beast.flee = NOW() + 9000; addFx('flare', 1500, { x: world.beast.x, y: world.beast.y }); return () => (world.beast.flee = 0); },
  'beast:qi': c => {
    const b = world.beast, u = send(8, b.x, b.y, '围猎', 5000);
    const timer = setTimeout(() => { if (b.alive) { b.alive = false; R.食 += 8; log('围猎得手：食 +8', 'good'); renderStats(); } }, 4200);
    return seq(u, () => clearTimeout(timer));
  },
  'river:shui': c => seq(send(2, c.x + 30, c.y, '取水'), bump('爱戴', 1)),
  'river:shan': c => addMark('levee', [line(c.x - 40, c.y - 30, c.x + 40, c.y + 30, WS), line(c.x - 34, c.y - 36, c.x + 46, c.y + 24, WS)]),
  'river:jian': c => seq(send(2, c.x + 30, c.y, '叉鱼'), bump('食', 2)),
  'river:qi': c => send(8, c.x + 50, c.y, '集结', 5000),
  'land:shu': c => addMark('sapling', handDrawn('shu', seed++, c.x, c.y, 36, 0.3)),
  'land:qi': c => addMark('flag', handDrawn('qi', seed++, c.x, c.y, 50, 0.2)),
  'land:shui': c => addMark('well', [arc(c.x, c.y, 16, 9, 0, Math.PI * 2, 0, WS), arc(c.x, c.y + 8, 16, 9, 0, Math.PI, 0, WS), line(c.x - 16, c.y, c.x - 16, c.y + 8, WS), line(c.x + 16, c.y, c.x + 16, c.y + 8, WS)]),
  'land:shan': c => {
    if (R.石 < 1) { log('参谋：没石头了，先去石堆写「剑」采石（墨退回）', 'warn'); return false; }
    return seq(addMark('cairn', handDrawn('shan', seed++, c.x, c.y, 46, 0.3)), bump('石', -1));
  },
  'land:huo': c => addMark('fire', handDrawn('huo', seed++, c.x, c.y, 34, 0.3), { warm: true }),
};

// ---------------- 朱笔 ----------------
// 朱笔的尺寸按屏幕像素判（小 ✕ 就是手底下小小一个），所以传「1 像素合多少纸面单位」
const pxScale = () => 1 / view.s;

function handleRedStroke(s) {
  // 封锁线和禁区的边，都能一刀划破
  const walls = [
    ...world.lines.map(l => ({ l, list: world.lines, points: l.points })),
    ...world.zones.map(z => ({ l: z, list: world.zones, points: [...z.points, z.points[0]] })),
  ];
  const k = classifyRedStroke(s, walls, pxScale());
  if (k.kind === 'unseal') {
    const w = walls[k.line];
    w.list.splice(w.list.indexOf(w.l), 1);
    log(`启封：划破了${w.list === world.zones ? '禁区' : '一条封锁线'}（当时还能承受 ${Math.round(w.l.hp)}/${w.l.max}）`);
    return true;
  }
  if (k.kind === 'line' || k.kind === 'zone') {
    const cost = Math.max(1, Math.ceil(k.length / 260)) + (k.kind === 'zone' ? 1 : 0);
    if (R.墨 < cost) { log(`参谋：墨不够（这条线要 ${cost} 墨）`, 'warn'); return true; }
    R.墨 -= cost;
    const max = endurance(k.length);
    (k.kind === 'zone' ? world.zones : world.lines).push({ points: s, hp: max, max });
    log(k.kind === 'zone' ? `朱笔圈出禁区（${cost} 墨，承受 ${max}）` : `朱笔画下封锁线（长 ${Math.round(k.length)}，${cost} 墨，承受 ${max}）`);
    renderStats();
    return true;
  }
  return false; // 小红符的一笔：交给分组
}

function handleRedSymbol(group) {
  const strokes = group.strokes, b = bbox(strokes), c = { x: b.cx, y: b.cy };
  const k = classifyRedSymbol(strokes, pxScale());
  const target = targetAt(world, c), tname = contextById(target).name;
  if (k.kind === 'unknown') {
    stamps.push({ strokes, color: COLORS.red, t0: NOW(), life: 1500 });
    log(`参谋：${k.why}`, 'warn');
    return;
  }
  if (R.墨 < 1) { log('参谋：墨不够', 'warn'); return; }
  R.墨 -= 1;
  if (k.kind === 'forbid') {
    world.reds.push({ kind: 'x', x: c.x, y: c.y, target, strokes });
    const what = { wood: '禁伐', beast: '禁猎', folk: '禁足', river: '禁渔', rock: '禁采', sky: '禁祭', land: '禁地' }[target];
    log(`朱笔 ✕：${tname}「${what}」`);
  } else {
    const r = target === 'folk' ? 175 : 80;
    world.reds.push({ kind: 'o', x: target === 'folk' ? world.camp.x : c.x, y: target === 'folk' ? world.camp.y : c.y, r, target, strokes, hp: 60, max: 60 });
    log(target === 'folk' ? '朱笔 ○：守护营地（虎进不了这个圈）' : `朱笔 ○：守护这片${tname}`);
  }
  renderStats();
}

// ---------------- 铅笔 ----------------
function handlePencil(s) {
  const L = length(s);
  if (L < 40) return;
  const a = s[0], z = s[s.length - 1], camp = world.camp;
  if (Math.hypot(a.x - camp.x, a.y - camp.y) < camp.r && Math.hypot(z.x - camp.x, z.y - camp.y) > 320 && z.y > SKY) {
    world.roads.push({ points: s });
    showPop(z, `<span class="lab">沿这条路迁徙？全族搬过去，收不回来</span><button class="red" data-ok="1">迁徙</button><button>只是一条路</button>`, 'confirm', el => {
      el.querySelectorAll('button').forEach(b => (b.onclick = () => {
        closePop();
        if (b.dataset.ok) migrate(s);
        else log(`修了一条路（${Math.round(L)} 步）`);
      }));
    });
    return;
  }
  world.roads.push({ points: s });
  log(`铅笔：修了一条路（${Math.round(L)} 步）`);
}

function migrate(path) {
  if (world.moving) { log('参谋：已经在路上了', 'warn'); return; }
  const z = path[path.length - 1], dx = z.x - world.camp.x, dy = z.y - world.camp.y;
  world.people.forEach((p, i) => { p.path = path.slice(); p.pi = 0; p.delay = i * 250; p.task = '迁徙'; p.hx += dx; p.hy += dy; p.until = 0; });
  world.moving = { dx, dy }; // 头一个人走到，营地（窝棚、营火）才搬过去
  log(`迁徙：全族沿铅笔路走向新营地（${Math.round(length(path))} 步）`, 'good');
}
function moveCamp({ dx, dy }) {
  const mv = s => s.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
  world.camp.x += dx; world.camp.y += dy;
  world.fire = world.fire.map(mv);
  world.shacks = world.shacks.map(sh => sh.map(mv));
  log('新营地扎好了');
}

// ---------------- 图纸 ----------------
function openBlueprint() {
  if (sheetOpen) return;
  sheetOpen = true;
  closePop();
  cancelStroke();
  openSheet($('#sheet'), {
    onClose: () => (sheetOpen = false),
    onBuilt(S) {
      const st = S.stats();
      if (S.bp.id === 'shack') {
        const n = world.shacks.length, x = world.camp.x + (n % 2 ? 1 : -1) * (150 + n * 14), y = world.camp.y + 60 + n * 8;
        const sc = 0.5 / 0.42;
        const strokes = Object.values(S.strokes).flat().map(s => s.map(p => ({ x: x + (p.x - 0.5) * 100 * sc, y: y + (p.y - 0.6) * 100 * sc })));
        world.shacks.push(strokes);
        const need = Number((st.find(x => x.k === '用料')?.v || '').match(/木 (\d+)/)?.[1] || 0);
        if (R.木 < need) log(`参谋：木头不够（图纸要 ${need}，库里 ${R.木}）。样机里先照建，正式版要先砍够`, 'warn');
        R.木 = Math.max(0, R.木 - need);
        log(`照图建成窝棚：${st.map(x => `${x.k}${x.v ? ' ' + x.v : x.x != null ? ' ' + Math.round(x.x * 100) + '%' : ''}`).join('，')}`, 'good');
      } else {
        const strokes = Object.values(S.strokes).flat().map(s => s.map(p => ({ x: 980 + (p.x - 0.5) * 160, y: 900 + (p.y - 0.62) * 160 })));
        addMark('pad', strokes);
        log(`发射台（第八代图纸，这里只试量）：${st.map(x => `${x.k} ${x.v || Math.round(x.x * 100) + '%'}`).join('，')}`, 'good');
      }
      renderStats();
    },
  });
}

// ---------------- 输入 ----------------
function cancelStroke() { inkG.cancel(); redG.cancel(); pencilCur = redCur = null; }
attachPen(canvas, {
  toWorld,
  onDown(p, t) {
    if (pop && pop.kind !== 'undo') closePop();
    if (pen === 'ink') { const closed = inkG.down(p, t); if (closed) handleInk(closed); }
    else if (pen === 'red') { redCur = [{ ...p, t }]; const closed = redG.down(p, t); if (closed) handleRedSymbol(closed); }
    else pencilCur = [{ ...p, t }];
  },
  onMove(p, t) {
    if (pen === 'ink') inkG.move(p, t);
    else if (pen === 'red') { redCur?.push({ ...p, t }); redG.move(p, t); }
    else pencilCur?.push({ ...p, t });
  },
  onUp(p, t) {
    if (pen === 'ink') inkG.up(t);
    else if (pen === 'red' && redCur) {
      const s = redCur;
      redCur = null;
      redG.up(t);
      if (handleRedStroke(s)) { // 线、禁区、启封：不留在红符圈里
        const g = redG.group;
        if (g) { g.strokes.pop(); if (!g.strokes.length) redG.cancel(); }
      }
    } else if (pencilCur) { handlePencil(pencilCur); pencilCur = null; }
  },
  onCancel: cancelStroke,
  onHover(p, t) { if (pen === 'ink') inkG.hover(p, t); else if (pen === 'red') redG.hover(p, t); },
});
addEventListener('keydown', e => {
  if (sheetOpen || e.target.matches('input, select, textarea')) return;
  if (e.key === '1') setPen('pencil');
  else if (e.key === '2') setPen('ink');
  else if (e.key === '3') setPen('red');
  else if (e.key === '4') openBlueprint();
  else if (e.key === 'Escape') { cancelStroke(); closePop(); }
  else if (e.key === 'Enter') { const g = inkG.close(); if (g) handleInk(g); }
});

// ---------------- 模拟：人走路、虎逼近、封锁线承压、墨回复 ----------------
let lastT = NOW(), attackCool = 0, inkAcc = 0;
function blocked(a, b) {
  const seg = [a, b];
  for (const l of world.lines) if (crossings(seg, l.points).length) return l;
  for (const z of world.zones) if (crossings(seg, [...z.points, z.points[0]]).length || pointInPolygon(b, z.points)) return z;
  for (const o of world.reds) if (o.kind === 'o' && Math.hypot(b.x - o.x, b.y - o.y) < o.r && Math.hypot(a.x - o.x, a.y - o.y) >= o.r) return o;
  return null;
}
function step(dt, t) {
  inkAcc += dt;
  if (inkAcc > 2.5) { inkAcc = 0; if (R.墨 < R.上限) { R.墨 = Math.min(R.上限, R.墨 + 1); renderStats(); } }
  for (const p of world.people) {
    if (p.path) {
      if (p.delay > 0) { p.delay -= dt * 1000; continue; }
      const q = p.path[p.pi];
      if (!q) {
        p.path = null; p.task = ''; p.tx = p.hx; p.ty = p.hy;
        if (world.moving) { moveCamp(world.moving); world.moving = null; }
        continue;
      }
      const d = Math.hypot(q.x - p.x, q.y - p.y), v = 110 * dt;
      if (d <= v) { p.x = q.x; p.y = q.y; p.pi++; }
      else { p.x += (q.x - p.x) / d * v; p.y += (q.y - p.y) / d * v; }
      continue;
    }
    if (p.until && t > p.until) { p.until = 0; p.tx = p.hx; p.ty = p.hy; if (p.task !== '歇息') p.task = ''; }
    const d = Math.hypot(p.tx - p.x, p.ty - p.y), v = 80 * dt;
    if (d > 1) { const k = Math.min(1, v / d); p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
  }
  const b = world.beast;
  if (!b.alive) return;
  const camp = world.camp;
  let goal = b.flee && t < b.flee ? { x: 1560, y: 960 } : { x: camp.x + 60, y: camp.y + 40 };
  if (attackCool > 0) { attackCool -= dt; goal = { x: 1440, y: 830 }; }
  const d = Math.hypot(goal.x - b.x, goal.y - b.y);
  b.press = null;
  if (d > 4) {
    const v = (b.flee && t < b.flee ? 60 : 14) * dt;
    const nb = { x: b.x + (goal.x - b.x) / d * v, y: b.y + (goal.y - b.y) / d * v };
    const wall = attackCool > 0 || (b.flee && t < b.flee) ? null : blocked(b, nb);
    if (wall) {
      b.press = wall;
      if (wall.hp != null) {
        wall.hp -= dt * 5;
        if (wall.hp <= 0) {
          for (const L of [world.lines, world.zones, world.reds]) if (L.includes(wall)) L.splice(L.indexOf(wall), 1);
          log(wall.kind === 'o' ? '虎撞破了朱笔护圈' : '虎冲破了封锁线：压力过了临界值', 'warn');
        }
      }
    } else { b.x = nb.x; b.y = nb.y; }
  }
  if (!attackCool && !(b.flee && t < b.flee) && Math.hypot(camp.x - b.x, camp.y - b.y) < 150) {
    R.食 = Math.max(0, R.食 - 3); R.敬畏 = Math.max(0, R.敬畏 - 1);
    log('虎闯进营地，叼走了肉（食 −3）。用朱笔拦住它，或者用墨笔写「剑」「火」「旗」对付它', 'warn');
    attackCool = 18;
    renderStats();
  }
}

// ---------------- 画 ----------------
let paperCache = null, paperKey = '', hudKey = '', hudTop = 0;
function frame() {
  const t = NOW(), dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  if (!sheetOpen) step(dt, t);
  const { ctx, w, h } = fitCanvas(canvas);
  // 地图放在顶栏下面（天是写「雨日月火」的地方，不能被顶栏挡住）
  // 竖屏时地图贴着顶栏放，下面留给参谋和笔（--map-bottom 给样式表用）
  if (hudKey !== `${w}x${h}`) {
    hudKey = `${w}x${h}`;
    hudTop = Math.min(h * 0.4, document.querySelector('.hud-top').getBoundingClientRect().bottom + 4);
    const k = Math.min(w / W, (h - hudTop) / H), spare = h - hudTop - H * k, portrait = spare > 220;
    // 横向有富余时，地图往左让，别压在右上角的参谋框底下（矮横屏上那里正是树林）
    const slack = w - W * k, logW = $('#logbox').offsetWidth + 24;
    view.s = k; view.ox = !portrait && slack >= logW ? (slack - logW) / 2 : slack / 2;
    view.oy = portrait ? hudTop + 6 : hudTop + spare / 2;
    document.body.classList.toggle('portrait', portrait);
    document.documentElement.style.setProperty('--map-bottom', `${Math.round(view.oy + H * k)}px`);
  }
  const s = view.s;
  // 符圈的大小、点按的判定按屏幕像素定，换成纸面单位
  inkG.pad = 26 / s; inkG.minRadius = 42 / s; inkG.tapLen = 7 / s; inkG.hoverMin = 3 / s;
  redG.pad = 18 / s; redG.minRadius = 30 / s; redG.tapLen = 7 / s; redG.hoverMin = 3 / s;
  world.ui = Math.max(1, 0.9 / s); // 纸面上的小字至少约 10 像素
  const key = `${canvas.width}x${canvas.height}`;
  if (paperKey !== key) {
    paperKey = key;
    paperCache = document.createElement('canvas');
    paperCache.width = canvas.width; paperCache.height = canvas.height;
    const pc = paperCache.getContext('2d');
    pc.scale(canvas.width / w, canvas.height / h);
    paper(pc, w, h, 3);
  }
  ctx.drawImage(paperCache, 0, 0, w, h);
  const closedInk = inkG.tick(t);
  if (closedInk) handleInk(closedInk);
  const closedRed = redG.tick(t);
  if (closedRed) handleRedSymbol(closedRed);

  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(s, s);
  drawWorld(ctx, world, t);
  for (const m of world.marks) for (const st of m.strokes) inkStroke(ctx, st, { width: 2.4, color: m.kind === 'fire' ? '#7a2a1c' : COLORS.ink });
  // 朱笔：封锁线、禁区、禁与护
  for (const l of world.lines) polyline(ctx, l.points, { width: 4, color: COLORS.red, alpha: 0.35 + 0.6 * l.hp / l.max });
  for (const z of world.zones) {
    ctx.save();
    ctx.beginPath();
    z.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(179,50,42,0.07)';
    ctx.fill();
    ctx.restore();
    polyline(ctx, z.points, { width: 3, color: COLORS.red, alpha: 0.4 + 0.5 * z.hp / z.max, dash: [10, 6], close: true });
  }
  for (const r of world.reds) {
    for (const st of r.strokes) inkStroke(ctx, st, { width: 3.4, color: COLORS.red, alpha: r.max ? 0.35 + 0.65 * r.hp / r.max : 1 });
    if (r.kind === 'o' && r.target === 'folk') polyline(ctx, arc(r.x, r.y, r.r, r.r * 0.75, 0, Math.PI * 2, 0, WS), { width: 1.5, color: COLORS.red, alpha: 0.35, dash: [4, 6] });
  }
  drawPeople(ctx, world, t);
  drawFx(ctx, t);
  // 正在写的
  for (const st of stamps) {
    const age = t - st.t0, a = st.life > 1e8 ? 0.9 : Math.max(0, 1 - age / st.life);
    for (const x of st.strokes) inkStroke(ctx, x, { width: 4, color: st.color, alpha: a });
  }
  for (let i = stamps.length - 1; i >= 0; i--) if (stamps[i].life < 1e8 && t - stamps[i].t0 > stamps[i].life) stamps.splice(i, 1);
  if (inkG.group) for (const x of inkG.group.strokes) inkStroke(ctx, x, { width: 4 });
  if (redG.group) for (const x of redG.group.strokes) inkStroke(ctx, x, { width: 3.4, color: COLORS.red });
  if (redCur) inkStroke(ctx, redCur, { width: 3.4, color: COLORS.red });
  if (pencilCur) pencilStroke(ctx, pencilCur, { width: 2 });
  ctx.restore();
  if (world.sky === 'night') { ctx.fillStyle = 'rgba(20,24,40,0.32)'; ctx.fillRect(0, 0, w, h); }

  // 符圈、虚影、承受度：按屏幕像素画，地图缩小了也看得清
  const scr = rg => ({ cx: rg.cx * s + view.ox, cy: rg.cy * s + view.oy, r: rg.r * s });
  ctx.save();
  ctx.font = '12px system-ui, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.red;
  for (const l of world.lines) { const m = toScreen(l.points[l.points.length >> 1]); ctx.fillText(`承受 ${Math.ceil(l.hp)}/${l.max}`, m.x, m.y - 10); }
  ctx.restore();
  if (inkG.group) {
    const rg = inkG.ring(), cv = contextById(targetAt(world, { x: rg.cx, y: rg.cy }));
    ring(ctx, scr(rg), { progress: inkG.progress(t), label: `${cv.name}：${Object.entries(cv.verbs).map(([id, v]) => nameOf(id) + v.verb).join(' ')}` });
  }
  if (redG.group && !redG.drawing) ring(ctx, scr(redG.ring()), { progress: redG.progress(t), color: COLORS.red, label: '✕ 禁 · ○ 护' });
  if (ghost) {
    const age = t - ghost.t0, g = toScreen(ghost);
    if (age > 1400) ghost = null;
    else ghostText(ctx, ghost.text, g.x, g.y, { size: 34, alpha: 0.42 * (1 - age / 1400) + 0.08, color: ghost.color });
  }
  requestAnimationFrame(frame);
}

function drawFx(ctx, t) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], k = (t - f.t0) / f.dur;
    if (k >= 1) { fx.splice(i, 1); continue; }
    ctx.save();
    if (f.kind === 'rain') {
      ctx.strokeStyle = 'rgba(60,80,110,0.35)';
      ctx.lineWidth = 1.4;
      for (let j = 0; j < 140; j++) {
        const x = (j * 97 + t * 0.05) % W, y = (j * 211 + t * 0.6) % (H - SKY) + SKY - 40;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 16); ctx.stroke();
      }
    } else if (f.kind === 'sun') {
      const g = ctx.createRadialGradient(800, 40, 0, 800, 40, 260);
      g.addColorStop(0, `rgba(240,190,80,${0.35 * (1 - k)})`); g.addColorStop(1, 'rgba(240,190,80,0)');
      ctx.fillStyle = g; ctx.fillRect(500, 0, 600, 320);
    } else if (f.kind === 'bolt') {
      ctx.strokeStyle = `rgba(250,240,200,${1 - k})`; ctx.lineWidth = 5;
      polyline(ctx, [{ x: f.x + 30, y: 0 }, { x: f.x - 10, y: f.y * 0.4 }, { x: f.x + 20, y: f.y * 0.55 }, { x: f.x, y: f.y }], { width: 4, color: '#c99a2e', alpha: 1 - k });
      ctx.fillStyle = `rgba(255,250,230,${0.25 * (1 - k)})`; ctx.fillRect(0, 0, W, H);
    } else if (f.kind === 'light') {
      for (let j = 0; j < 12; j++) {
        const a = j / 12 * Math.PI * 2 + t / 2000;
        polyline(ctx, [{ x: f.x + Math.cos(a) * 40, y: f.y + Math.sin(a) * 26 }, { x: f.x + Math.cos(a) * 190, y: f.y + Math.sin(a) * 120 }], { width: 3, color: COLORS.gold, alpha: 0.5 * (1 - k) });
      }
    } else if (f.kind === 'flare' || f.kind === 'burn') {
      const r = f.kind === 'burn' ? 160 : 70, g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(200,90,40,${0.45 * (1 - k)})`); g.addColorStop(1, 'rgba(200,90,40,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }
}

// ---------------- 起 ----------------
setPen('ink');
renderStats();
log('参谋：先用墨笔在天上写个「雨」，或者在族人身上写个「旗」。虎在东南，会慢慢逼近营地。');
requestAnimationFrame(frame);
loadRecognizer().then(r => {
  rec = r.rec;
  document.documentElement.dataset.ready = '1';
}).catch(err => log(`模型载入失败：${err.message}。请用 node serve.mjs 打开。`, 'warn'));
// 调试与截图用：直接把一组笔画当成墨笔写在纸面坐标上
window.__danqing = { world, R, view, handleInk: strokes => handleInk({ strokes }), get rec() { return rec; } };
