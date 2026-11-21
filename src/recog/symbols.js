// 第一代十个墨笔神符：名词象形，动词由「画在什么上面」决定（见 CONTEXTS）。
// 每个符的 make(r) 用随机源 r 画出一份写法（单位框约 0..1，y 向下）；
// 用 midRng() 画出的是手册里的标准写法，用 makeRng() 画出的是各种合理的变体。
// 设计原则：同场出现的任意两个符，至少在两项粗特征上不同（笔数、圈数、主方向、交叉、曲直、高扁）。

import { line, poly, arc, curve, wave, fit, rotateAbout, mirrorX } from './geom.js';
import { midRng } from './rng.js';

const PI = Math.PI;

// 点：点一下（单点），或一小笔
function dot(x, y, r) {
  if (r.chance(0.4)) return [{ x, y }];
  const a = r.range(0, 2 * PI), l = r.range(0.015, 0.045);
  return line(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 2, x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2);
}

// 日：一个圆，中间一点
function makeRi(r) {
  const rx = r.range(0.38, 0.46), ry = rx * r.range(0.88, 1.12);
  const a0 = r.range(-PI, PI), sweep = 2 * PI * r.range(0.95, 1.07) * (r.chance(0.5) ? -1 : 1);
  const S = [];
  if (r.chance(0.1)) { // 两笔画圆
    const k = r.range(0.4, 0.6);
    S.push(arc(0.5, 0.5, rx, ry, a0, a0 + sweep * (k + 0.03)), arc(0.5, 0.5, rx, ry, a0 + sweep * k, a0 + sweep));
  } else S.push(arc(0.5, 0.5, rx, ry, a0, a0 + sweep));
  S.push(dot(0.5 + r.range(-0.07, 0.07), 0.5 + r.range(-0.07, 0.07), r));
  return S;
}

// 月：两圆相减的月牙，一笔画回原处（偶尔两笔）；可斜、可朝左右
function makeYue(r) {
  const r2 = r.range(0.86, 1.0), d = r.range(0.3, 0.56);
  const xi = (d * d + 1 - r2 * r2) / (2 * d), yi = Math.sqrt(Math.max(0, 1 - xi * xi));
  const outer = arc(0, 0, 1, 1, Math.atan2(-yi, xi), Math.atan2(yi, xi) - 2 * PI); // 上尖 → 左 → 下尖
  const inner = arc(d, 0, r2, r2, Math.atan2(yi, xi - d), Math.atan2(-yi, xi - d) + 2 * PI); // 下尖 → 内弧 → 上尖
  let S = r.chance(0.2) ? [outer, inner] : [outer.concat(inner.slice(1))];
  S = rotateAbout(S, r.range(-0.4, 0.4), 0, 0);
  S = fit(S, 0.05, 0.05, 0.95, 0.95);
  return r.chance(0.4) ? mirrorX(S) : S;
}

// 雨：上面一道拱弧（云），下面三点雨（偶尔四点），雨点平行、可斜
function makeYu(r) {
  const S = [];
  const x0 = r.range(0.04, 0.12), x1 = r.range(0.88, 0.96), base = r.range(0.32, 0.4), top = r.range(0.04, 0.14);
  if (r.chance(0.3)) { // 两三个鼓包的云线
    const k = r.chance(0.5) ? 3 : 2, pts = [[x0, base]], corners = [0];
    for (let i = 0; i < k; i++) {
      const a = x0 + (x1 - x0) * (i + 0.5) / k, b = x0 + (x1 - x0) * (i + 1) / k;
      pts.push([a, top + r.range(-0.03, 0.05)]);
      pts.push([b, i === k - 1 ? base : base - r.range(0.06, 0.12)]);
      corners.push(pts.length - 1);
    }
    S.push(curve(pts, { corners }));
  } else {
    S.push(arc((x0 + x1) / 2, base, (x1 - x0) / 2, base - top, PI, 2 * PI));
  }
  const n = r.chance(0.15) ? 4 : 3, slant = r.range(-0.35, 0.35), len = r.range(0.2, 0.32);
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.1 + (x1 - x0 - 0.2) * i / (n - 1) + r.range(-0.03, 0.03);
    const y = base + r.range(0.1, 0.15) + (i % 2) * r.range(0, 0.08);
    S.push(line(x, y, x + Math.sin(slant) * len, y + Math.cos(slant) * len));
  }
  return S;
}

// 火：一笔画出三条火舌，中间最高，底下圆着收口
function makeHuo(r) {
  const lean = r.range(-0.07, 0.07), w = r.range(0.3, 0.38), B = r.range(0.93, 0.98);
  const midH = r.range(0.02, 0.1), sideL = r.range(0.26, 0.42), sideR = sideL + r.range(-0.06, 0.06);
  const vL = r.range(0.5, 0.6), vR = r.range(0.5, 0.6);
  const P = [
    [0.5, B],
    [0.5 - w * 0.95, B - 0.16],
    [0.5 - w * 1.08 + lean * 0.3, (sideL + B) / 2 - 0.04],
    [0.5 - w * 0.78 + lean, sideL],                             // 左舌尖
    [0.5 - w * 0.6 + lean * 0.8, sideL + (vL - sideL) * 0.62],
    [0.5 - w * 0.3 + lean * 0.6, vL],                           // 左谷
    [0.5 - w * 0.36 + lean * 0.9, (vL + midH) / 2 + 0.02],
    [0.5 + lean * 1.3, midH],                                   // 中舌尖
    [0.5 + w * 0.36 + lean * 0.9, (vR + midH) / 2 + 0.02],
    [0.5 + w * 0.3 + lean * 0.6, vR],                           // 右谷
    [0.5 + w * 0.6 + lean * 0.8, sideR + (vR - sideR) * 0.62],
    [0.5 + w * 0.78 + lean, sideR],                             // 右舌尖
    [0.5 + w * 1.08 + lean * 0.3, (sideR + B) / 2 - 0.04],
    [0.5 + w * 0.95, B - 0.16],
  ];
  const S = [curve(P, { closed: true, corners: [3, 5, 7, 9, 11] })];
  if (r.chance(0.2)) { // 里面再一小簇火苗
    const h = r.range(0.45, 0.6);
    S.push(curve([[0.5 - 0.1, B - 0.08], [0.5 - 0.12, (h + B) / 2], [0.5 + lean, h], [0.5 + 0.12, (h + B) / 2], [0.5 + 0.1, B - 0.08]], { corners: [2] }));
  }
  return S;
}

// 水：三道横着的波浪（偶尔两道），彼此相像
function makeShui(r) {
  const n = r.chance(0.12) ? 2 : 3;
  const gap = r.range(0.24, 0.32), amp = r.range(0.06, 0.1), per = r.range(1.4, 2.4), ph = r.range(0, 2 * PI);
  const S = [];
  for (let i = 0; i < n; i++) {
    const y = 0.5 + (i - (n - 1) / 2) * gap;
    S.push(wave(r.range(0.02, 0.1), r.range(0.9, 0.98), y, amp * r.range(0.85, 1.15), per * r.range(0.92, 1.08), ph + r.range(-0.3, 0.3)));
  }
  return rotateAbout(S, r.range(-0.08, 0.08), 0.5, 0.5);
}

// 山：一笔折线，两个山头（一大一小）或三个山头（中间最高），底下不封口
function makeShan(r) {
  let P;
  if (r.chance(0.35)) {
    P = [[0, 0.88], [0.18, r.range(0.32, 0.5)], [0.34, r.range(0.55, 0.7)], [0.5, r.range(0.04, 0.16)],
      [0.66, r.range(0.52, 0.68)], [0.82, r.range(0.3, 0.5)], [1, 0.88]];
  } else {
    P = [[0, 0.88], [0.32, r.range(0.06, 0.2)], [0.55, r.range(0.55, 0.7)], [0.73, r.range(0.34, 0.5)], [1, 0.88]];
    if (r.chance(0.5)) P = P.map(([x, y]) => [1 - x, y]).reverse(); // 大山头在右
  }
  P = P.map(([x, y], i) => [i === 0 || i === P.length - 1 ? x : x + r.range(-0.04, 0.04), y]);
  return [poly(P)];
}

// 树：一根树干，顶上一团树冠（椭圆或云团）
function makeShu(r) {
  const S = [];
  const cx = 0.5 + r.range(-0.03, 0.03), cy = r.range(0.27, 0.34), rx = r.range(0.28, 0.38), ry = r.range(0.21, 0.29);
  if (r.chance(0.45)) {
    const a0 = PI / 2 + r.range(-0.4, 0.4);
    S.push(arc(cx, cy, rx, ry, a0, a0 + 2 * PI * r.range(0.95, 1.06) * (r.chance(0.5) ? -1 : 1)));
  } else {
    const k = r.pick([5, 4, 6]), pts = [], corners = [], a0 = PI / 2 + r.range(-0.3, 0.3);
    for (let i = 0; i < k; i++) {
      const a = a0 + (i / k) * 2 * PI, ab = a + PI / k;
      pts.push([cx + Math.cos(a) * rx * 0.84, cy + Math.sin(a) * ry * 0.84]); corners.push(pts.length - 1);
      pts.push([cx + Math.cos(ab) * rx * 1.1, cy + Math.sin(ab) * ry * 1.1]);
    }
    S.push(curve(pts, { closed: true, corners }));
  }
  const tx = cx + r.range(-0.03, 0.03), ty0 = cy + ry - r.range(0, 0.06), ty1 = r.range(0.92, 0.99);
  if (r.chance(0.2)) {
    const hw = r.range(0.04, 0.07);
    S.push(line(tx - hw, ty0, tx - hw, ty1), line(tx + hw, ty0, tx + hw, ty1));
  } else S.push(line(tx, ty0, tx + r.range(-0.03, 0.03), ty1));
  return S;
}

// 剑：一道长刃（一笔竖，或带尖的刃身），靠下一道护手
function makeJian(r) {
  const S = [], x = 0.5, gy = r.range(0.66, 0.78), g = r.range(0.17, 0.28), tilt = r.range(-0.08, 0.08);
  if (r.chance(0.3)) {
    const hw = r.range(0.04, 0.07);
    S.push(poly([[x - hw, gy - 0.02], [x - hw, 0.12], [x, 0], [x + hw, 0.12], [x + hw, gy - 0.02]]));
    S.push(line(x, gy + 0.02, x, r.range(0.92, 1)));
  } else S.push(line(x, r.range(0, 0.04), x + r.range(-0.02, 0.02), r.range(0.92, 1)));
  S.push(line(x - g, gy + tilt * g, x + g, gy - tilt * g));
  if (r.chance(0.1)) S.push(dot(x, 1.03, r));
  return S;
}

// 旗：一根旗杆，顶上一面旗（三角、方或飘带），旗多在右
function makeQi(r) {
  const px = r.range(0.25, 0.32), top = r.range(0, 0.05), fw = r.range(0.45, 0.62), fh = r.range(0.3, 0.42);
  let S = [line(px, r.range(0.94, 1), px + r.range(-0.02, 0.02), top)];
  const v = r();
  if (v < 0.6) S.push(poly([[px, top], [px + fw, top + fh / 2 + r.range(-0.05, 0.05)], [px, top + fh]]));
  else if (v < 0.85) S.push(poly([[px, top], [px + fw, top + r.range(-0.03, 0.03)], [px + fw, top + fh], [px, top + fh]]));
  else {
    const a = r.range(0.025, 0.045);
    const upper = wave(px, px + fw, top, a, 1, 0);
    const lower = wave(px + fw, px, top + fh, a, 1, PI);
    S.push([...upper, ...line(px + fw, upper[upper.length - 1].y, px + fw, lower[0].y).slice(1, -1), ...lower]);
  }
  if (r.chance(0.15)) S = mirrorX(S);
  return S;
}

// 光：三四道直线交于一点，向四面放光
function makeGuang(r) {
  const n = r.chance(0.5) ? 4 : 3, base = r.range(0, PI / n), S = [];
  for (let i = 0; i < n; i++) {
    const a = base + i * PI / n + r.range(-0.12, 0.12);
    const l1 = r.range(0.36, 0.48), l2 = r.range(0.36, 0.48), ox = r.range(-0.035, 0.035), oy = r.range(-0.035, 0.035);
    S.push(line(0.5 + ox - Math.cos(a) * l1, 0.5 + oy - Math.sin(a) * l1, 0.5 + ox + Math.cos(a) * l2, 0.5 + oy + Math.sin(a) * l2));
  }
  return S;
}

export const SYMBOLS = [
  { id: 'ri', name: '日', hint: '一个圆，中间点一点', make: makeRi },
  { id: 'yue', name: '月', hint: '一弯月牙，一笔画回起点', make: makeYue },
  { id: 'yu', name: '雨', hint: '上面一道弧，下面三点雨', make: makeYu },
  { id: 'huo', name: '火', hint: '一笔画三条火舌，中间最高', make: makeHuo },
  { id: 'shui', name: '水', hint: '三道横着的波浪', make: makeShui },
  { id: 'shan', name: '山', hint: '一笔折线，两三个山头', make: makeShan },
  { id: 'shu', name: '树', hint: '一根树干，顶上一团树冠', make: makeShu },
  { id: 'jian', name: '剑', hint: '一道长刃，靠下一道护手', make: makeJian },
  { id: 'qi', name: '旗', hint: '一根旗杆，顶上挂一面旗', make: makeQi },
  { id: 'guang', name: '光', hint: '三四道直线交于一点', make: makeGuang },
];

export const NEG = SYMBOLS.length;              // 第 11 类：乱画（不是任何符）
export const CLASS_IDS = [...SYMBOLS.map(s => s.id), 'neg'];
export const CLASS_NAMES = [...SYMBOLS.map(s => s.name), '乱'];
export const NUM_CLASSES = CLASS_IDS.length;
export const classIndex = id => CLASS_IDS.indexOf(id);
export const symbolById = id => SYMBOLS.find(s => s.id === id);

// 手册里的标准写法（每个参数取正中）
export const canonical = id => symbolById(id).make(midRng());

// 第一代的「画在什么上面」：每个目标只开放几个符，动词跟着目标走。
// ink 为墨价；confirm 为收不回来、要再点一下确认的。
export const CONTEXTS = [
  { id: 'all', name: '不限', note: '实验室用：十符全开', verbs: null },
  { id: 'sky', name: '天', verbs: { yu: { verb: '降雨', ink: 4 }, ri: { verb: '放晴', ink: 3 }, yue: { verb: '入夜', ink: 2 }, huo: { verb: '雷火', ink: 6, confirm: true } } },
  { id: 'folk', name: '族人', verbs: { qi: { verb: '集结', ink: 1 }, guang: { verb: '降下圣光', ink: 5 }, yue: { verb: '歇息', ink: 1 }, huo: { verb: '传火', ink: 2 }, jian: { verb: '操练', ink: 2 }, shu: { verb: '去采集', ink: 1 } } },
  { id: 'wood', name: '树林', verbs: { jian: { verb: '砍伐', ink: 1 }, shu: { verb: '采集', ink: 1 }, huo: { verb: '烧荒', ink: 3, confirm: true }, qi: { verb: '集结', ink: 1 } } },
  { id: 'rock', name: '石堆', verbs: { jian: { verb: '采石', ink: 1 }, shan: { verb: '垒石', ink: 2 }, qi: { verb: '集结', ink: 1 } } },
  { id: 'beast', name: '兽', verbs: { jian: { verb: '狩猎', ink: 2 }, huo: { verb: '驱兽', ink: 2 }, qi: { verb: '围猎', ink: 3 } } },
  { id: 'river', name: '河', verbs: { shui: { verb: '取水', ink: 1 }, shan: { verb: '筑堤', ink: 3 }, jian: { verb: '叉鱼', ink: 1 }, qi: { verb: '集结', ink: 1 } } },
  { id: 'land', name: '空地', verbs: { shu: { verb: '栽树', ink: 2 }, qi: { verb: '立营', ink: 2 }, shui: { verb: '掘井', ink: 3 }, shan: { verb: '垒石', ink: 2 }, huo: { verb: '生火', ink: 2 } } },
  { id: 'band', name: '外族', verbs: { huo: { verb: '送火', ink: 2 }, qi: { verb: '结亲', ink: 5 }, jian: { verb: '驱赶', ink: 2 }, guang: { verb: '显灵', ink: 5 } } },
  { id: 'field', name: '农田', verbs: { shu: { verb: '播种', ink: 1 }, jian: { verb: '收割', ink: 1 }, shui: { verb: '浇灌', ink: 2 }, huo: { verb: '驱虫', ink: 2 }, guang: { verb: '不季之穗', ink: 6 } } },
  { id: 'village', name: '邻村', verbs: { qi: { verb: '换物', ink: 2 }, shui: { verb: '议水', ink: 2 }, jian: { verb: '破坝', ink: 3 }, guang: { verb: '显灵', ink: 5 } } },
];
export const contextById = id => CONTEXTS.find(c => c.id === id) || CONTEXTS[0];
export const candidatesOf = ctx => (ctx && ctx.verbs ? Object.keys(ctx.verbs) : SYMBOLS.map(s => s.id));
