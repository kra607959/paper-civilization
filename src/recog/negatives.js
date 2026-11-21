// 「乱画」：不是任何神符的东西。分两族：
//   TRAIN 进训练（随手涂、常见图形、常见字母、火柴人……）；
//   HELD  只在评测里出现（像汉字的笔画堆、别的字母、鱼、船、钥匙、伞……），看拒识能不能推广到没见过的东西。
// 小心：别把十符自己的自然变体放进来（比如一笔「M」形折线就是山），否则是在跟正样本打架。

import { line, poly, arc, curve, wave, rotateAbout, fit } from './geom.js';

const PI = Math.PI;

function scribble(r) {
  const S = [], n = 1 + r.int(3);
  for (let k = 0; k < n; k++) {
    let x = r.range(0.1, 0.9), y = r.range(0.1, 0.9), a = r.range(0, 2 * PI);
    const pts = [[x, y]], m = 5 + r.int(14), step = r.range(0.06, 0.16);
    for (let i = 0; i < m; i++) {
      a += r.normal() * 0.9;
      x = Math.min(1, Math.max(0, x + Math.cos(a) * step)); y = Math.min(1, Math.max(0, y + Math.sin(a) * step));
      pts.push([x, y]);
    }
    S.push(curve(pts));
  }
  return S;
}

function zigzagV(r) { // 竖着的折线（像闪电但更乱）
  const n = 3 + r.int(5), pts = [];
  for (let i = 0; i <= n; i++) pts.push([0.5 + (i % 2 ? 1 : -1) * r.range(0.1, 0.35), i / n]);
  return rotateAbout([poly(pts)], r.range(-0.5, 0.5), 0.5, 0.5);
}

function sawtooth(r) { // 五个以上一样高的齿
  const n = 5 + r.int(4), h = r.range(0.15, 0.4), pts = [];
  for (let i = 0; i <= 2 * n; i++) pts.push([i / (2 * n), i % 2 ? 0.5 - h : 0.5]);
  return rotateAbout([poly(pts)], r.range(0, 2 * PI), 0.5, 0.5);
}

function spiral(r) {
  const turns = r.range(1.5, 3.2), dir = r.chance(0.5) ? 1 : -1, a0 = r.range(0, 2 * PI), m = Math.ceil(turns * 60), s = [];
  for (let i = 0; i <= m; i++) {
    const t = i / m, a = a0 + dir * t * turns * 2 * PI, rad = 0.05 + 0.42 * t;
    s.push({ x: 0.5 + Math.cos(a) * rad, y: 0.5 + Math.sin(a) * rad });
  }
  return [s];
}

function hatch(r) { // 一组平行线：四到七道任意方向，或两三道斜的
  const many = r.chance(0.6), n = many ? 4 + r.int(4) : 2 + r.int(2);
  const ang = many ? r.range(0, PI) : (r.chance(0.5) ? -1 : 1) * r.range(0.5, 1.1);
  const len = r.range(0.4, 1), gap = 0.8 / n, S = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * gap, cx = 0.5 - Math.sin(ang) * off, cy = 0.5 + Math.cos(ang) * off;
    const l = len * r.range(0.8, 1.2) / 2;
    S.push(line(cx - Math.cos(ang) * l, cy - Math.sin(ang) * l, cx + Math.cos(ang) * l, cy + Math.sin(ang) * l));
  }
  return S;
}

function square(r) {
  const w = r.range(0.6, 1), h = r.range(0.6, 1), x0 = 0.5 - w / 2, y0 = 0.5 - h / 2;
  const P = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
  if (r.chance(0.6)) return [poly(P, true)];
  return P.map((p, i) => line(p[0], p[1], P[(i + 1) % 4][0], P[(i + 1) % 4][1]));
}

function triangle(r) {
  const a = r.range(0, 2 * PI), P = [0, 1, 2].map(i => [0.5 + Math.cos(a + i * 2.094 + r.range(-0.3, 0.3)) * 0.45, 0.5 + Math.sin(a + i * 2.094 + r.range(-0.3, 0.3)) * 0.45]);
  return [poly(P, true)];
}

function circle(r) {
  const a0 = r.range(0, 2 * PI);
  return [arc(0.5, 0.5, r.range(0.35, 0.45), r.range(0.35, 0.45), a0, a0 + 2 * PI * r.range(0.95, 1.06))];
}

function rings(r) {
  const S = [], n = 2 + r.int(2);
  for (let i = 0; i < n; i++) { const rad = 0.45 * (n - i) / n, a0 = r.range(0, 2 * PI); S.push(arc(0.5, 0.5, rad, rad, a0, a0 + 2 * PI)); }
  return S;
}

function house(r) {
  const w = r.range(0.5, 0.8), h = r.range(0.35, 0.55), roof = r.range(0.2, 0.4), x0 = 0.5 - w / 2, y1 = 0.95, y0 = y1 - h;
  const S = [poly([[x0, y0], [x0, y1], [x0 + w, y1], [x0 + w, y0]]), poly([[x0 - 0.05, y0], [0.5, y0 - roof], [x0 + w + 0.05, y0]])];
  if (r.chance(0.5)) S.push(poly([[0.45, y1], [0.45, y1 - h * 0.5], [0.57, y1 - h * 0.5], [0.57, y1]]));
  return S;
}

function heart(r) {
  return [curve([[0.5, 0.95], [0.12, 0.55], [0.12, 0.25], [0.32, 0.1], [0.5, 0.3], [0.68, 0.1], [0.88, 0.25], [0.88, 0.55], [0.5, 0.95]], { corners: [4] })];
}

function arrow(r) {
  const a = r.range(0, 2 * PI), l = 0.45, hx = 0.5 + Math.cos(a) * l, hy = 0.5 + Math.sin(a) * l, h = r.range(0.15, 0.25);
  return rotateAbout([line(0.5 - Math.cos(a) * l, 0.5 - Math.sin(a) * l, hx, hy),
    poly([[hx - Math.cos(a - 0.5) * h, hy - Math.sin(a - 0.5) * h], [hx, hy], [hx - Math.cos(a + 0.5) * h, hy - Math.sin(a + 0.5) * h]])], 0, 0.5, 0.5);
}

function plus(r) {
  const a = r.range(-0.2, 0.2), cx = 0.5 + r.range(-0.08, 0.08), cy = 0.5 + r.range(-0.12, 0.12);
  return rotateAbout([line(0.1, cy, 0.9, cy), line(cx, 0.1, cx, 0.9)], a, 0.5, 0.5);
}

function cross(r) {
  return rotateAbout([line(0.1, 0.1, 0.9, 0.9), line(0.9, 0.1, 0.1, 0.9)], r.range(-0.25, 0.25), 0.5, 0.5);
}

function check(r) {
  return rotateAbout([poly([[0.1, 0.55], [0.38, 0.85], [0.92, 0.12]])], r.range(-0.3, 0.3), 0.5, 0.5);
}

function lineNeg(r) {
  const a = r.range(0, PI);
  return [line(0.5 - Math.cos(a) * 0.5, 0.5 - Math.sin(a) * 0.5, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5)];
}

function arcNeg(r) { // 一道弧：C 形、拱形、碗形
  const a0 = r.range(0, 2 * PI);
  return [arc(0.5, 0.5, 0.45, r.range(0.25, 0.45), a0, a0 + r.range(1.6, 4.4))];
}

function sCurve(r) {
  return rotateAbout([curve([[0.75, 0.1], [0.3, 0.15], [0.3, 0.45], [0.7, 0.55], [0.7, 0.85], [0.25, 0.9]])], r.range(-0.4, 0.4), 0.5, 0.5);
}

const GLYPHS = {
  Z: () => [poly([[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]])],
  N: () => [poly([[0.15, 0.9], [0.15, 0.1], [0.85, 0.9], [0.85, 0.1]])],
  2: () => [curve([[0.15, 0.3], [0.5, 0.08], [0.82, 0.3], [0.15, 0.92], [0.88, 0.92]], { corners: [3] })],
  3: () => [curve([[0.15, 0.15], [0.7, 0.1], [0.75, 0.38], [0.4, 0.5], [0.8, 0.65], [0.7, 0.9], [0.15, 0.85]], { corners: [3] })],
  8: () => [curve([[0.5, 0.5], [0.8, 0.28], [0.5, 0.05], [0.2, 0.28], [0.5, 0.5], [0.85, 0.75], [0.5, 0.95], [0.15, 0.75], [0.5, 0.5]])],
  L: () => [poly([[0.2, 0.05], [0.2, 0.92], [0.85, 0.92]])],
  U: () => [curve([[0.15, 0.08], [0.15, 0.7], [0.5, 0.95], [0.85, 0.7], [0.85, 0.08]])],
  V: () => [poly([[0.1, 0.1], [0.5, 0.92], [0.9, 0.1]])],
  T: () => [line(0.1, 0.1, 0.9, 0.1), line(0.5, 0.1, 0.5, 0.95)],
};
function glyph(r) { return rotateAbout(r.pick(Object.values(GLYPHS))(r), r.range(-0.2, 0.2), 0.5, 0.5); }

function stickman(r) {
  const hy = r.range(0.12, 0.18), hr = r.range(0.08, 0.12);
  const S = [arc(0.5, hy, hr, hr, 0, 2 * PI), line(0.5, hy + hr, 0.5, 0.62)];
  const ay = r.range(0.32, 0.42);
  if (r.chance(0.5)) S.push(line(0.25, ay + r.range(-0.1, 0.1), 0.75, ay + r.range(-0.1, 0.1)));
  else S.push(line(0.5, ay, 0.25, ay + r.range(-0.15, 0.15)), line(0.5, ay, 0.75, ay + r.range(-0.15, 0.15)));
  S.push(poly([[0.32, 0.95], [0.5, 0.62], [0.68, 0.95]]));
  return S;
}

function bolt(r) {
  return rotateAbout([poly([[0.6, 0.02], [0.3, 0.5], [0.62, 0.48], [0.38, 0.98]])], r.range(-0.3, 0.3), 0.5, 0.5);
}

function star(r) {
  const a0 = -PI / 2 + r.range(-0.3, 0.3), P = [];
  for (let i = 0; i < 5; i++) { const a = a0 + i * 4 * PI / 5; P.push([0.5 + Math.cos(a) * 0.47, 0.5 + Math.sin(a) * 0.47]); }
  return [poly(P, true)];
}

function smiley(r) {
  return [arc(0.5, 0.5, 0.45, 0.45, 0, 2 * PI), [{ x: 0.35, y: 0.38 }], [{ x: 0.65, y: 0.38 }], arc(0.5, 0.52, 0.22, 0.18, 0.3, PI - 0.3)];
}

function polygon(r) {
  const n = 4 + r.int(4), P = [];
  for (let i = 0; i < n; i++) P.push([r.range(0, 1), r.range(0, 1)]);
  return [poly(P, r.chance(0.5))];
}

// 杂笔：两到六个随手的部件（直线、弧、小圈、点、折线、波浪）随便摆在一起
function composite(r) {
  const S = [], n = 2 + r.int(5);
  for (let i = 0; i < n; i++) {
    const x = r.range(0.1, 0.9), y = r.range(0.1, 0.9), s = r.range(0.08, 0.4), a = r.range(0, 2 * PI);
    const kind = r.int(6);
    if (kind === 0) S.push(line(x - Math.cos(a) * s, y - Math.sin(a) * s, x + Math.cos(a) * s, y + Math.sin(a) * s));
    else if (kind === 1) S.push(arc(x, y, s, s * r.range(0.5, 1), a, a + r.range(1, 4.5)));
    else if (kind === 2) { const q = s * 0.5; S.push(arc(x, y, q, q * r.range(0.7, 1.2), a, a + 2 * PI)); }
    else if (kind === 3) S.push([{ x, y }]);
    else if (kind === 4) { const P = []; for (let k = 0; k < 4; k++) P.push([x + r.range(-s, s), y + r.range(-s, s)]); S.push(poly(P)); }
    else S.push(rotateAbout([wave(x - s, x + s, y, s * 0.25, r.range(0.8, 2))], a, x, y)[0]);
  }
  return S;
}

function grid(r) {
  const a = r.range(-0.3, 0.3);
  return rotateAbout([line(0.1, 0.35, 0.9, 0.35), line(0.1, 0.65, 0.9, 0.65), line(0.35, 0.1, 0.35, 0.9), line(0.65, 0.1, 0.65, 0.9)], a, 0.5, 0.5);
}

// ---- 只在评测里出现的 ----

const HANZI_STROKES = [
  (x, y, s, r) => line(x - s, y, x + s, y + r.range(-0.04, 0.02)),                  // 横
  (x, y, s, r) => line(x, y - s, x + r.range(-0.03, 0.03), y + s),                  // 竖
  (x, y, s) => curve([[x + s * 0.3, y - s], [x, y], [x - s, y + s]]),               // 撇
  (x, y, s) => curve([[x - s * 0.6, y - s], [x, y], [x + s, y + s * 0.9]]),         // 捺
  (x, y, s) => line(x - s * 0.15, y - s * 0.15, x + s * 0.15, y + s * 0.15),        // 点
  (x, y, s) => poly([[x - s, y - s * 0.8], [x + s, y - s * 0.8], [x + s * 0.9, y + s]]), // 横折
  (x, y, s) => poly([[x, y - s], [x, y + s], [x + s * 0.8, y + s * 0.7]]),          // 竖提
];
function hanzi(r) {
  const n = 3 + r.int(5), S = [];
  for (let i = 0; i < n; i++) S.push(r.pick(HANZI_STROKES)(r.range(0.2, 0.8), r.range(0.2, 0.8), r.range(0.15, 0.4), r));
  return S;
}

const LATIN = {
  A: () => [poly([[0.1, 0.95], [0.5, 0.05], [0.9, 0.95]]), line(0.28, 0.6, 0.72, 0.6)],
  B: () => [line(0.2, 0.05, 0.2, 0.95), curve([[0.2, 0.05], [0.7, 0.1], [0.7, 0.42], [0.2, 0.5], [0.8, 0.6], [0.75, 0.92], [0.2, 0.95]], { corners: [3] })],
  E: () => [poly([[0.85, 0.05], [0.2, 0.05], [0.2, 0.95], [0.85, 0.95]]), line(0.2, 0.5, 0.7, 0.5)],
  F: () => [poly([[0.85, 0.05], [0.2, 0.05], [0.2, 0.95]]), line(0.2, 0.48, 0.7, 0.48)],
  H: () => [line(0.2, 0.05, 0.2, 0.95), line(0.8, 0.05, 0.8, 0.95), line(0.2, 0.5, 0.8, 0.5)],
  K: () => [line(0.2, 0.05, 0.2, 0.95), poly([[0.8, 0.05], [0.22, 0.55], [0.82, 0.95]])],
  P: () => [line(0.2, 0.05, 0.2, 0.95), curve([[0.2, 0.05], [0.75, 0.12], [0.75, 0.42], [0.2, 0.5]])],
  R: () => [line(0.2, 0.05, 0.2, 0.95), curve([[0.2, 0.05], [0.75, 0.12], [0.75, 0.42], [0.2, 0.5], [0.8, 0.95]], { corners: [3] })],
};
function latin(r) { return rotateAbout(r.pick(Object.values(LATIN))(r), r.range(-0.2, 0.2), 0.5, 0.5); }

function fish(r) {
  return [curve([[0.15, 0.5], [0.45, 0.25], [0.75, 0.42], [0.95, 0.25], [0.9, 0.5], [0.95, 0.75], [0.75, 0.58], [0.45, 0.75], [0.15, 0.5]], { corners: [3, 5] }), [{ x: 0.3, y: 0.46 }]];
}
function boat(r) {
  return [poly([[0.05, 0.6], [0.95, 0.6], [0.78, 0.85], [0.22, 0.85]], true), line(0.5, 0.6, 0.5, 0.08), poly([[0.5, 0.1], [0.85, 0.5], [0.5, 0.5]])];
}
function key(r) {
  return rotateAbout([arc(0.25, 0.5, 0.17, 0.17, 0, 2 * PI), poly([[0.42, 0.5], [0.95, 0.5], [0.95, 0.65]]), line(0.8, 0.5, 0.8, 0.62)], r.range(-0.6, 0.6), 0.5, 0.5);
}
function cup(r) {
  return [poly([[0.2, 0.15], [0.28, 0.9], [0.68, 0.9], [0.76, 0.15]]), curve([[0.74, 0.3], [0.95, 0.35], [0.92, 0.6], [0.7, 0.65]])];
}
function bird(r) {
  const S = [], n = 1 + r.int(3);
  for (let i = 0; i < n; i++) {
    const x = r.range(0.2, 0.8), y = r.range(0.2, 0.8), s = r.range(0.12, 0.25);
    S.push(curve([[x - s, y], [x - s / 2, y - s * 0.45], [x, y], [x + s / 2, y - s * 0.45], [x + s, y]], { corners: [2] }));
  }
  return S;
}
function umbrella(r) {
  return [arc(0.5, 0.45, 0.45, 0.38, PI, 2 * PI), line(0.05, 0.45, 0.95, 0.45), curve([[0.5, 0.45], [0.5, 0.85], [0.42, 0.95], [0.35, 0.88]])];
}
function scratch(r) { // 急转弯的折线
  const S = [], n = 1 + r.int(2);
  for (let k = 0; k < n; k++) {
    const P = [], m = 4 + r.int(7);
    for (let i = 0; i < m; i++) P.push([r.range(0, 1), r.range(0, 1)]);
    S.push(poly(P));
  }
  return S;
}
function eye(r) {
  return [curve([[0.05, 0.5], [0.5, 0.2], [0.95, 0.5], [0.5, 0.8], [0.05, 0.5]], { corners: [0, 2, 4] }), arc(0.5, 0.5, 0.14, 0.14, 0, 2 * PI)];
}

export const NEG_TRAIN = [
  ['scribble', 3, scribble], ['zigzag', 1, zigzagV], ['saw', 0.8, sawtooth], ['spiral', 1, spiral], ['hatch', 1.5, hatch],
  ['square', 1, square], ['triangle', 1, triangle], ['circle', 1.2, circle], ['rings', 0.6, rings], ['house', 1, house],
  ['heart', 1, heart], ['arrow', 1, arrow], ['plus', 1, plus], ['cross', 1, cross], ['check', 0.7, check],
  ['line', 1.2, lineNeg], ['arc', 1, arcNeg], ['scurve', 0.7, sCurve], ['glyph', 1.5, glyph], ['stickman', 1.2, stickman],
  ['bolt', 0.8, bolt], ['star', 0.8, star], ['smiley', 0.8, smiley], ['polygon', 1, polygon], ['grid', 0.6, grid], ['composite', 3, composite],
];

export const NEG_HELD = [
  ['hanzi', 3, hanzi], ['latin', 2, latin], ['fish', 1, fish], ['boat', 1, boat], ['key', 1, key],
  ['cup', 1, cup], ['bird', 1, bird], ['umbrella', 1, umbrella], ['scratch', 2, scratch], ['eye', 1, eye],
];

// 返回 { name, strokes }：name 为哪一种乱画
export function negativeNamed(r, family = 'train') {
  const list = family === 'held' ? NEG_HELD : NEG_TRAIN;
  const [name, , make] = r.weighted(list.map(e => [e[1], e]));
  return { name, strokes: fit(make(r).filter(s => s.length), 0, 0, 1, 1) };
}
export const negative = (r, family = 'train') => negativeNamed(r, family).strokes;
