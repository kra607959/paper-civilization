// 墨笔神符识别：两个识别器投票，再按「画在什么上面」缩小候选。
//   1. 小卷积网（cnn.js）：给 11 类的把握（十符 + 乱画），外加一串 64 维特征；
//   2. 原型：特征和每个符的原型比相似度。出厂原型来自训练；「示范三遍」和日常生效的符会加进个人原型；
//   3. 点云模板（pcloud.js）：和每个符的模板比形状，个人样本也当模板。
// 决定：生效（两票一致且都有把握）/ 请选（列出前两三个）/ 神意不明（拒）/ 这里用不上（认出是别的符，但不在候选里）。

import { createNet, forward, unpackParams } from './cnn.js';
import { rasterize } from './raster.js';
import { cloud, match } from './pcloud.js';
import { SYMBOLS, NEG, CLASS_IDS, classIndex, candidatesOf, contextById } from './symbols.js';
import { augment } from './synth.js';
import { bbox, length } from './geom.js';
import { makeRng, midRng, hashSeed } from './rng.js';

export const TUNE = {
  wSim: 1.0, tauSim: 0.1,     // 原型相似度进总分的权重与温度
  wPc: 1.0, tauPc: 0.03,      // 点云距离进总分的权重与温度
  accept: 0.9,                // 生效：候选内总分的把握
  acceptCnn: 0.6,             // 生效：CNN 自己（候选内）的把握
  acceptPc: 0.14,             // 生效：点云距离上限
  rejectNeg: 0.5,             // CNN 说「乱画」的把握高于此 → 拒
  rejectLow: 0.25,            // 候选内 CNN 最高把握低于此，且原型、点云也不像 → 拒
  rejectSim: 0.8, rejectPc: 0.16,
  novelSim: 0,                // 与所有原型都不像（特征空间里离得远）→ 拒
  acceptSim: 0,               // 生效：与原型相似度下限
  elsewhere: 0.7,             // 候选外的符把握高于此 → 「这里用不上」
  keep: 30,                   // 每个符保留最近 30 个个人样本
  pcPersonal: 8,              // 其中最近几个也当点云模板
  factoryTemplates: 12,
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// 由特征定结论（便宜的部分，纯函数；tools/tune.mjs 拿它在缓存的特征上调门槛）。
// feat.rows 可以多于候选，只取 ci 里的。
export function decide(feat, ci, T = TUNE) {
  const { probs } = feat;
  let mass = probs[NEG];
  for (const c of ci) mass += probs[c];
  const rows = feat.rows.filter(r => ci.includes(r.c)).map(r => ({
    ...r, q: r.p / mass,
    score: Math.log(r.p + 1e-6) + T.wSim * (r.sim - 1) / T.tauSim - T.wPc * Math.min(r.d, 0.5) / T.tauPc,
  })).sort((a, b) => b.score - a.score);
  const m = rows.length ? rows[0].score : 0;
  let z = 0;
  for (const r of rows) { r.f = Math.exp(r.score - m); z += r.f; }
  for (const r of rows) r.f /= z;
  let gTop = 0;
  for (let c = 1; c < probs.length; c++) if (probs[c] > probs[gTop]) gTop = c;
  const pcTop = rows.reduce((b, r) => (!b || r.d < b.d ? r : b), null);
  const top = rows[0];
  const out = { probs, ranked: rows, top: top?.id, pcTop: pcTop?.id, qNeg: probs[NEG] / mass, global: CLASS_IDS[gTop], pGlobal: probs[gTop], choices: [] };
  const finish = (decision, reason, choices = []) => Object.assign(out, { decision, reason, choices });
  if (!top) return finish('reject', '这里不能写符');
  // 认出是候选外的符
  if (gTop !== NEG && !ci.includes(gTop) && probs[gTop] >= T.elsewhere && top.q < 0.2) {
    return finish('elsewhere', `认出是「${SYMBOLS[gTop].name}」，但这里用不上`);
  }
  // 乱画：CNN 说是乱画（用十一类里的原始把握，不随候选多少变）；或者 CNN、原型、点云三样都说不像
  if (probs[NEG] >= T.rejectNeg && top.own < 0.92) return finish('reject', '神意不明');
  if (top.q < T.rejectLow && top.sim < T.rejectSim && top.d > T.rejectPc && top.own < 0.9) return finish('reject', '神意不明');
  if (top.sim < T.novelSim && top.own < 0.9) return finish('reject', '神意不明');
  // 两票一致且都有把握 → 生效
  const agree = pcTop && pcTop.id === top.id;
  const cnnSure = top.q >= T.acceptCnn || (top.own >= 0.93 && top.q >= 0.2);
  if (top.f >= T.accept && agree && cnnSure && top.d <= T.acceptPc && top.sim >= T.acceptSim) return finish('accept', '生效', [top.id]);
  // 否则请选：前两三个（总分把握 ≥ 3%）
  return finish('pick', '拿不准，请选', rows.filter((r, i) => i === 0 || r.f >= 0.03).slice(0, 3).map(r => r.id));
}

function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  return Float32Array.from(v, x => x / s);
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// 太小、太少的输入直接不认（点一下、手抖一下）
export function tooSmall(strokes) {
  const pts = strokes.reduce((n, s) => n + s.length, 0);
  if (!strokes.length || pts < 3) return true;
  const len = strokes.reduce((n, s) => n + length(s), 0);
  const b = bbox(strokes);
  return len < 6 && Math.max(b.w, b.h) < 6; // 单位：输入坐标（像素）；合成样本的尺度约 1，不受此限
}

export class Recognizer {
  constructor(model, { tune } = {}) {
    const { P, arch } = unpackParams(model.weights);
    this.model = model;
    this.net = createNet(P, arch);
    this.size = arch.size;
    this.img = new Float32Array(arch.size * arch.size);
    this.tune = { ...TUNE, ...(model.tune || {}), ...(tune || {}) };
    this.factory = SYMBOLS.map(s => (model.protos?.[s.id] || []).map(v => normalize(v)));
    this.personal = SYMBOLS.map(() => []);
    this.templates = SYMBOLS.map((s, c) => {
      const T = [cloud(s.make(midRng()))];
      for (let i = 1; i < this.tune.factoryTemplates; i++) {
        const r = makeRng(hashSeed('tpl', s.id, i));
        T.push(cloud(augment(s.make(r), r, 0.35)));
      }
      return T;
    });
  }

  // CNN 前向：返回 11 类把握和归一化后的 64 维特征
  embed(strokes) {
    rasterize(strokes, this.size, { out: this.img });
    forward(this.net, this.img);
    return { probs: Array.from(this.net.probs), emb: normalize(this.net.e) };
  }

  // 与第 c 个符的原型（出厂 + 个人）最高相似度
  similarity(emb, c) {
    let best = -1;
    for (const p of this.factory[c]) best = Math.max(best, dot(emb, p));
    for (const it of this.personal[c]) best = Math.max(best, dot(emb, it.emb));
    return best;
  }

  personalHit(emb, c) {
    let best = -1;
    for (const it of this.personal[c]) best = Math.max(best, dot(emb, it.emb));
    return best;
  }

  pcDistance(cl, c) {
    let best = Infinity;
    for (const t of this.templates[c]) best = Math.min(best, match(cl, t, best));
    const P = this.personal[c];
    for (let i = Math.max(0, P.length - this.tune.pcPersonal); i < P.length; i++) best = Math.min(best, match(cl, P[i].cloud, best));
    return best;
  }

  // 算特征（贵的部分）：CNN 把握、与各候选原型的相似度、点云距离
  features(strokes, ci) {
    const { probs, emb } = this.embed(strokes);
    const cl = cloud(strokes);
    const rows = ci.map(c => ({ id: CLASS_IDS[c], c, p: probs[c], sim: this.similarity(emb, c), own: this.personalHit(emb, c), d: this.pcDistance(cl, c) }));
    return { probs, rows };
  }

  // context：CONTEXTS 里的 id；也可直接给 cands（符 id 数组）
  recognize(strokes, { context = 'all', cands } = {}) {
    const t0 = now();
    const ids = cands || candidatesOf(contextById(context));
    const ci = ids.map(classIndex).filter(c => c >= 0 && c < NEG);
    if (!strokes.length || strokes.every(s => !s.length)) return { ms: 0, cands: ids, ranked: [], choices: [], decision: 'reject', reason: '没写东西' };
    const out = decide(this.features(strokes, ci), ci, this.tune);
    out.cands = ids;
    out.ms = now() - t0;
    return out;
  }

  // ---- 个人原型 ----
  addPersonal(id, strokes) {
    const c = classIndex(id);
    if (c < 0 || c >= NEG) return;
    const { emb } = this.embed(strokes);
    const list = this.personal[c];
    list.push({ strokes, emb, cloud: cloud(strokes), at: Date.now() });
    while (list.length > this.tune.keep) list.shift();
  }
  removePersonal(id, index) { const c = classIndex(id); if (c >= 0 && c < NEG) this.personal[c].splice(index, 1); }
  clearPersonal() { this.personal = SYMBOLS.map(() => []); }
  personalCount(id) { const c = classIndex(id); return c >= 0 && c < NEG ? this.personal[c].length : 0; }
  exportPersonal() {
    return { v: 1, items: this.personal.flatMap((list, c) => list.map(it => ({ id: CLASS_IDS[c], strokes: it.strokes, at: it.at }))) };
  }
  importPersonal(data) {
    this.clearPersonal();
    for (const it of data?.items || []) this.addPersonal(it.id, it.strokes);
  }
}
