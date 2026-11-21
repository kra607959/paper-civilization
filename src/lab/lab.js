// 符号实验室：试写、采样、示范三遍、评测、数据。
// 真人样本从这里来：采样 → 导出 JSON → node tools/glyphcheck.mjs --human 文件.json（过关线按真人样本算）。
import { SYMBOLS, CONTEXTS, NEG, canonical, contextById, candidatesOf, symbolById } from '../recog/symbols.js';
import { InkGrouper } from '../recog/group.js';
import { Recognizer, tooSmall } from '../recog/recognizer.js';
import { fitCanvas, paper, inkStroke, ring, ghostText, thumb, COLORS } from '../ui/ink.js';
import { attachPen } from '../ui/pointer.js';
import { loadRecognizer, savePersonal, load, save, packStrokes, unpackStrokes, readStrokes, downloadText } from '../ui/store.js';

const $ = s => document.querySelector(s);
const SAMPLES_KEY = 'danqing.lab.samples.v1';
const PREFS_KEY = 'danqing.lab.prefs.v1';
const nameOf = id => (id === 'neg' ? '乱画' : symbolById(id)?.name || id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1) + '%';
function sampleRow(s) {
  if ((!symbolById(s?.label) && s?.label !== 'neg') || (s.who != null && typeof s.who !== 'string')) return null;
  const strokes = readStrokes(s.strokes);
  return strokes ? { label: s.label, strokes: packStrokes(strokes), who: s.who || '', at: Number.isFinite(s.at) ? s.at : null, ctx: contextById(s.ctx).id, got: typeof s.got === 'string' ? s.got : '' } : null;
}
const sampleKey = s => JSON.stringify([s.label, s.who, s.at, s.strokes]);
const stored = load(SAMPLES_KEY, []);

const state = {
  tab: 'try', ctx: 'all', sel: 'ri',
  last: null,                                   // { strokes, res, img }
  samples: Array.isArray(stored) ? stored.map(sampleRow).filter(Boolean) : [],
  prefs: { who: '', reps: 5, negs: 5, learn: false, ...load(PREFS_KEY, {}) },
  queue: [], qi: 0,
  roundSamples: [],
  demo: 0, pendingDemo: null,
  evalOut: null, evalBusy: false,
  confirmClear: false,
};
let rec, model;
const grouper = new InkGrouper({ pad: 40, minRadius: 70 });
const pad = $('#pad');
let paperCache = null;

// ---------------- 左栏：十个符 ----------------
function renderSymbols() {
  const box = $('#symbols');
  const ctx = contextById(state.ctx);
  const counts = {};
  for (const s of state.samples) counts[s.label] = (counts[s.label] || 0) + 1;
  box.innerHTML = '';
  for (const s of SYMBOLS) {
    const b = document.createElement('button');
    b.className = 'sym' + (state.sel === s.id && (state.tab === 'demo' || state.tab === 'try') ? ' on' : '');
    const verb = ctx.verbs?.[s.id]?.verb;
    const off = ctx.verbs && !verb;
    b.innerHTML = `<canvas width="104" height="104"></canvas><span class="nm">${s.name}<small>${verb ? esc(verb) : off ? '这里用不上' : ''}</small></span>` +
      `<span class="ht">${esc(s.hint)}<br>样本 ${counts[s.id] || 0} · 示范 ${rec ? rec.personalCount(s.id) : 0}</span>`;
    if (off) b.style.opacity = 0.45;
    const cv = b.querySelector('canvas'), c2 = cv.getContext('2d');
    c2.scale(2, 2);
    thumb(c2, canonical(s.id), 0, 0, 52, { width: 2.2 });
    b.onclick = () => { state.sel = s.id; state.demo = 0; state.pendingDemo = null; renderAll(); };
    box.appendChild(b);
  }
}

// ---------------- 上方提示：采样、示范 ----------------
function renderPrompt() {
  const el = $('#prompt');
  if (state.tab === 'collect') {
    if (!state.queue.length || state.qi >= state.queue.length) {
      el.hidden = false;
      el.innerHTML = `<div><div class="big">${state.queue.length ? '这一轮采完了' : '采样'}</div><div class="muted small">每个符写 ${state.prefs.reps} 遍，外加 ${state.prefs.negs} 条乱画，顺序打乱。</div></div><button class="primary" id="startRound">${state.queue.length ? '再来一轮' : '开始'}</button>`;
      $('#startRound').onclick = startRound;
      return;
    }
    const id = state.queue[state.qi];
    el.hidden = false;
    if (id === 'neg') {
      el.innerHTML = `<div><div class="big">随手画点别的</div><div class="muted small">不是任何符：写个字、画个房子、乱涂几笔都行</div></div><div class="muted">${state.qi + 1} / ${state.queue.length}</div>`;
    } else {
      el.innerHTML = `<canvas width="128" height="128"></canvas><div><div class="big">请写：${nameOf(id)}</div><div class="muted small">${esc(symbolById(id).hint)}</div></div><div class="muted">${state.qi + 1} / ${state.queue.length}</div>`;
      const c2 = el.querySelector('canvas').getContext('2d');
      c2.scale(2, 2);
      thumb(c2, canonical(id), 0, 0, 64, { width: 2.4 });
    }
    return;
  }
  if (state.tab === 'demo') {
    const s = symbolById(state.sel);
    el.hidden = false;
    el.innerHTML = `<canvas width="128" height="128"></canvas><div><div class="big">示范「${s.name}」</div><div class="muted small">照你自己的习惯写三遍，族人就记住你的写法（${'●'.repeat(Math.min(3, state.demo))}${'○'.repeat(Math.max(0, 3 - state.demo))}）</div></div>`;
    const c2 = el.querySelector('canvas').getContext('2d');
    c2.scale(2, 2);
    thumb(c2, canonical(s.id), 0, 0, 64, { width: 2.4 });
    return;
  }
  el.hidden = true;
}

function startRound() {
  const q = [];
  for (const s of SYMBOLS) for (let i = 0; i < state.prefs.reps; i++) q.push(s.id);
  for (let i = 0; i < state.prefs.negs; i++) q.push('neg');
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  state.queue = q;
  state.qi = 0;
  state.roundSamples = [];
  grouper.cancel();
  renderAll();
}

// ---------------- 右栏：结果 ----------------
function verdictHtml(res) {
  const ctx = contextById(state.ctx);
  const verb = id => (ctx.verbs?.[id]?.verb ? ` · ${ctx.verbs[id].verb}` : '');
  const ms = res.ms != null ? `${res.ms.toFixed(1)} ms` : '';
  if (res.decision === 'accept') return `<div class="verdict accept">生效：${nameOf(res.top)}${verb(res.top)} <small>${ms}</small></div>`;
  if (res.decision === 'pick') return `<div class="verdict pick">请选：${res.choices.map(nameOf).join(' · ')} <small>拿不准 · ${ms}</small></div>`;
  if (res.decision === 'elsewhere') return `<div class="verdict elsewhere">${esc(res.reason)} <small>${ms}</small></div>`;
  return `<div class="verdict reject">神意不明 <small>${esc(res.reason || '')} ${ms}</small></div>`;
}

function renderResult() {
  const box = $('#result');
  const L = state.last;
  if (!L) {
    box.innerHTML = `<div class="card"><h3>结果</h3><p class="muted">写完一个符，这里显示两个识别器各自的把握，以及最后的结论：<b>生效</b>（两票一致且都有把握）、<b>请选</b>（拿不准，列出前两三个）、<b>神意不明</b>（拒）。</p></div>`;
    return;
  }
  const res = L.res;
  const rows = (res.ranked || []).slice(0, 5).map(r => {
    const bar = (cls, x, title) => `<div class="meter ${cls}" title="${title}"><i style="width:${Math.round(Math.max(0, Math.min(1, x)) * 100)}%"></i></div>`;
    return `<span class="n">${nameOf(r.id)}</span><div style="display:grid;gap:2px">${bar('', r.f, '总分')}${bar('cnn', r.q, 'CNN')}${bar('sim', (r.sim - 0.5) / 0.5, '原型')}${bar('pc', 1 - r.d / 0.3, '点云')}</div>` +
      `<span class="muted">${pct(r.f)}<br>CNN ${pct(r.q)} · 原型 ${r.sim.toFixed(2)}${r.own > 0 ? `（个人 ${r.own.toFixed(2)}）` : ''} · 点云 ${r.d.toFixed(3)}</span>`;
  }).join('');
  box.innerHTML = `<div class="card">${verdictHtml(res)}${rows ? `<div class="rows">${rows}</div><div class="legend"><span><b style="background:var(--ink)"></b>总分</span><span><b style="background:var(--ink-2)"></b>CNN</span><span><b style="background:var(--blue)"></b>原型相似</span><span><b style="background:var(--gold)"></b>点云相近</span></div>` : ''}
    ${res.qNeg != null ? `<p class="muted small" style="margin:8px 0 0">CNN 说「乱画」的把握 ${pct(res.qNeg)}；十符全开时最像「${nameOf(res.global)}」${pct(res.pGlobal || 0)}。</p>` : ''}</div>
    <div class="card peek"><canvas id="peek" width="32" height="32"></canvas><div class="small muted">模型看到的 32×32：等比缩放、居中，线宽固定，和你写多大无关。<br>${L.strokes.length} 笔 · ${L.strokes.reduce((n, s) => n + s.length, 0)} 个点</div></div>`;
  if (L.img) {
    const c2 = $('#peek').getContext('2d'), im = c2.createImageData(32, 32);
    for (let i = 0; i < 1024; i++) { const v = 255 - Math.round(255 * L.img[i]); im.data.set([v, v, v, 255], i * 4); }
    c2.putImageData(im, 0, 0);
  }
}

// ---------------- 右栏下半：各模式的面板 ----------------
function renderSide() {
  const box = $('#side');
  if (state.tab === 'try') {
    box.innerHTML = `<div class="card"><h3>试写</h3><p class="small">选「画在什么上面」，候选就跟着变：天上只比雨、日、月、火；树林里只比剑、树、火、旗……写一个不在候选里的符，会说「这里用不上」。</p>
      <label class="row small"><input type="checkbox" id="learn" ${state.prefs.learn ? 'checked' : ''}> 生效的符记进我的原型（每符留最近 30 个）</label>
      <p class="small muted">快捷键：<kbd>Enter</kbd> 立即认，<kbd>Backspace</kbd> 撤一笔，<kbd>Esc</kbd> 清空。</p></div>`;
    $('#learn').onchange = e => { state.prefs.learn = e.target.checked; save(PREFS_KEY, state.prefs); };
    return;
  }
  if (state.tab === 'collect') {
    const mine = state.samples.filter(s => (s.who || '') === state.prefs.who);
    const last = state.roundSamples.at(-1);
    box.innerHTML = `<div class="card"><h3>采样设置</h3>
      <div class="row small"><label>写字的人 <input type="text" id="who" value="${esc(state.prefs.who)}" placeholder="名字或代号" style="width:9em"></label></div>
      <div class="row small" style="margin-top:6px"><label>每符 <input type="number" id="reps" min="1" max="30" value="${state.prefs.reps}" style="width:4em"> 遍</label><label>乱画 <input type="number" id="negs" min="0" max="60" value="${state.prefs.negs}" style="width:4em"> 条</label></div>
      <p class="small muted">提示写什么就写什么，写坏了也照样记（真实数据就该有坏的）；真写错了字可以删掉上一条。这个人已采 ${mine.length} 条，全部 ${state.samples.length} 条。</p>
      ${last ? `<div class="row small">上一条：「${nameOf(last.label)}」→ ${last.got ? esc(last.got) : '—'} <button id="dropLast">删掉上一条</button></div>` : ''}</div>`;
    $('#who').onchange = e => { state.prefs.who = e.target.value.trim(); save(PREFS_KEY, state.prefs); renderSide(); };
    $('#reps').onchange = e => { state.prefs.reps = Math.max(1, Math.min(30, +e.target.value || 5)); save(PREFS_KEY, state.prefs); };
    $('#negs').onchange = e => { state.prefs.negs = Math.max(0, Math.min(60, +e.target.value || 0)); save(PREFS_KEY, state.prefs); };
    if (last) $('#dropLast').onclick = () => {
      state.roundSamples.pop(); state.qi--;
      state.samples = state.samples.filter(s => s !== last);
      save(SAMPLES_KEY, state.samples); renderAll();
    };
    return;
  }
  if (state.tab === 'demo') {
    const s = symbolById(state.sel), list = rec.personal[SYMBOLS.indexOf(s)];
    box.innerHTML = `<div class="card"><h3>「${s.name}」的个人原型（${list.length} / 30）</h3>
      ${state.pendingDemo ? `<div class="confirm small">这看着像「${nameOf(state.pendingDemo.looks)}」。确定记成「${s.name}」吗？ <button id="pdYes">记上</button> <button id="pdNo">不记</button></div>` : ''}
      <div class="thumbs" id="thumbs"></div>
      <p class="small muted">每条都同时当 CNN 特征原型和点云模板。写坏的删掉就好。</p>
      <div class="row"><button id="clearPersonal">清空全部个人原型</button></div></div>`;
    const tb = $('#thumbs');
    list.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 't';
      d.innerHTML = `<canvas width="96" height="96"></canvas><button title="删掉">×</button>`;
      const c2 = d.querySelector('canvas').getContext('2d');
      c2.scale(2, 2);
      thumb(c2, it.strokes, 0, 0, 48, { width: 1.8 });
      d.querySelector('button').onclick = () => { rec.removePersonal(s.id, i); savePersonal(rec); renderAll(); };
      tb.appendChild(d);
    });
    if (state.pendingDemo) {
      $('#pdYes').onclick = () => { addDemo(state.pendingDemo.strokes); state.pendingDemo = null; renderAll(); };
      $('#pdNo').onclick = () => { state.pendingDemo = null; renderAll(); };
    }
    $('#clearPersonal').onclick = () => { rec.clearPersonal(); savePersonal(rec); state.demo = 0; renderAll(); };
    return;
  }
  if (state.tab === 'eval') { renderEval(box); return; }
  if (state.tab === 'data') { renderData(box); return; }
}

// ---------------- 评测：拿采到的真人样本跑一遍 ----------------
function renderEval(box) {
  const n = state.samples.length;
  const E = state.evalOut;
  let html = `<div class="card"><h3>评测真人样本</h3><p class="small">用已采的 ${n} 条样本，在第一代每个语境里各认一遍：出厂模型，和加上你的个人原型之后。过关线：各语境平均<b>第一猜就对 ≥ 97%</b>，<b>乱画被拒 ≥ 95%</b>。</p>
    <button class="primary" id="runEval" ${n && !state.evalBusy ? '' : 'disabled'}>${state.evalBusy ? '评测中…' : '开始评测'}</button></div>`;
  if (E) {
    const line = (k, x, goal) => `<tr><td>${k}</td><td class="${x >= goal ? 'pass' : 'fail'}">${pct(x)}</td><td class="muted">≥ ${pct(goal)}</td></tr>`;
    for (const [title, R] of [['出厂模型', E.factory], ['加上个人原型', E.personal]]) {
      if (!R) continue;
      html += `<div class="card"><h3>${title}</h3><table class="grid"><tr><th>指标</th><th>结果</th><th>过关线</th></tr>
        ${R.firstAvg != null ? line('各语境平均 第一猜就对', R.firstAvg, 0.97) : ''}${R.negAvg != null ? line('各语境平均 乱画被拒', R.negAvg, 0.95) : ''}
        <tr><td>认错还生效</td><td>${pct(R.accBad)}</td><td class="muted">约等于 0</td></tr>
        <tr><td>十符全开 第一猜就对</td><td>${R.allFirst != null ? pct(R.allFirst) : '—'}</td><td class="muted">参考</td></tr></table>
        <div class="scroll" style="margin-top:8px"><table class="grid"><tr><th>语境</th><th>符</th><th>第一猜对</th><th>请选</th><th>误拒</th><th>乱画</th><th>被拒</th></tr>
        ${R.rows.map(r => `<tr><td>${r.name}</td><td>${r.pos}</td><td>${r.pos ? pct(r.first / r.pos) : '—'}</td><td>${r.pos ? pct(r.pick / r.pos) : '—'}</td><td>${r.pos ? pct(r.rej / r.pos) : '—'}</td><td>${r.neg}</td><td>${r.neg ? pct(r.negRej / r.neg) : '—'}</td></tr>`).join('')}</table></div></div>`;
    }
    const C = E.conf, cols = [...SYMBOLS.map(s => s.id), '拒', '别处'];
    html += `<div class="card"><h3>混淆表（出厂模型，十符全开）</h3><div class="scroll"><table class="grid"><tr><th>真值＼第一猜</th>${cols.map(c => `<th>${c === '拒' || c === '别处' ? c : nameOf(c)}</th>`).join('')}</tr>
      ${[...SYMBOLS.map(s => s.id), 'neg'].filter(t => C[t]).map(t => `<tr><th>${nameOf(t)}</th>${cols.map(c => { const v = C[t][c] || 0; return `<td class="${c === t ? 'hit' : v ? 'bad' : ''}">${v || '·'}</td>`; }).join('')}</tr>`).join('')}</table></div></div>`;
  }
  box.innerHTML = html;
  const b = $('#runEval');
  if (b) b.onclick = runEval;
}

async function runEval() {
  state.evalBusy = true;
  renderSide();
  const S = state.samples.map(s => ({ label: s.label, strokes: unpackStrokes(s.strokes) })).filter(s => s.strokes.length);
  const factory = new Recognizer(model);
  const out = { conf: {} };
  const hasPersonal = rec.personal.some(l => l.length);
  let tick = performance.now();
  for (const [key, R] of [['factory', factory], ['personal', hasPersonal ? rec : null]]) {
    if (!R) continue;
    const rows = [];
    let accBad = 0, posAll = 0, allFirst = 0, allN = 0;
    for (const ctx of CONTEXTS) {
      const cands = candidatesOf(ctx);
      const row = { name: ctx.name, pos: 0, first: 0, pick: 0, rej: 0, neg: 0, negRej: 0 };
      for (const s of S) {
        if (s.label !== 'neg' && !cands.includes(s.label)) continue;
        const res = R.recognize(s.strokes, { context: ctx.id });
        if (key === 'factory' && ctx.id === 'all') {
          const g = res.decision === 'reject' ? '拒' : res.decision === 'elsewhere' ? '别处' : res.top;
          out.conf[s.label] ??= {};
          out.conf[s.label][g] = (out.conf[s.label][g] || 0) + 1;
        }
        if (s.label === 'neg') { row.neg++; if (res.decision === 'reject') row.negRej++; }
        else {
          row.pos++;
          const ok = (res.decision === 'accept' || res.decision === 'pick') && res.top === s.label;
          if (ok) row.first++;
          if (res.decision === 'pick') row.pick++;
          if (res.decision === 'reject' || res.decision === 'elsewhere') row.rej++;
          if (res.decision === 'accept' && res.top !== s.label) accBad++;
          posAll++;
          if (ctx.id === 'all') { allN++; allFirst += ok; }
        }
        if (performance.now() - tick > 30) { await new Promise(r => setTimeout(r)); tick = performance.now(); }
      }
      rows.push(row);
    }
    const era = rows.slice(1);
    const fp = era.filter(r => r.pos), fn = era.filter(r => r.neg);
    out[key] = {
      rows, accBad: posAll ? accBad / posAll : 0, allFirst: allN ? allFirst / allN : null,
      firstAvg: fp.length ? fp.reduce((a, r) => a + r.first / r.pos, 0) / fp.length : null,
      negAvg: fn.length ? fn.reduce((a, r) => a + r.negRej / r.neg, 0) / fn.length : null,
    };
  }
  state.evalOut = out;
  state.evalBusy = false;
  renderSide();
}

// ---------------- 数据：导出、导入、清空 ----------------
function renderData(box) {
  const by = {}, who = {};
  for (const s of state.samples) { by[s.label] = (by[s.label] || 0) + 1; who[s.who || '（未署名）'] = (who[s.who || '（未署名）'] || 0) + 1; }
  box.innerHTML = `<div class="card"><h3>已采样本 ${state.samples.length} 条</h3>
    <div class="scroll"><table class="grid"><tr>${[...SYMBOLS.map(s => s.id), 'neg'].map(id => `<th>${nameOf(id)}</th>`).join('')}</tr><tr>${[...SYMBOLS.map(s => s.id), 'neg'].map(id => `<td>${by[id] || 0}</td>`).join('')}</tr></table></div>
    <p class="small">写字的人：${Object.entries(who).map(([k, v]) => `${esc(k)} ${v}`).join('，') || '—'}</p>
    <div class="row"><button class="primary" id="exp" ${state.samples.length ? '' : 'disabled'}>导出 JSON</button>
    <label class="row"><button id="impBtn">导入 JSON</button><input type="file" id="imp" accept=".json,application/json" hidden></label>
    <button id="clr" ${state.samples.length ? '' : 'disabled'}>清空样本</button></div>
    ${state.confirmClear ? `<div class="confirm small" style="margin-top:8px">清空全部 ${state.samples.length} 条样本？没法恢复（可先导出）。 <button class="red" id="clrYes">清空</button> <button id="clrNo">算了</button></div>` : ''}
    <p class="small muted">导出的文件给 <code>node tools/glyphcheck.mjs --human 文件.json</code> 用；多个人的文件可以一起评。</p></div>
    <div class="card"><h3>个人原型</h3><p class="small">共 ${rec.personal.reduce((n, l) => n + l.length, 0)} 条，存在本机浏览器里。</p>
    <div class="row"><button id="expP">导出个人原型</button></div></div>`;
  $('#exp').onclick = () => downloadText(`danqing-samples-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'danqing-samples', v: 1, exported: new Date().toISOString(), model: model.created, samples: state.samples }));
  $('#impBtn').onclick = () => $('#imp').click();
  $('#imp').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data?.samples)) throw new Error('没有样本列表');
      const add = data.samples.map((s, i) => {
        const row = sampleRow(s);
        if (!row) throw new Error(`第 ${i + 1} 条的符号或笔画格式不对`);
        return row;
      });
      const seen = new Set(state.samples.map(sampleKey));
      for (const s of add) {
        const key = sampleKey(s);
        if (!seen.has(key)) { seen.add(key); state.samples.push(s); }
      }
      const saved = save(SAMPLES_KEY, state.samples);
      renderAll();
      if (!saved) alertCard('浏览器没能保存。样本还在当前页面，可以先导出。');
    } catch (err) { alertCard(`导入失败：${err.message}`); }
  };
  $('#clr').onclick = () => { state.confirmClear = true; renderSide(); };
  if (state.confirmClear) {
    $('#clrYes').onclick = () => {
      state.samples = []; state.roundSamples = []; state.queue = []; state.qi = 0; state.confirmClear = false;
      save(SAMPLES_KEY, state.samples); renderAll();
    };
    $('#clrNo').onclick = () => { state.confirmClear = false; renderSide(); };
  }
  $('#expP').onclick = () => downloadText('danqing-personal.json', JSON.stringify(rec.exportPersonal()));
}

function alertCard(msg) {
  const box = $('#side');
  const d = document.createElement('div');
  d.className = 'card confirm';
  d.textContent = msg;
  box.prepend(d);
}

// ---------------- 写符 ----------------
function onSymbol(strokes) {
  if (!rec) return;
  if (tooSmall(strokes)) {
    state.last = { strokes, res: { decision: 'reject', reason: '太小了', ranked: [] } };
    renderResult();
    return;
  }
  const res = rec.recognize(strokes, { context: state.ctx });
  state.last = { strokes, res, img: Float32Array.from(rec.img) };
  if (state.tab === 'collect' && state.qi < state.queue.length) {
    const label = state.queue[state.qi++];
    const got = res.decision === 'accept' ? `生效 ${nameOf(res.top)}` : res.decision === 'pick' ? `请选 ${res.choices.map(nameOf).join('/')}` : res.decision === 'elsewhere' ? `别处 ${nameOf(res.global)}` : '拒';
    const sample = { label, strokes: packStrokes(strokes), who: state.prefs.who, at: Date.now(), ctx: state.ctx, got };
    state.samples.push(sample);
    state.roundSamples.push(sample);
    save(SAMPLES_KEY, state.samples);
  } else if (state.tab === 'demo') {
    // 和别的符太像（出厂模型直接就认成别的）时先问一句
    const plain = new Recognizer(model).recognize(strokes);
    if (plain.decision === 'accept' && plain.top !== state.sel) state.pendingDemo = { strokes, looks: plain.top };
    else addDemo(strokes);
  } else if (state.tab === 'try' && state.prefs.learn && res.decision === 'accept') {
    rec.addPersonal(res.top, strokes);
    savePersonal(rec);
  }
  renderAll();
}

function addDemo(strokes) {
  rec.addPersonal(state.sel, strokes);
  savePersonal(rec);
  state.demo++;
  if (state.demo >= 3) {
    const i = SYMBOLS.findIndex(s => s.id === state.sel);
    state.demo = 0;
    state.sel = SYMBOLS[(i + 1) % SYMBOLS.length].id; // 示范完一个，换下一个
  }
}

attachPen(pad, {
  onDown(p, t) {
    const closed = grouper.down(p, t);
    if (closed) onSymbol(closed.strokes);
    state.last && (state.lastFaded = true);
    $('#padhint').hidden = true;
  },
  onMove(p, t) { grouper.move(p, t); },
  onUp(p, t) { grouper.up(t); },
  onCancel() { grouper.cancel(); },
  onHover(p, t) { grouper.hover(p, t); },
});

function finishNow() {
  const g = grouper.close();
  if (g) onSymbol(g.strokes);
}
function undoStroke() {
  const g = grouper.group;
  if (!g) return;
  g.strokes.pop();
  if (!g.strokes.length) grouper.cancel();
}
$('#now').onclick = finishNow;
$('#undo').onclick = undoStroke;
$('#clear').onclick = () => { grouper.cancel(); state.last = null; renderResult(); };
addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'Enter') { e.preventDefault(); finishNow(); }
  else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undoStroke(); }
  else if (e.key === 'Escape') { grouper.cancel(); state.last = null; renderResult(); }
});

const ctxSel = $('#ctx');
ctxSel.innerHTML = CONTEXTS.map(c => `<option value="${c.id}">${c.name}${c.verbs ? `（${Object.keys(c.verbs).map(nameOf).join('')}）` : '（十符全开）'}</option>`).join('');
ctxSel.onchange = () => { grouper.cancel(); state.ctx = ctxSel.value; renderAll(); };

for (const b of document.querySelectorAll('#tabs button')) {
  b.onclick = () => {
    grouper.cancel();
    state.tab = b.dataset.tab;
    for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('on', x === b);
    state.demo = 0; state.pendingDemo = null; state.confirmClear = false;
    renderAll();
  };
}

function renderAll() { if (rec) { renderSymbols(); renderPrompt(); renderResult(); renderSide(); } }

// ---------------- 画纸（每帧） ----------------
function frame() {
  const { ctx, w, h } = fitCanvas(pad);
  if (!paperCache || paperCache.width !== pad.width || paperCache.height !== pad.height) {
    paperCache = document.createElement('canvas');
    paperCache.width = pad.width; paperCache.height = pad.height;
    const pc = paperCache.getContext('2d');
    pc.scale(pad.width / w, pad.height / h);
    paper(pc, w, h, 11);
  }
  ctx.drawImage(paperCache, 0, 0, w, h);
  const now = performance.now();
  const closed = grouper.tick(now);
  if (closed) onSymbol(closed.strokes);
  const g = grouper.group;
  if (g) {
    for (const s of g.strokes) inkStroke(ctx, s, { width: 5 });
    ring(ctx, grouper.ring(), { progress: grouper.progress(now) });
  } else if (state.last) {
    const L = state.last;
    for (const s of L.strokes) inkStroke(ctx, s, { width: 5, alpha: 0.35 });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of L.strokes) for (const p of s) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const r = L.res;
    const text = r.decision === 'accept' ? nameOf(r.top) : r.decision === 'pick' ? `${nameOf(r.top)}？` : r.decision === 'elsewhere' ? nameOf(r.global) : '？';
    if (x0 < Infinity) ghostText(ctx, text, (x0 + x1) / 2, (y0 + y1) / 2, { size: Math.max(40, Math.min(140, (y1 - y0) * 0.8)), alpha: 0.18, color: r.decision === 'accept' ? COLORS.ink : COLORS.red });
  }
  // 中心十字淡线，帮人把符写在中间
  ctx.save();
  ctx.strokeStyle = 'rgba(31,27,23,0.06)';
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(w / 2, 12); ctx.lineTo(w / 2, h - 12); ctx.moveTo(12, h / 2); ctx.lineTo(w - 12, h / 2); ctx.stroke();
  ctx.restore();
  requestAnimationFrame(frame);
}

(async () => {
  try {
    ({ rec, model } = await loadRecognizer());
    document.documentElement.dataset.ready = '1';
  } catch (err) {
    $('#result').innerHTML = `<div class="card confirm">${esc(err.message)}。请用 <code>node serve.mjs</code> 打开本页。</div>`;
    return;
  }
  renderAll();
  requestAnimationFrame(frame);
})();
