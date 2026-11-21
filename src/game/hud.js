// 顶栏（时代朱印、日子、天气、速度、墨与家当、琢磨）、编年（日志）、族人小传、技艺面板、村务面板。都是 DOM，按需刷新。
import { dateText, shichen } from '../sim/calendar.js';
import { foodTotal, localBuildings } from '../sim/util.js';
import { K, TECHS, TECH_IDS, ERA1_TECH_IDS, ERA2_TECH_IDS, ERA3_TECH_IDS, GENIUS, YEAR_DAYS, eraNum } from '../sim/config.js';
import { techState, etaDays, knowerCount, titleOf, researchScore, workOf, ROLE_NAME, ROLE_ERA1, activeTechIds } from '../sim/tech.js';
import { fieldStateText } from '../sim/farming.js';
import { CANAL_STAGE_NAMES, CANAL_NEEDS, grandCanalLock, villageMood, canEnterEra2, isDiversionReady } from '../sim/era2.js';
import { canEnterEra3, cityPopulation } from '../sim/era3.js';
import { jobName } from './render.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avg = (sim, k) => (sim.alive.length ? sim.alive.reduce((s, p) => s + p[k], 0) / sim.alive.length : 0);
const WEATHER = { clear: '晴', rain: '雨', snow: '雪' };

const SVG_ICO = {
  ink: '<svg class="s-ico" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3c3 4.5 6 7.5 6 11a6 6 0 1 1-12 0c0-3.5 3-6.5 6-11Z"/></svg>',
  pop: '<svg class="s-ico" aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="7" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14.5c2.5.4 4.5 2.2 4.5 5.5"/></svg>',
  food: '<svg class="s-ico" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v18M8 7c2 1 3.5 2.5 4 4M16 7c-2 1-3.5 2.5-4 4M7.5 12.5c2.2 1 3.8 2.5 4.5 4M16.5 12.5c-2.2 1-3.8 2.5-4.5 4"/></svg>',
  wood: '<svg class="s-ico" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 17h14M6 13h12M7 9h10"/><circle cx="18" cy="13" r="1.5"/></svg>',
  pot: '<svg class="s-ico" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5h8l-1 3c2 1.8 3 4.2 3 6.8A5.5 5.5 0 0 1 12.5 20h-1A5.5 5.5 0 0 1 6 14.8c0-2.6 1-5 3-6.8L8 5Z"/></svg>',
};

let topKey = '';
export function renderTop(sim, st = {}) {
  const era2 = !!sim.era2?.active;
  const era3 = !!sim.era3?.active, level = eraNum(sim);
  const P = sim.plan, w = sim.weather;
  const weather = `${WEATHER[w.kind] || '晴'}${w.drought ? ' · 旱' : ''}${sim.era2?.waterlog ? ' · 涝' : ''}`;
  const food = foodTotal(sim), days = P.daily ? food / P.daily : 0;
  const grain = Math.round(sim.stock.food.filter(b => b.kind === 'grain').reduce((s, b) => s + b.n, 0));
  const html = `<span class="date"><b>${dateText(sim.t)}</b> ${shichen(sim.t)}</span><span>${weather} ${Math.round(sim.now.temp)}°</span>`;
  const stats = `<span class="stat-item" title="墨：写号令要墨；族人越爱戴、越敬畏，墨回得越快">${SVG_ICO.ink}墨 <b>${Math.floor(sim.ink)}</b>/${sim.inkMax}<span class="inkbar"><i style="width:${Math.min(100, sim.ink / Math.max(1, sim.inkMax) * 100)}%"></i></span></span>` +
    `<span class="stat-item" title="族人${era2 ? `（${sim.households?.length || 0} 户）` : ''}">${SVG_ICO.pop}人 <b>${sim.alive.length}</b>${era2 ? `<small>${sim.households?.length || 0}户</small>` : ''}</span>` +
    `<span class="stat-item ${days < 1.5 ? 'bad' : ''}" title="吃的：够吃几天">${SVG_ICO.food}食 <b>${Math.round(food)}</b><small>${days.toFixed(1)} 天</small></span>` +
    (era2 ? `<span class="stat-item" title="谷物库存（粮仓与陶罐能延保鲜）">谷 <b>${grain}</b></span><span class="stat-item" title="陶罐：防鼠保鲜谷物与干肉">${SVG_ICO.pot}陶 <b>${sim.stock.pottery || 0}</b></span>` : '') +
    (era3 ? `<span class="stat-item" title="城内和附属村的人口">辖境 <b>${cityPopulation(sim)}</b></span><span class="stat-item">青铜 <b>${sim.stock.bronze}</b></span>` : '') +
    `<span class="stat-item">${SVG_ICO.wood}木 <b>${Math.floor(sim.stock.wood)}</b></span><span>石 <b>${Math.floor(sim.stock.stone)}</b></span><span>草 <b>${Math.floor(sim.stock.grass)}</b></span><span>皮 <b>${Math.floor(sim.stock.hide)}</b></span>` +
    `<span title="爱戴：神做的好事；敬畏：神发的威">爱戴 <b>${Math.round(avg(sim, 'love') * 100)}</b> 敬畏 <b>${Math.round(avg(sim, 'fear') * 100)}</b></span>` +
    studyChip(sim);
  const canE2 = canEnterEra2(sim);
  const canE3 = canEnterEra3(sim);
  const key = html + stats + st.speed + st.bot + st.villageOpen + level + canE2 + canE3;
  if (key === topKey) return;
  topKey = key;

  document.body.dataset.era = level;
  const seal = $('#eraSeal');
  if (seal) { seal.textContent = era3 ? '城邦 · 青铜' : era2 ? '农耕 · 陶' : '部落'; seal.title = era3 ? '第三代：青铜时代（城邦）' : era2 ? '第二代：农耕时代（彩陶）' : '第一代：部落时代（石器）'; }
  const pds = $('#pencilDs'), bds = $('#bpDs');
  if (pds) pds.innerHTML = era2 ? '探路 · 划田 · 挖渠 <kbd>1</kbd>' : '探路 · 修路 <kbd>1</kbd>';
  if (bds) bds.innerHTML = era3 ? '城墙 · 市集 · 大钟 <kbd>4</kbd>' : era2 ? '粮仓 · 陶窑 · 木构 · 桥 <kbd>4</kbd>' : '火塘 · 窝棚 · 祭坛 <kbd>4</kbd>';

  $('#clock').innerHTML = html;
  $('#stats').innerHTML = stats;
  for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', Number(b.dataset.speed) === st.speed);
  $('#botBtn').classList.toggle('on', !!st.bot);
  $('#botBtn').textContent = st.bot ? '托管中' : '托管';
  $('#botBtn').title = st.bot ? '机器人在替你当神；点一下收回' : '让机器人替你当神：它写的符照样过识别器';
  const vb = $('#villageBtn');
  if (vb) vb.classList.toggle('on', !!st.villageOpen);
  const e2b = $('#era2Btn');
  if (e2b) e2b.hidden = !canE2;
  $('#cityBtn').hidden = !era3;
  $('#era3Btn').hidden = !canE3;
}

// 顶栏上的「琢磨」：点开技艺面板
function studyChip(sim) {
  const R = sim.research, by = R.id && sim.idx[R.by];
  const ids = activeTechIds(sim);
  if (R.id) return `<span class="chip" data-open="tech" title="在琢磨的手艺（点开技艺面板，T）">琢磨 <b>${TECHS[R.id].name}</b> <small>· ${by ? `${esc(by.name)} · 约 ${etaDays(sim, R.id, by)} 天${sim.buffs.inspire > sim.t ? ' · 神光' : ''}` : '没人能做'}</small></span>`;
  const idle = ids.some(id => techState(sim, id) === 'open');
  return `<span class="chip ${idle ? 'bad' : ''}" data-open="tech" title="技艺面板（T）">琢磨 <b>${idle ? '没定' : '—'}</b> <small>· 会 ${ids.filter(id => techState(sim, id) === 'known').length}/${ids.length} 门</small></span>`;
}

// ---------------- 编年 ----------------
const BIG = new Set(['birth', 'death', 'build', 'danger', 'season', 'god']);
let filter = 'big';
const FILTERS = { all: () => true, big: e => BIG.has(e.kind), god: e => e.kind === 'god' };
function li(e) {
  const el = document.createElement('li');
  el.className = e.kind;
  el.innerHTML = `<span class="when">${esc(shortTime(e.t))}</span>${esc(e.text)}`;
  if (e.who) { el.dataset.who = e.who; el.classList.add('who'); }
  return el;
}
const shortTime = t => { const d = Math.floor(t / 1440); return `${Math.floor(d / 28) + 1}年${'春夏秋冬'[Math.floor((d % 28) / 7)]}${(d % 7) + 1}日`; };
export function pushLog(e) {
  if (!FILTERS[filter](e)) return;
  const ol = $('#log');
  ol.prepend(li(e));
  while (ol.children.length > 120) ol.lastChild.remove();
}
export function renderLog(sim) {
  const ol = $('#log');
  ol.innerHTML = '';
  for (const e of sim.log.filter(FILTERS[filter]).slice(-120)) ol.prepend(li(e));
  for (const b of document.querySelectorAll('[data-filter]')) b.classList.toggle('on', b.dataset.filter === filter);
}
export function setFilter(sim, f) { filter = f; renderLog(sim); }

// ---------------- 族人小传 ----------------
const bar = (k, v, bad = false, title = '') => `<span title="${title}">${k}</span><div class="meter ${bad ? 'bad' : ''}"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></div>`;
const SK = { gather: '采集', chop: '砍柴', quarry: '采石', hunt: '打猎', fish: '叉鱼', build: '盖房', fire: '看火' };
let whoKey = '';
export function renderWho(sim, id) {
  const el = $('#who');
  const p = id && sim.idx[id];
  if (!p) { el.hidden = true; whoKey = ''; return; }
  el.hidden = false;
  const name = q => (q ? `<a data-sel="${q.id}">${esc(q.name)}${q.alive ? '' : '（故）'}</a>` : '');
  const partner = p.partner && sim.idx[p.partner], parents = p.parents.map(i => sim.idx[i]).filter(Boolean), kids = (p.kids || []).map(i => sim.idx[i]).filter(Boolean);
  const bed = p.bed && sim.idx[p.bed];
  const R = sim.research, studying = p.alive && R.id && R.by === p.id;
  const status = !p.alive ? `${p.cause ? `${p.cause}` : ''}，已故` : [p.lost ? `走失了 ${((sim.t - p.lost.since) / 1440).toFixed(1)} 天` : jobName(p), studying && p.job?.kind !== 'study' ? `管着琢磨「${TECHS[R.id].name}」` : '', p.asleep ? '睡着' : '', p.sick > 0 ? '病着' : '', p.pregnant ? '有孕' : '', p.order ? '奉命' : ''].filter(Boolean).join(' · ');
  const titles = [...titleOf(sim, p), p.from ? `从${p.from}过来的` : '', sim.era2?.active && p.houseName ? p.houseName : ''].filter(Boolean);
  const ks = Object.keys(p.knows || {}).filter(id => TECHS[id]);
  const clothTxt = p.clothes >= 2 ? '穿着厚皮衣' : p.clothes === 1 ? '穿着衣裳' : '没穿衣裳';
  const bedTxt = bed ? `住${bed.name || '窝棚'}` : '睡露天';
  const html = `<div class="row"><b class="nm">${esc(p.name)}</b><span class="muted">${p.sex === 'm' ? '男' : '女'} · ${Math.floor(p.age)} 岁 · ${esc(p.temper)}</span><button id="whoClose" class="x" aria-label="关上">×</button></div>
    ${titles.length ? `<div class="small title">${titles.map(esc).join(' · ')}</div>` : ''}
    <div class="small">${esc(status)}</div>
    ${p.alive ? `<div class="statbar">${bar('饿', p.hunger, p.hunger > 0.8)}<span>${Math.round(p.hunger * 100)}</span>${bar('渴', p.thirst, p.thirst > 0.8)}<span>${Math.round(p.thirst * 100)}</span>${bar('累', p.fatigue, p.fatigue > 0.85)}<span>${Math.round(p.fatigue * 100)}</span>${bar('冷', p.cold, p.cold > 0.6)}<span>${Math.round(p.felt)}°</span>${bar('康', p.health, p.health < 0.4)}<span>${Math.round(p.health * 100)}</span>${bar('心', p.morale, p.morale < 0.35)}<span>${Math.round(p.morale * 100)}</span>${bar('爱', p.love, false, '爱戴神')}<span>${Math.round(p.love * 100)}</span>${bar('畏', p.fear, false, '敬畏神')}<span>${Math.round(p.fear * 100)}</span></div>` : ''}
    <div class="small muted">本事：${Object.entries(p.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${SK[k]} ${Math.round(v * 100)}`).join('，')}</div>
    <div class="small">${partner ? `伴：${name(partner)}　` : ''}${parents.length ? `爹娘：${parents.map(name).join('、')}　` : ''}${kids.length ? `孩子：${kids.map(name).join('、')}` : ''}</div>
    <div class="small">会：${ks.length ? ks.map(id => TECHS[id].name).join('、') : '<span class="muted">还没学会什么手艺</span>'}</div>
    <div class="small muted">${clothTxt} · ${bedTxt}</div>`;
  if (html === whoKey) return;
  whoKey = html;
  el.innerHTML = html;
}

// ---------------- 技艺面板 ----------------
const bestFor = (sim, id) => { let b = null, bs = -1; for (const p of sim.alive) { const s = researchScore(sim, p, id); if (s > bs) { bs = s; b = p; } } return b; };
let techKey = '', techHold = false, techEraTab = 2, lastTechEra = 1;
export function renderTech(sim, open) {
  const el = $('#tech');
  if (!open) { el.hidden = true; techKey = ''; return; }
  el.hidden = false;
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('pointerdown', () => { techHold = true; });
    el.addEventListener('click', e => {
      const tb = e.target.closest('[data-t-era]');
      if (tb) { techEraTab = Number(tb.dataset.tEra); techKey = ''; renderTech(sim, true); }
    });
    addEventListener('pointerup', () => { techHold = false; });
    addEventListener('pointercancel', () => { techHold = false; });
  }
  if (techHold) return;
  const era2 = !!sim.era2?.active;
  const level = eraNum(sim);
  if (lastTechEra !== level) { lastTechEra = level; techEraTab = level; }
  const tab = era2 ? techEraTab : 1;
  const listIds = tab === 3 ? ERA3_TECH_IDS : tab === 2 ? ERA2_TECH_IDS : ERA1_TECH_IDS;
  const allActive = activeTechIds(sim);

  const R = sim.research, by = R.id && sim.idx[R.by], nm = id => TECHS[id].name;
  const link = q => `<a data-sel="${q.id}">${esc(q.name)}</a>`;
  const ids = st => listIds.filter(id => techState(sim, id) === st);
  const known = ids('known'), opens = ids('open'), locked = ids('locked');
  let cur;
  if (R.id) {
    const pct = Math.min(100, Math.floor((R.progress[R.id] || 0) / workOf(sim, R.id) * 20) * 5), lit = sim.buffs.inspire > sim.t;
    cur = `<div>正在琢磨 <b>「${nm(R.id)}」</b>${R.auto ? '<span class="muted small">（你没定，族人自己挑的）</span>' : ''}</div>
      <div class="statbar"><span>进度</span><div class="meter"><i style="width:${pct}%"></i></div><span>${pct}%</span></div>
      <div class="small">${by ? `${link(by)}在琢磨${by.genius === TECHS[R.id].domain && (by.geniusShown ?? true) ? '（正是这一行的天才）' : ''}，约 ${etaDays(sim, R.id, by)} 天` : '眼下没人能琢磨'}</div>
      <div class="small ${lit ? 'good' : 'muted'}">${lit ? `神光照着：琢磨快八成（还剩 ${Math.ceil((sim.buffs.inspire - sim.t) / 60)} 个钟头）` : `墨笔在${by ? esc(by.name) : '琢磨的人'}身上写「光」：一天之内琢磨快八成`}</div>
      <div class="row"><button data-research="">不琢磨了</button></div>`;
  } else cur = `<div>没定研究。${opens.length ? `挑一门点「琢磨」；${Math.max(1, K.tech.autoPickDays - R.idle)} 天里不定，族人会自己挑最省事的。` : '本页眼下没有能琢磨的。'}</div>`;
  const row = (id, note, btn = '') => `<li><div class="row"><b>${nm(id)}</b><span class="cat">${TECHS[id].cat}</span>${btn}</div><div class="small muted">${TECHS[id].what}${note ? `<br>${note}` : ''}</div></li>`;
  const openHtml = opens.map(id => {
    const p = bestFor(sim, id), lost = sim.lostTech[id] != null;
    const note = `${p ? `${esc(p.name)}去琢磨约 ${etaDays(sim, id, p)} 天` : '没人能做'}${lost ? (sim.murals[id] != null ? ' · 失传了，石壁上有，傍晚火边也能照着学回来' : ' · 失传过，再琢磨只要一半工夫') : ''}`;
    return row(id, note, R.id === id ? '<span class="on">在琢磨</span>' : `<button data-research="${id}">琢磨</button>`);
  }).join('');
  const knownHtml = known.map(id => row(id, `${knowerCount(sim, id)} 人会${sim.era3?.archive?.[id] != null ? ' · 已载书简' : sim.murals[id] != null ? ' · 画在石壁上了' : ''}`)).join('');
  const lockedHtml = locked.map(id => row(id, `要先会${TECHS[id].pre.filter(q => techState(sim, q) !== 'known').map(q => `「${nm(q)}」`).join('、')}${sim.lostTech[id] != null ? ' · 失传了' : ''}`)).join('');
  const roleKeys = level === 3 ? Object.keys(ROLE_NAME) : era2 ? Object.keys(ROLE_NAME).filter(k => !['smith', 'scribe', 'general'].includes(k)) : ROLE_ERA1;
  const roles = roleKeys.map(k => { const q = sim.idx[sim.roles[k]]; return `${ROLE_NAME[k]} ${q && q.alive ? link(q) : '<span class="muted">没有</span>'}`; }).join(' · ');
  const gs = sim.alive.filter(q => q.genius && (q.geniusShown ?? true));
  const tabsHtml = era2 ? `<div class="ptabs">${level === 3 ? `<button data-t-era="3" class="${tab === 3 ? 'on' : ''}">第三代 · 青铜</button>` : ''}<button data-t-era="2" class="${tab === 2 ? 'on' : ''}">第二代 · 农耕</button><button data-t-era="1" class="${tab === 1 ? 'on' : ''}">第一代 · 部落</button></div>` : '';
  const totalKnown = allActive.filter(id => techState(sim, id) === 'known').length;
  const html = `<div class="row"><b class="nm">技艺</b><span class="muted small">会 ${totalKnown}/${allActive.length} 门 · 壁画 ${Object.keys(sim.murals).length} 幅</span><button class="x" data-close="tech" aria-label="关上">×</button></div>
    ${tabsHtml}
    <div class="cur">${cur}</div>
    ${opens.length ? `<h4>能琢磨</h4><ul>${openHtml}</ul>` : ''}
    ${known.length ? `<h4>会了</h4><ul>${knownHtml}</ul>` : ''}
    ${locked.length ? `<h4>还琢磨不了</h4><ul>${lockedHtml}</ul>` : ''}
    <h4>名分</h4><div class="small">${roles}</div>
    <h4>天才</h4><div class="small">${gs.length ? gs.map(q => `${link(q)}（${GENIUS[q.genius]}）`).join('、') : '<span class="muted">还没看出来</span>'}</div>
    <p class="small muted">手艺长在人身上：傍晚在火边一个教一个${era2 ? '（同户传得更快）' : ''}；会的人都死了就失传，画上石壁的还能照着学回来。</p>`;
  if (html === techKey) return;
  techKey = html;
  el.innerHTML = html;
}

// ---------------- 村务面板（第二代：农田、大渠、户籍、邻村） ----------------
let vilKey = '', vilHold = false, vilTab = 'farm';
export function renderVillage(sim, open) {
  const el = $('#village');
  if (!open) { el.hidden = true; vilKey = ''; return; }
  el.hidden = false;
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('pointerdown', () => { vilHold = true; });
    el.addEventListener('click', e => {
      const tb = e.target.closest('[data-v-tab]');
      if (tb) { vilTab = tb.dataset.vTab; vilKey = ''; renderVillage(sim, true); }
    });
    addEventListener('pointerup', () => { vilHold = false; });
    addEventListener('pointercancel', () => { vilHold = false; });
  }
  if (vilHold) return;

  const E2 = sim.era2;
  if (!E2?.active) {
    const html = `<div class="row"><b class="nm">村务</b><span class="muted small">第二代启用</span><button class="x" data-close="village" aria-label="关上">×</button></div>
      <div class="vcard"><b>尚未迈入农耕时代</b><span class="small muted">先修齐祭坛、渡过大水迁入新河谷。通过第一代考验后即可进入第二代（农耕），开启农田、水渠、大渠分洪、陶窑与户籍治理。</span></div>`;
    if (html !== vilKey) { vilKey = html; el.innerHTML = html; }
    return;
  }

  let body = '';
  if (vilTab === 'farm') {
    const N = E2.canal.nodes, V = sim.map.valley || sim.camp;
    const stageCard = [1, 2, 3].map(st => {
      const done = E2.canal.stage >= st;
      const working = sim.canals.find(c => c.grandStage === st && !c.built);
      const lock = grandCanalLock(sim, st);
      const targetPt = st === 1 ? N?.hub : st === 2 ? V : N?.outfall;
      const badge = done ? '<span class="vbadge ok">已贯通</span>'
        : working ? `<span class="vbadge river">施工 ${working.segs.filter(s => s.built).length}/${working.segs.length}</span>`
        : !lock ? '<span class="vbadge clay">可动工</span>'
        : `<span class="vbadge">${esc(lock)}</span>`;
      const desc = st === 1 ? '铅笔从「① 上游引水口」连到「② 分水枢纽」'
        : st === 2 ? '铅笔从「② 分水枢纽」连到新河谷中心'
        : '铅笔从谷中连到「③ 下游分洪口」';
      return `<div class="vcard ${done ? 'done' : ''}">
        <div class="row"><b>${CANAL_STAGE_NAMES[st]}</b>${badge}${targetPt ? `<button data-pan-x="${Math.round(targetPt.x)}" data-pan-y="${Math.round(targetPt.y)}" style="margin-left:auto;padding:1px 8px;font-size:11px">看位置</button>` : ''}</div>
        <div class="small muted">${desc}（开工 ${K.era2.canalInk[st - 1]} 墨 · 需「${TECHS[CANAL_NEEDS[st]].name}」）</div>
      </div>`;
    }).join('');
    const floodLeft = Math.max(0, Math.ceil((E2.floodAt - sim.t) / 1440));
    const floodNote = E2.done ? '<span class="good">大水分洪考验已通过！</span>'
      : E2.floodActive ? `<span class="vbadge warn">滔天大水中！${isDiversionReady(sim) ? '大渠正在分洪' : '未修分洪尾渠，河堤顶不住！'}</span>`
      : `距上游大水约 <b>${floodLeft}</b> 天（${isDiversionReady(sim) ? '<span class="good">分洪就绪</span>' : '修通三段大渠以备分洪'}）`;

    const fieldsHtml = sim.fields.length
      ? sim.fields.map(f => {
        const cls = f.state === 'ripe' ? 'done' : (f.pest > 0.1 || f.moisture < 0.35 || f.missReason) ? 'warn' : '';
        return `<div class="vcard ${cls}">
          <div class="row"><b>${esc(f.name)}</b><span class="vbadge ${f.irrigated ? 'river' : ''}">${f.irrigated ? '有渠引水' : '靠天降水'}</span>${f.drained ? '<span class="vbadge ok">可排涝</span>' : ''}<button data-pan-x="${Math.round(f.cx)}" data-pan-y="${Math.round(f.cy)}" style="margin-left:auto;padding:1px 8px;font-size:11px">定位</button></div>
          <div class="small">${esc(fieldStateText(sim, f))}</div>
          <div class="small muted">地力 ${Math.round(f.fertility * 100)}% · 墒情 ${Math.round(f.moisture * 100)}% · 已收 ${f.harvests} 季${f.lastYield ? `（上季 ${f.lastYield} 份）` : ''}</div>
        </div>`;
      }).join('')
      : `<div class="vcard"><span class="small muted">还没有农田：拿<b>铅笔</b>（1）在新河谷平地上画一个闭合圈，就能划出田界。</span></div>`;

    const canalsHtml = sim.canals.filter(c => !c.grandStage).map(c => {
      const done = c.segs.filter(s => s.built).length;
      return `<li>${esc(c.name)} · ${done}/${c.segs.length} 段 · ${c.wet ? '<span class="good">已通水</span>' : '待通水'}${c.drains ? ' · 可排涝' : ''}</li>`;
    }).join('');

    body = `<h4>大渠工程（三段）</h4><div class="small">${floodNote}</div>${stageCard}
      <h4>农田（${sim.fields.length} 块）</h4>${fieldsHtml}
      ${canalsHtml ? `<h4>引水渠</h4><ul class="small">${canalsHtml}</ul>` : ''}`;
  } else if (vilTab === 'house') {
    const hs = sim.households || [];
    const link = p => `<a data-sel="${p.id}">${esc(p.name)}</a>`;
    const listHtml = hs.map(h => {
      const mems = h.members.map(id => sim.idx[id]).filter(p => p && p.alive);
      const bed = mems[0]?.bed && sim.idx[mems[0].bed];
      return `<div class="vcard"><div class="row"><b>${esc(h.name)}</b><span class="vbadge">${mems.length} 口</span><span class="small muted" style="margin-left:auto">${bed ? esc(bed.name) : '暂无屋舍'}</span></div>
        <div class="small">${mems.map(link).join('、')}</div></div>`;
    }).join('');
    const granaries = localBuildings(sim, 'granary'), kilns = localBuildings(sim, 'kiln'), pens = localBuildings(sim, 'pen'), bridges = sim.buildings.filter(b => b.type === 'bridge');
    const houses = localBuildings(sim, 'timberhouse').length + localBuildings(sim, 'shack').length;
    body = `<h4>新营地家底</h4>
      <div class="vcard"><div class="small">住屋 <b>${houses}</b> 栋（容纳 ${sim.plan.housing} 人） · 公共粮仓 <b>${granaries.length}</b> 座（护 ${sim.granaryCap || 0} 份谷）</div>
      <div class="small">陶窑 <b>${kilns.length}</b> 座（陶罐 ${sim.stock.pottery || 0} 只） · 畜栏 <b>${pens.length}</b> 座 · 木桥 <b>${bridges.length}</b> 座</div></div>
      <h4>户籍（${hs.length} 户）</h4>${listHtml || '<span class="small muted">尚未编户</span>'}`;
  } else {
    const V = sim.village;
    const vHtml = V ? `<div class="vcard ${V.damming ? 'warn' : ''}">
      <div class="row"><b>${esc(V.name)}</b><span class="vbadge clay">${villageMood(V)}</span><button data-pan-x="${Math.round(V.x)}" data-pan-y="${Math.round(V.y)}" style="margin-left:auto;padding:1px 8px;font-size:11px">看邻村</button></div>
      <div class="small">${V.pop} 口人 · 善制陶 · 已交易 ${V.trades} 回${V.damming ? ' · <b style="color:var(--red)">上游拦水中（写「水」议水或写「剑」破坝）</b>' : ''}</div>
      <div class="small muted">在邻村身上写墨笔：旗=换陶、水=议水、剑=破坝、光=显灵</div>
    </div>` : '<div class="vcard"><span class="small muted">河对岸暂无邻村</span></div>';
    const avgL = Math.round(avg(sim, 'love') * 100), avgF = Math.round(avg(sim, 'fear') * 100);
    body = `<h4>邻村交涉</h4>${vHtml}
      <h4>神格与村规</h4>
      <div class="vcard"><div class="small">爱戴 <b>${avgL}</b>（越高越顺从、少密谋） · 敬畏 <b>${avgF}</b></div>
      <div class="small">信仰回墨 <b>${(sim.devotion * K.ink.perDevotionDay * (sim.inkRegen || 1)).toFixed(1)}</b> / 天 · 墨上限 <b>${sim.inkMax}</b></div>
      <div class="small muted">${sim.roles?.priest && sim.idx[sim.roles.priest]?.alive ? `司祭：${esc(sim.idx[sim.roles.priest].name)}（信仰稳固，回墨 +20%）` : '学会「村规」可推举司祭稳定信仰'}</div></div>`;
  }

  const html = `<div class="row"><b class="nm">村务 · 农耕</b><span class="muted small">第 ${Math.floor((sim.day - E2.startDay) / YEAR_DAYS) + 1} 年</span><button class="x" data-close="village" aria-label="关上">×</button></div>
    <div class="ptabs">
      <button data-v-tab="farm" class="${vilTab === 'farm' ? 'on' : ''}">农田与大渠</button>
      <button data-v-tab="house" class="${vilTab === 'house' ? 'on' : ''}">户与村落</button>
      <button data-v-tab="god" class="${vilTab === 'god' ? 'on' : ''}">邻村与神格</button>
    </div>${body}`;
  if (html === vilKey) return;
  vilKey = html;
  el.innerHTML = html;
}
