// 铅笔图纸：蓝底白线，照提示一部分一部分画，每步量一次，最后照图建造。
// locked(id)：这张图纸眼下画不了的原因（没有就是 null），点了只说原因；backdrop(id)：垫在底下的旧笔画（祭坛前几段）
import { BlueprintSession, BLUEPRINTS } from '../recog/blueprint.js';
import { fitCanvas, pencilStroke } from '../ui/ink.js';
import { attachPen } from '../ui/pointer.js';

export function openSheet(root, { onBuilt, onClose, start = 'shack', ids = ['shack', 'pad'], buildLabel = '照图建造', locked = () => null, backdrop = () => null, buildText = () => null } = {}) {
  root.hidden = false;
  if (locked(start)) start = ids.find(id => !locked(id)) || start;
  const eraGroup = ids.some(id => BLUEPRINTS[id].era === '第二代');
  const btnHtml = id => {
    const why = locked(id), bp = BLUEPRINTS[id];
    const tag = eraGroup ? (bp.era === '第二代' ? ' · 陶' : '') : (bp.demo ? ` · ${bp.era}` : '');
    const cls = [why ? 'locked' : '', bp.era === '第二代' ? 'era2' : ''].filter(Boolean).join(' ');
    return `<button data-bp="${id}"${cls ? ` class="${cls}"` : ''}${why ? ` title="${why}"` : ''}>${bp.name}${tag}</button>`;
  };
  root.innerHTML = `<div class="box" role="dialog" aria-label="图纸">
    <div><div class="row" style="margin-bottom:8px"><b style="font-family:var(--serif);font-size:17px">图纸</b>
      ${ids.map(btnHtml).join('')}</div>
      <canvas id="bpc" tabindex="-1"></canvas></div>
    <div class="steps"><div id="bpSteps"></div><div id="bpMsg" class="small"></div><div id="bpStats" class="statbar"></div>
      <div class="row"><button id="bpRedo">重画这一步</button><button id="bpSkip" hidden>跳过</button><button id="bpNext" class="primary">这一步画好了 <kbd>Enter</kbd></button></div>
      <div class="row"><button id="bpBuild" class="primary" hidden>${buildLabel}</button><button id="bpClose">收起 <kbd>Esc</kbd></button></div>
      <p class="small muted">不做分类：目标已知，只量这一部分画得多高、多直、接没接上。画歪了不会废，画得好数值更高。</p></div></div>`;
  const cv = root.querySelector('#bpc');
  let S, cur = [], drawing = null, msg = '', ok = null, alive = true, cw = 1;
  const pick = id => { S = new BlueprintSession(id); cur = []; msg = ''; ok = null; render(); };

  const next = () => {
    if (!S.step) return;
    const res = S.submit(cur);
    msg = res.msg; ok = res.ok;
    if (res.ok) cur = [];
    render();
  };
  root.querySelectorAll('[data-bp]').forEach(b => (b.onclick = () => {
    const why = locked(b.dataset.bp);
    if (why) { msg = `${BLUEPRINTS[b.dataset.bp].name}还画不了：${why}`; ok = false; render(); return; }
    pick(b.dataset.bp);
  }));
  root.querySelector('#bpNext').onclick = next;
  root.querySelector('#bpRedo').onclick = () => { cur = []; msg = ''; ok = null; render(); };
  root.querySelector('#bpSkip').onclick = () => { S.skip(); cur = []; render(); };
  root.querySelector('#bpBuild').onclick = () => {
    if (S.step || locked(S.bp.id)) return;
    onBuilt?.(S); close();
  };
  root.querySelector('#bpClose').onclick = () => close();
  const key = e => {
    if (e.key === 'Enter' && !e.target?.closest?.('button')) { e.preventDefault(); next(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Backspace') { e.preventDefault(); cur.pop(); }
    e.stopPropagation();
  };
  addEventListener('keydown', key, true);
  function close() { alive = false; root.hidden = true; root.innerHTML = ''; removeEventListener('keydown', key, true); onClose?.(); }

  attachPen(cv, {
    toWorld: p => ({ x: p.x / cw, y: p.y / cw }),
    onDown(p, t) { cv.focus({ preventScroll: true }); drawing = [{ ...p, t }]; cur.push(drawing); },
    onMove(p, t) { drawing?.push({ ...p, t }); },
    onUp() { drawing = null; },
    onCancel() { if (cur.at(-1) === drawing) cur.pop(); drawing = null; },
  });

  function render() {
    const st = S.step;
    root.querySelector('#bpSteps').innerHTML = `<div style="font-family:var(--serif);font-size:16px">${S.bp.name} <span class="muted small">${S.bp.era} · 耗 ${S.bp.cost}</span></div>${S.bp.blurb ? `<div class="small muted">${S.bp.blurb}</div>` : ''}<ol>${S.bp.steps.map((x, i) =>
      `<li class="${i < S.i ? 'done' : i === S.i ? 'now' : ''}">${x.prompt}${i < S.i ? ` — ${S.parts[x.id].msg}` : ''}</li>`).join('')}</ol>`;
    root.querySelector('#bpMsg').innerHTML = msg ? `<span class="${ok ? 'pass' : 'fail'}">${ok ? '量好了：' : '没过：'}${msg}</span>` : (st ? '照淡影画，画好点「这一步画好了」。' : '图纸画完了。');
    const stats = S.stats();
    root.querySelector('#bpStats').innerHTML = stats.map(x => `<span>${x.k}</span>${x.x == null ? '<span></span>' : `<div class="meter" title="${x.why}"><i style="width:${Math.round(x.x * 100)}%"></i></div>`}<span>${x.v || (x.x == null ? '' : Math.round(x.x * 100) + '%')}</span>`).join('');
    root.querySelector('#bpSkip').hidden = !st?.optional;
    root.querySelector('#bpNext').disabled = !st;
    root.querySelector('#bpBuild').hidden = !!st;
    root.querySelector('#bpBuild').textContent = buildText(S.bp) || (S.bp.place === 'line' ? '照图修：回地图用铅笔画走向' : buildLabel);
    root.querySelectorAll('[data-bp]').forEach(b => b.classList.toggle('primary', b.dataset.bp === S.bp.id));
  }

  function frame() {
    if (!alive) return;
    const { ctx, w, h } = fitCanvas(cv);
    cw = w;
    ctx.fillStyle = S.bp.era === '第二代' ? '#1b4166' : '#1d4c8a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = S.bp.era === '第二代' ? 'rgba(214, 158, 120, 0.18)' : 'rgba(160,190,235,0.22)';
    ctx.lineWidth = 0.6;
    for (let x = 0; x <= w; x += w / 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += w / 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = S.bp.era === '第二代' ? 'rgba(222, 146, 98, 0.62)' : 'rgba(220,235,255,0.35)';
    ctx.lineWidth = S.bp.era === '第二代' ? 1.6 : 1;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    const px = s => s.map(p => ({ x: p.x * w, y: p.y * w }));
    // 垫底的旧笔画（祭坛已经修好的那几段）：淡白
    for (const s of backdrop(S.bp.id) || []) pencilStroke(ctx, px(s), { color: '#d6e4f7', width: 1.6, alpha: 0.38 });
    // 已量好的部分：白线；当前这一步：提示淡影 + 正在画的
    for (const [id, strokes] of Object.entries(S.strokes)) for (const s of strokes) pencilStroke(ctx, px(s), { color: '#eef4ff', width: 2, alpha: 0.95 });
    if (S.step) {
      ctx.save();
      for (const s of S.step.ghost) pencilStroke(ctx, px(s), { color: '#9cc0ee', width: 1.4, alpha: 0.55, dash: [5, 6] });
      ctx.restore();
    }
    for (const s of cur) pencilStroke(ctx, px(s), { color: '#ffffff', width: 2.2 });
    ctx.fillStyle = 'rgba(220,235,255,0.75)';
    ctx.font = '13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText(S.step ? `第 ${S.i + 1} 步：${S.step.prompt}` : `${S.bp.name}：图纸画完了`, 12, 22);
    requestAnimationFrame(frame);
  }
  pick(start);
  requestAnimationFrame(frame);
  return { close };
}
