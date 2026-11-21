import { DAY, TECHS } from '../sim/config.js';
import { localBuildings } from '../sim/util.js';
import { tribeKnows } from '../sim/tech.js';
import { BELL_INK, CITY_LAWS, CITY_TAX, cityDefense, cityFollowers, cityPopulation, citySeat, lockCityGlyph } from '../sim/era3.js';
import { BRONZE_GLYPHS } from '../recog/bronze.js';

const n = v => Math.round(v || 0);
const pct = v => `${n(v * 100)}%`;
const thumbs = Object.fromEntries(Object.entries(BRONZE_GLYPHS).map(([id, g]) => [id,
  `<svg viewBox="0 0 100 100" aria-hidden="true">${g.strokes.map(s => `<path d="${s.map((p, i) => `${i ? 'L' : 'M'}${n(p.x * 100)},${n(p.y * 100)}`).join(' ')}"/>`).join('')}</svg>`]));

export function makeCityPanel(el, hooks) {
  let tab = '城务', old = '', down = false;
  el.addEventListener('pointerdown', () => { down = true; });
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => { down = false; });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ct) { tab = b.dataset.ct; hooks.refresh(); return; }
    if (b.dataset.city) hooks.act(b.dataset.city, b.dataset.id);
  });
  return (sim, open) => {
    el.hidden = !open || !sim.era3?.active;
    if (el.hidden) { old = ''; return; }
    if (down) return;
    const E = sim.era3, wall = localBuildings(sim, 'citywall')[0], bell = sim.idx[E.bell], T = E.trial;
    const tabs = ['城务', '诸邦', '书简', '符谱'].map(x => `<button class="${tab === x ? 'on' : ''}" data-ct="${x}">${x}</button>`).join('');
    const locked = (id, ctx) => lockCityGlyph(sim, ctx, id);
    const cast = (id, ref = 'city') => `<button data-city="cast" data-id="${id}:${ref}" title="${locked(id, ref === 'city' ? 'city' : 'polis') || ''}">${BRONZE_GLYPHS[id].name} · ${BRONZE_GLYPHS[id].ink}墨</button>`;
    let body;
    if (tab === '城务') {
      const d = Math.max(0, Math.ceil(((T?.nextAt ?? E.trialAt) - sim.t) / DAY));
      body = `<div class="city-trial"><b>${E.done ? '联盟已退' : T ? `联盟 • 第 ${T.wave + 1} 波` : '诸邦会盟'}</b>
        <span>${E.done ? `守住 ${E.result.held}/3 波` : `${d} 天${T ? '后交锋' : '后动身'} · 城防 ${cityDefense(sim)}${T ? ` / 来势 ${T.strength + T.wave * 7}` : ''}`}</span></div>
        <div class="city-kpis"><div>辖境<b>${cityPopulation(sim)} 人</b></div><div>税仓<b>${E.treasury} 谷</b></div><div>守卒<b>${E.guards} 名</b></div><div>民怨<b>${pct(E.unrest)}</b></div></div>
        <p class="small muted">城中 ${sim.alive.length} 人 · 附属村 ${E.villages.map(v => `${v.name} ${v.pop} 人`).join('、')}。${Object.entries(E.census).map(([k, n]) => `${k} ${n} 户`).join(' · ')}；掌事户免赋、工户少缴。</p>
        <div class="row city-actions">${['recruit', 'patrol', 'guard', 'ritual'].map(id => cast(id)).join('')}</div>
        <h4>工事与铸钟</h4><div class="row"><span>城墙 ${wall ? pct(wall.integrity) : '未建'}</span><button data-city="repair">修墙</button><button data-city="plan" data-id="citywall">城墙图纸</button></div>
        <div class="row"><span>${bell ? `音高 ${bell.params.hz} Hz · 传声 ${bell.params.reach} 步 · 信众 ${cityFollowers(sim)}` : '先建铸铜炉，研究合金，画钟的剖面'}</span><button data-city="bell">${bell ? `鸣钟 · ${BELL_INK}墨` : '铸钟图纸'}</button></div>
        <h4>赋税</h4><div class="row">${Object.entries(CITY_TAX).map(([k, v]) => `<button class="${E.tax === k ? 'on' : ''}" data-city="tax" data-id="${k}">${v}</button>`).join('')}</div>
        <p class="small muted">${tribeKnows(sim, 'tribute') ? '加赋补军粮，但推高民怨；减赋能缓和叛乱。' : '研究「税赋」后可调整赋税。'}${E.law ? ` 现行律：${CITY_LAWS[E.law]}。` : ''}</p>`;
    } else if (tab === '诸邦') {
      body = `<p class="small">有市集即可派商队。车道和驿传缩短往返；贸易与钟声改善邦交、减弱会盟来势。</p>
        ${E.rivals.map(r => `<div class="city-card" style="--polis:${r.color}"><b>${r.name} · ${r.pop} 人</b><small>${r.allied ? '亲善' : r.mood < -0.15 ? '戒备' : '往来'} · 好感 ${pct(r.mood)} · 钟声信众 ${n(r.faith * r.pop)} 人</small>
        <div class="row">${cast('trade', r.id)}<button data-city="focus" data-id="${r.id}">到城印</button>${E.convoys.some(q => q.ref === r.id) ? '<small>商队在途</small>' : ''}</div></div>`).join('')}`;
    } else if (tab === '书简') {
      const ids = Object.keys(E.archive);
      const texts = Object.entries(E.scripture);
      body = `<p class="small">书简上有 <b>${ids.length}</b> 门技艺；会的人不在了，史官还能按书简传回。学文字后，已生效的城邦神谕会抄成经文。</p>
        <div class="city-tags">${ids.map(id => `<span>${TECHS[id].name}</span>`).join('') || '<span>尚未载册</span>'}</div>
        <h4>经文与常行律</h4>
        ${texts.map(([id, m]) => `<div class="row city-line"><span>${BRONZE_GLYPHS[id].name} · 已载 ${m.count} 次</span><button class="${E.law === id ? 'on' : ''}" data-city="law" data-id="${id}">${E.law === id ? '施行中' : `定为${CITY_LAWS[id]} · 4墨`}</button></div>`).join('') || '<p class="small muted">还没有抄下城邦神谕。</p>'}
        <p class="small muted">律令需「立法」和宫室；改立新律会替换旧律。可在符谱把守城和祭祀合为「安」。</p>`;
    } else {
      body = `<p class="small">这些是图形，不是汉字。按 <kbd>2</kbd> 切墨笔，在城务台或邻邦城印上照样画，画完可按 <kbd>Enter</kbd>。也可以点选发令。</p>
        ${Object.entries(BRONZE_GLYPHS).map(([id, g]) => `<div class="city-glyph">${thumbs[id]}<div><b>${g.name}</b><small>${g.hint} · ${id === 'trade' ? '邻邦城印' : '城务台'}</small><small>${locked(id, id === 'trade' ? 'polis' : 'city') || ''}</small></div>${id === 'trade' ? '<button data-ct="诸邦">选邻邦</button>' : cast(id)}</div>`).join('')}
        <button data-city="focus" data-id="city">定位城务台</button>`;
    }
    const html = `<div class="row"><b class="nm">城务 · 青铜</b><button class="x" data-city="close" aria-label="关上">×</button></div><div class="ptabs">${tabs}</div>${body}`;
    if (old !== html) { old = html; const scroll = el.scrollTop; el.innerHTML = html; el.scrollTop = scroll; }
  };
}

export function cityFocus(sim, ref) {
  return ref === 'city' ? localBuildings(sim, 'palace')[0] || citySeat(sim) : sim.idx[ref];
}

// 合成钟声：剖面决定基音和余音，多个比率并不整齐的泛音保留金属感。
let ac;
export async function playCityBell(pitch, tone) {
  if (!window.AudioContext) return false;
  try {
    ac ||= new AudioContext();
    await ac.resume();
    const at = ac.currentTime;
    for (const [i, ratio] of [1, 1.47, 2.19, 2.91, 4.03].entries()) {
      const o = ac.createOscillator(), a = ac.createGain();
      const decay = (2.3 + tone * 3.5) / (1 + i * 0.42);
      o.frequency.value = pitch * ratio;
      a.gain.setValueAtTime(0.0001, at);
      a.gain.exponentialRampToValueAtTime(0.122 / (i + 1), at + 0.016);
      a.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      o.connect(a).connect(ac.destination);
      o.start(at); o.stop(at + decay + 0.025);
    }
    return true;
  } catch { return false; }
}
