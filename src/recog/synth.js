// 合成样本：标准写法 → 各种合理变体 → 人手的毛病（抖、歪、断笔、出头、多一小笔）。
// level 是「手有多潦草」：0.35 近乎工整，1 为训练用的常态，1.6 为留作评测的「潦草」档（训练里不出现这么大的变形）。
// 同一个种子在 Node 和浏览器里出同一份样本。

import { SYMBOLS, NEG } from './symbols.js';
import { negativeNamed } from './negatives.js';
import { bbox, line, length, affine, rotateAbout } from './geom.js';
import { makeRng, hashSeed } from './rng.js';

const copy = S => S.map(s => s.map(p => ({ x: p.x, y: p.y })));

// 绕自身中心缩放、转动，再平移
function jiggle(s, sc, ang, dx, dy) {
  if (s.length < 2) return s.map(p => ({ x: p.x + dx, y: p.y + dy }));
  const b = bbox([s]), c = Math.cos(ang) * sc, sn = Math.sin(ang) * sc;
  return s.map(p => ({ x: b.cx + (p.x - b.cx) * c - (p.y - b.cy) * sn + dx, y: b.cy + (p.x - b.cx) * sn + (p.y - b.cy) * c + dy }));
}

// 端点出头或不到：沿端点切线延长（e > 0）或截短（e < 0）
function extendEnd(s, e) {
  if (s.length < 3 || e === 0) return s;
  if (e > 0) {
    const a = s[s.length - 1], b = s[Math.max(0, s.length - 4)];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return [...s, ...line(a.x, a.y, a.x + (a.x - b.x) / d * e, a.y + (a.y - b.y) / d * e).slice(1)];
  }
  let cut = -e, i = s.length - 1;
  const keep = length(s) * 0.5;
  if (cut > keep) cut = keep;
  while (i > 1 && cut > 0) { cut -= Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y); i--; }
  return s.slice(0, i + 1);
}

// 手不稳：沿弧长的低频摆动
function wobble(s, r, amp, wl) {
  if (s.length < 3 || amp <= 0) return s;
  const k1 = 2 * Math.PI / (wl * r.range(0.6, 1.4)), k2 = 2 * Math.PI / (wl * r.range(0.25, 0.5));
  const p1 = r.range(0, 6.3), p2 = r.range(0, 6.3), p3 = r.range(0, 6.3), p4 = r.range(0, 6.3);
  let acc = 0;
  return s.map((p, i) => {
    if (i) acc += Math.hypot(p.x - s[i - 1].x, p.y - s[i - 1].y);
    return {
      x: p.x + amp * (0.75 * Math.sin(k1 * acc + p1) + 0.25 * Math.sin(k2 * acc + p2)),
      y: p.y + amp * (0.75 * Math.sin(k1 * acc + p3) + 0.25 * Math.sin(k2 * acc + p4)),
    };
  });
}

export function augment(strokes, r, L = 1) {
  let S = copy(strokes).filter(s => s.length);
  if (L <= 0) return S;
  const b0 = bbox(S), span = Math.max(b0.w, b0.h) || 1;
  // 断笔：长笔画偶尔断成两笔（缺一点或叠一点）
  const broken = [];
  for (const s of S) {
    if (s.length > 16 && r.chance(0.05 * L)) {
      const k = Math.floor(s.length * r.range(0.3, 0.7)), g = r.int(3);
      broken.push(s.slice(0, k + 1), s.slice(Math.min(s.length - 2, k + g)));
    } else broken.push(s);
  }
  S = broken;
  // 每一笔各自偏一点、大小差一点、斜一点
  S = S.map(s => jiggle(s, 1 + r.normal() * 0.06 * L, r.normal() * 0.07 * L, r.normal() * 0.022 * L * span, r.normal() * 0.022 * L * span));
  // 端点出头或不到
  S = S.map(s => {
    if (s.length < 3) return s;
    const closed = Math.hypot(s[0].x - s[s.length - 1].x, s[0].y - s[s.length - 1].y) < 0.08 * span;
    if (closed) return s;
    let t = extendEnd(s, r.range(-0.06, 0.08) * L * span);
    t = extendEnd(t.slice().reverse(), r.range(-0.06, 0.08) * L * span).reverse();
    return t;
  });
  // 手抖：低频摆动 + 一点高频毛刺
  S = S.map(s => wobble(s, r, 0.012 * L * span, 0.3 * span));
  S = S.map(s => s.map(p => ({ x: p.x + r.normal() * 0.002 * L * span, y: p.y + r.normal() * 0.002 * L * span })));
  // 整体：转、错切、拉扁拉高（都绕自身中心，位置不动：图纸的各部分还对得上）
  const b = bbox(S), rot = r.normal() * 0.09 * L, sh = r.normal() * 0.08 * L, ax = Math.exp(r.normal() * 0.1 * L);
  S = affine(S, ax, sh, 0, 1 / ax, b.cx - ax * b.cx - sh * b.cy, b.cy - b.cy / ax);
  S = rotateAbout(S, rot, b.cx, b.cy);
  // 偶尔手滑多一小笔
  if (r.chance(0.02 * L)) {
    const bb = bbox(S), x = bb.x0 + r() * bb.w, y = bb.y0 + r() * bb.h, a = r.range(0, 6.3), l = r.range(0.03, 0.07) * span;
    S.push(line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l));
  }
  // 一笔的方向随人：一半倒过来
  return S.map(s => (r.chance(0.5) ? s.slice().reverse() : s));
}

export const positive = (r, cls, L = 1) => augment(SYMBOLS[cls].make(r), r, L);
export const scribbleNamed = (r, family = 'train', L = 1) => {
  const { name, strokes } = negativeNamed(r, family);
  return { name, strokes: augment(strokes, r, L) };
};
export const scribbleSample = (r, family = 'train', L = 1) => scribbleNamed(r, family, L).strokes;

// 训练用的一条样本：约 22% 是乱画，其余十符均分
export const NEG_SHARE = 0.22;
export function trainSample(r, L = 1) {
  if (r.chance(NEG_SHARE)) return { cls: NEG, strokes: scribbleSample(r, 'train', L) };
  const cls = r.int(SYMBOLS.length);
  return { cls, strokes: positive(r, cls, L) };
}

// 可复现的评测集：每个符 n 条；kind = 'std' | 'sloppy' | 'neg' | 'negHeld'
export function evalSet(kind, n, seed = 20261119) {
  const out = [];
  if (kind === 'neg' || kind === 'negHeld') {
    for (let i = 0; i < n; i++) {
      const r = makeRng(hashSeed(kind, seed, i));
      const { name, strokes } = scribbleNamed(r, kind === 'neg' ? 'train' : 'held', 1);
      out.push({ cls: NEG, strokes, family: name });
    }
    return out;
  }
  const L = kind === 'sloppy' ? 1.6 : 1;
  for (let c = 0; c < SYMBOLS.length; c++) for (let i = 0; i < n; i++) {
    const r = makeRng(hashSeed(kind, seed, c, i));
    out.push({ cls: c, strokes: positive(r, c, L) });
  }
  return out;
}

// 「怪笔迹的人」：每人对每个符有自己固定的一种写法，再加一个固定的歪法（斜、扁、错切），
// 外加每次写的随手变化。用来测「示范三遍」之后认得准不准。
export function writer(id) {
  const r = makeRng(hashSeed('writer', id));
  const rot = r.range(-0.3, 0.3), sh = r.range(-0.35, 0.35), ax = Math.exp(r.range(-0.35, 0.35));
  const habits = { rot, sh, ax };
  return {
    id, habits,
    sample(cls, i) {
      const shape = SYMBOLS[cls].make(makeRng(hashSeed('writer', id, 'shape', cls)));
      const rr = makeRng(hashSeed('writer', id, cls, i));
      let S = augment(shape, rr, 0.8);
      const b = bbox(S);
      S = affine(S, ax, sh, 0, 1 / ax, 0, 0);
      return rotateAbout(S, rot, b.cx, b.cy);
    },
  };
}
