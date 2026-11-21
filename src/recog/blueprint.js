// 铅笔图纸：目标先选好，再照提示一部分一部分画。不做分类，只量这部分画得多高、多直、接没接上。
// 数值跟着画走，但上下都有限：画歪了不会废掉，画得好有奖励。
// 坐标：图纸宽 1、高 0.7，y 向下。

import { length, bbox, pca, straightness, flat, distToPolyline, crossings, line, poly, curve, arc } from './geom.js';
import { cloud, match } from './pcloud.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const deg = r => r * 180 / Math.PI;
const longest = (S, k) => [...S].sort((a, b) => length(b) - length(a)).slice(0, k);
const ends = s => { // 上端、下端
  const a = s[0], b = s[s.length - 1];
  return a.y <= b.y ? { top: a, bot: b } : { top: b, bot: a };
};
// 两条无限长直线的交点
function meet(p1, p2, p3, p4) {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;
  const a = p1.x * p2.y - p1.y * p2.x, b = p3.x * p4.y - p3.y * p4.x;
  return { x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d, y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d };
}
// 横不横：与水平线的夹角（度）
const tilt = s => { const e = s[s.length - 1], o = s[0]; return Math.abs(deg(Math.atan2(e.y - o.y, Math.abs(e.x - o.x) || 1e-9))); };
// 与竖直方向的夹角（度）
const lean = s => { const { top, bot } = ends(s); return deg(Math.atan2(Math.abs(top.x - bot.x), Math.abs(bot.y - top.y) || 1e-9)); };
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const avg = A => A.reduce((s, x) => s + x, 0) / (A.length || 1);
const sdev = A => { const m = avg(A); return Math.sqrt(avg(A.map(x => (x - m) ** 2))); };
const bar = (x, lo = 0.35) => clamp(lo + (1 - lo) * x, lo, 1);
// 竖着的笔画按横向位置归堆：断成两截的一根柱子还算一根
function columns(S, maxLean = 22, minLen = 0.05) {
  const v = S.filter(s => length(s) > minLen * 0.5 && lean(s) < maxLean).map(s => ({ s, b: bbox([s]) })).sort((a, b) => a.b.cx - b.b.cx);
  const out = [];
  for (const it of v) {
    const g = out.at(-1);
    if (g && Math.abs(it.b.cx - g.cx) < 0.03) { g.lines.push(it.s); g.b = bbox(g.lines); g.cx = g.b.cx; }
    else out.push({ lines: [it.s], b: it.b, cx: it.b.cx });
  }
  return out.filter(g => g.b.h > minLen);
}

// ---------------- 窝棚（第一代） ----------------

function fitFrame(S) {
  S = S.filter(s => length(s) > 0.04);
  let A, B;
  if (S.length >= 2) [A, B] = longest(S, 2);
  else if (S.length === 1) { // 一笔「人」字：在最高点劈开
    const s = S[0];
    let k = 0;
    s.forEach((p, i) => { if (p.y < s[k].y) k = i; });
    if (k < 3 || k > s.length - 4) return { ok: false, msg: '画两根斜木，在顶上交成「人」字' };
    A = s.slice(0, k + 1); B = s.slice(k);
  } else return { ok: false, msg: '画两根斜木，在顶上交成「人」字' };
  const ea = ends(A), eb = ends(B);
  const [L, R] = ea.bot.x <= eb.bot.x ? [{ s: A, ...ea }, { s: B, ...eb }] : [{ s: B, ...eb }, { s: A, ...ea }];
  const la = lean(L.s), lb = lean(R.s);
  const inward = L.top.x > L.bot.x && R.top.x < R.bot.x;
  if (!inward || la < 6 || lb < 6 || la > 78 || lb > 78) return { ok: false, msg: '两根木头要斜着往中间靠，顶上交在一起' };
  const apex = meet(L.top, L.bot, R.top, R.bot) || { x: (L.top.x + R.top.x) / 2, y: Math.min(L.top.y, R.top.y) };
  const gap = Math.hypot(L.top.x - R.top.x, L.top.y - R.top.y);
  const width = R.bot.x - L.bot.x, footY = (L.bot.y + R.bot.y) / 2, height = footY - apex.y;
  if (width < 0.08 || height < 0.06) return { ok: false, msg: '窝棚太小了，画大一点' };
  return {
    ok: true, msg: gap < 0.04 ? '斜木交上了' : '顶上没交上，会漏风',
    v: { width, height, apex, footL: L.bot, footR: R.bot, footY, gap, joined: gap < 0.04, straight: (straightness(L.s) + straightness(R.s)) / 2, sym: Math.abs(la - lb), lines: [L.s, R.s] },
  };
}

function fitGround(S, parts) {
  const f = parts.frame.v;
  const s = longest(S.filter(x => length(x) > 0.04), 1)[0];
  if (!s) return { ok: false, msg: '在两根斜木底下画一道地面' };
  const b = bbox([s]);
  if (tilt(s) > 18) return { ok: false, msg: '地面要横着画' };
  if (Math.abs(b.cy - f.footY) > 0.09) return { ok: false, msg: '地面要画在斜木脚下' };
  const cover = overlap(b.x0, b.x1, f.footL.x, f.footR.x) / f.width;
  const off = (distToPolyline(f.footL, s) + distToPolyline(f.footR, s)) / 2;
  return { ok: true, msg: cover > 0.9 ? '地面托住了两根木头' : '地面没铺满两脚之间', v: { cover, off, flat: 1 - tilt(s) / 18, y: b.cy, s } };
}

function fitDoor(S, parts) {
  const f = parts.frame.v, g = parts.ground.v;
  S = S.filter(x => length(x) > 0.015);
  if (!S.length) return { ok: false, msg: '在中间开一扇门' };
  const b = bbox(S);
  if (b.cx < f.footL.x || b.cx > f.footR.x) return { ok: false, msg: '门要开在两根斜木之间' };
  if (Math.abs(b.y1 - g.y) > 0.07) return { ok: false, msg: '门要落在地面上' };
  const wr = b.w / f.width, hr = b.h / f.height;
  if (hr > 0.95) return { ok: false, msg: '门比窝棚还高了' };
  return { ok: true, msg: wr < 0.45 ? '门不大，挡风' : '门开得大，进出方便但漏风', v: { wr, hr, center: Math.abs(b.cx - (f.footL.x + f.footR.x) / 2) / f.width } };
}

function fitThatch(S, parts) {
  const [L, R] = parts.frame.v.lines;
  const n = S.filter(s => length(s) > 0.025 && length(s) < 0.4).filter(s => {
    const m = s[s.length >> 1];
    return Math.min(distToPolyline(m, L), distToPolyline(m, R)) < 0.07;
  }).length;
  return { ok: true, msg: n ? `铺了 ${n} 道草` : '没铺草：冬天冷', v: { n } };
}

// 量出来的东西 → 模拟用的数值。数值有上下限：画歪了不会废掉，画得好有奖励
function shackParams(P) {
  const f = P.frame.v, g = P.ground?.v, d = P.door?.v, t = P.thatch?.v || { n: 0 };
  const pitch = deg(Math.atan2(f.height, f.width / 2));
  const q = {
    rain: clamp((pitch - 35) / 30, 0, 1),
    sturdy: f.straight * (f.joined ? 1 : 0.6) * (g ? clamp(g.cover, 0, 1) : 0.5) * clamp(1 - f.sym / 40, 0.5, 1),
    warm: clamp(0.45 + Math.min(t.n, 4) * 0.12 - (d ? Math.max(0, d.wr - 0.3) : 0.3), 0, 1),
  };
  return {
    cap: clamp(Math.round(f.width / 0.09), 2, 6),
    rainproof: +bar(q.rain).toFixed(2), sturdy: +bar(q.sturdy).toFixed(2), warmth: +bar(q.warm).toFixed(2),
    need: { wood: 2 + Math.round((length(f.lines[0]) + length(f.lines[1])) / 0.12), grass: Math.min(t.n, 6) * 2 },
    pitch, q,
  };
}
function shackStats(P) {
  const p = shackParams(P), f = P.frame.v;
  return [
    { k: '容纳', v: `${p.cap} 人`, x: clamp(f.width / 0.54, 0.2, 1), why: '地基越宽住得越多（2–6 人）' },
    { k: '防雨', v: `${Math.round(p.pitch)}°`, x: p.rainproof, why: '屋顶越陡越不漏雨（40° 以上下雨不湿）' },
    { k: '稳固', v: '', x: p.sturdy, why: '木头直、顶上交上、地面托住、两边对称；不稳的棚子饿狼扒得开' },
    { k: '保暖', v: '', x: p.warmth, why: '门小、草铺得多更暖' },
    { k: '用料', v: `木 ${p.need.wood} · 草 ${p.need.grass}`, x: null, why: '木头越长越费，铺一道草要 2 份草' },
  ];
}

// ---------------- 火塘（第一代） ----------------
// 石圈：一圈（几笔凑成一圈也行）。量围得全不全、圆不圆、多大
function fitRing(S) {
  S = S.filter(s => length(s) > 0.03);
  if (!S.length) return { ok: false, msg: '先用石头围一个圈' };
  const P = flat(S), b = bbox(S);
  if (b.w < 0.12 || b.h < 0.03) return { ok: false, msg: '石圈太小了，画大一点' };
  const rx = b.w / 2, ry = b.h / 2, hit = new Array(24).fill(false), R = [];
  for (const p of P) {
    const dx = (p.x - b.cx) / rx, dy = (p.y - b.cy) / ry;
    hit[Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 24) % 24] = true;
    R.push(Math.hypot(dx, dy));
  }
  // 缺口：各笔的端点两两就近接上，最大的那个口子占一圈多少
  const E = S.flatMap((s, i) => [{ p: s[0], i }, { p: s[s.length - 1], i }]), pairs = [];
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) pairs.push([i, j, Math.hypot(E[i].p.x - E[j].p.x, E[i].p.y - E[j].p.y)]);
  pairs.sort((a, b) => a[2] - b[2]);
  const used = new Set();
  let gap = 0;
  for (const [i, j, d] of pairs) if (!used.has(i) && !used.has(j)) { used.add(i); used.add(j); gap = Math.max(gap, d); }
  const gapFrac = gap / (S.reduce((s, x) => s + length(x), 0) || 1);
  const around = hit.filter(Boolean).length / 24;
  if (around < 0.75 || gapFrac > 0.22) return { ok: false, msg: '石圈要围成一圈，别只画半边' };
  const cover = clamp(1 - gapFrac * 4, 0, 1);
  const even = clamp(1 - sdev(R) / (avg(R) || 1) * 3, 0, 1);
  return { ok: true, msg: cover > 0.9 ? '石圈围严了' : '石圈有缺口：漏风费柴', v: { cx: b.cx, cy: b.cy, w: b.w, h: b.h, x0: b.x0, x1: b.x1, top: b.y0, bottom: b.y1, cover, even } };
}
// 柴：几根架在石圈上，交叉着或顶上碰头，堆得高抽风好
function fitWood(S, parts) {
  const g = parts.ring.v;
  const sticks = S.filter(s => length(s) > 0.05).filter(s => {
    const m = s[s.length >> 1];
    return m.x > g.x0 - 0.04 && m.x < g.x1 + 0.04 && m.y < g.bottom + 0.04 && m.y > g.top - 0.3;
  });
  if (!sticks.length) return { ok: false, msg: '在石圈里架几根柴' };
  const tips = s => [s[0], s[s.length - 1]];
  let cross = 0;
  for (let i = 0; i < sticks.length; i++) for (let j = i + 1; j < sticks.length; j++) {
    const A = sticks[i], B = sticks[j];
    const touch = tips(A).some(a => tips(B).some(c => Math.hypot(a.x - c.x, a.y - c.y) < 0.04));
    if (touch || crossings(A, B).length) cross++;
  }
  const b = bbox(sticks), n = Math.min(4, sticks.length);
  const tall = clamp((g.cy - b.y0) / 0.25, 0, 1);
  return { ok: true, msg: n >= 3 && cross >= 2 ? '柴架起来了，烧得旺' : n < 3 ? '柴少了，火不旺' : '柴没交叉，烧不透', v: { n, cross: Math.min(3, cross), tall, top: b.y0 } };
}
// 棚顶（可跳过）：火上方罩个顶
function fitCover(S, parts) {
  const g = parts.ring.v, w = parts.wood.v;
  S = S.filter(s => length(s) > 0.05);
  if (!S.length) return { ok: true, msg: '露天：下雨费柴，大雨会浇灭', v: { roof: 0 } };
  const b = bbox(S);
  if (b.y1 > w.top + 0.04) return { ok: false, msg: '棚顶要画在柴堆上方' };
  const cover = overlap(b.x0, b.x1, g.x0, g.x1) / g.w;
  if (cover < 0.4) return { ok: false, msg: '棚顶要罩住火塘' };
  return { ok: true, msg: cover > 0.8 ? '棚顶罩住了火塘' : '棚顶小了点', v: { roof: clamp(cover / 0.8, 0, 1) } };
}
function hearthParams(P) {
  const g = P.ring.v, w = P.wood?.v || { n: 0, cross: 0, tall: 0 }, c = P.cover?.v || { roof: 0 };
  const q = {
    heat: 0.5 * clamp(w.n / 3, 0, 1) + 0.3 * clamp(w.cross / 2, 0, 1) + 0.2 * w.tall,
    size: clamp((g.w - 0.15) / 0.35, 0, 1),
    seal: g.cover * (0.5 + 0.5 * g.even),
    roof: c.roof,
  };
  return {
    heat: Math.round(14 + 10 * q.heat), radius: Math.round(70 + 70 * q.size),
    burnMul: +clamp(1.05 - 0.45 * q.seal + 0.15 * q.size, 0.5, 1.2).toFixed(2),
    roof: q.roof >= 0.5, cook: 1,
    need: { stone: clamp(Math.round(g.w / 0.05), 4, 10), wood: 1 + w.n },
    q,
  };
}
function hearthStats(P) {
  const p = hearthParams(P), q = p.q, save = Math.round((1 - p.burnMul) * 100);
  return [
    { k: '火力', v: `${p.heat}°`, x: bar(q.heat), why: '柴多、交叉着架、堆得高，烧得旺（营火是 18°）' },
    { k: '暖到', v: `${p.radius} 步`, x: clamp(p.radius / 140, 0.2, 1), why: '石圈越大暖得越远，也越费柴（营火是 90 步）' },
    { k: '省柴', v: save >= 0 ? `${save}%` : `多费 ${-save}%`, x: bar(q.seal), why: '石圈围严、围圆，风吹不进' },
    { k: '挡雨', v: p.roof ? '有棚' : '露天', x: bar(q.roof), why: '有棚顶：下雨不多费柴，也不会被浇灭' },
    { k: '用料', v: `石 ${p.need.stone} · 木 ${p.need.wood}`, x: null, why: '石圈越大越费石头' },
  ];
}

// ---------------- 晾肉架（第一代） ----------------
function fitPosts(S) {
  const cols = columns(S, 20, 0.1).sort((a, b) => b.b.h - a.b.h).slice(0, 2).sort((a, b) => a.cx - b.cx);
  if (cols.length < 2) return { ok: false, msg: '画两根竖着的立柱' };
  const [A, B] = cols, span = B.cx - A.cx;
  if (span < 0.12) return { ok: false, msg: '两根立柱离远一点' };
  const level = Math.abs(A.b.y1 - B.b.y1);
  const st = g => avg(g.lines.map(straightness)), ln = g => avg(g.lines.map(lean));
  return {
    ok: true, msg: level < 0.05 ? '立柱站稳了' : '两根柱子一高一低',
    v: { x0: A.cx, x1: B.cx, span, h: (A.b.h + B.b.h) / 2, top: Math.min(A.b.y0, B.b.y0), bottom: Math.max(A.b.y1, B.b.y1), lean: (ln(A) + ln(B)) / 2, straight: (st(A) + st(B)) / 2, level },
  };
}
function fitBar(S, parts) {
  const p = parts.posts.v;
  const s = longest(S.filter(x => length(x) > 0.08), 1)[0];
  if (!s) return { ok: false, msg: '在两根立柱顶上横搭一根杆子' };
  if (tilt(s) > 15) return { ok: false, msg: '横杆要横着' };
  const b = bbox([s]);
  if (b.cy > p.top + p.h * 0.4 || b.cy < p.top - 0.08) return { ok: false, msg: '横杆要架在立柱顶上' };
  const cover = overlap(b.x0, b.x1, p.x0, p.x1) / p.span;
  if (cover < 0.6) return { ok: false, msg: '横杆要两头都搭在柱子上' };
  return { ok: true, msg: cover > 0.97 ? '横杆搭稳了' : '横杆短了，一头悬着', v: { cover: clamp(cover, 0, 1), y: b.cy, rest: Math.abs(b.cy - p.top) } };
}
function fitStrips(S, parts) {
  const p = parts.posts.v, br = parts.bar.v;
  const n = S.filter(s => length(s) > 0.025 && length(s) < 0.3).filter(s => {
    const b = bbox([s]);
    return b.cx > p.x0 && b.cx < p.x1 && Math.abs(b.y0 - br.y) < 0.06;
  }).length;
  return { ok: true, msg: n ? `挂上了 ${n} 条肉` : '没挂肉：空架子也行', v: { n } };
}
function rackParams(P) {
  const p = P.posts.v, b = P.bar?.v, st = P.strips?.v || { n: 0 };
  const q = {
    span: clamp((p.span - 0.12) / 0.4, 0, 1),
    high: clamp((p.h - 0.15) / 0.3, 0, 1),
    sturdy: p.straight * clamp(1 - p.lean / 20, 0, 1) * (b ? b.cover * clamp(1 - b.rest / 0.1, 0.3, 1) : 0.4) * clamp(1 - p.level / 0.1, 0.5, 1),
  };
  return {
    cap: clamp(Math.round(10 + 22 * q.span + 2 * Math.min(st.n, 4)), 10, 40),
    dryH: Math.round(30 - 12 * q.high),
    sturdy: +bar(q.sturdy, 0.3).toFixed(2),
    need: { wood: 1 + Math.round((2 * p.h + p.span) / 0.2) },
    q,
  };
}
function rackStats(P) {
  const p = rackParams(P), q = p.q;
  return [
    { k: '容量', v: `${p.cap} 份`, x: clamp(p.cap / 40, 0.2, 1), why: '两根柱子离得越开、挂得越多，一次晾得越多（10–40 份）' },
    { k: '晾干', v: `${Math.round(p.dryH / 2)} 个时辰`, x: bar(q.high), why: '架子越高越通风，干得越快；下雨天晾不干' },
    { k: '稳固', v: '', x: bar(q.sturdy, 0.3), why: '柱子直、立得正、横杆搭在顶上；不稳的架子遇上风雨会塌' },
    { k: '用料', v: `木 ${p.need.wood}`, x: null, why: '架子越大越费木头' },
  ];
}

// ---------------- 篱笆（第一代） ----------------
// 图纸上画一小截篱笆的样子；修在哪儿，回到地图上用铅笔画走向
function fitStakes(S) {
  const cols = columns(S, 25, 0.06);
  if (cols.length < 3) return { ok: false, msg: '画一排竖着的木桩（至少三根）' };
  const h = avg(cols.map(g => g.b.h));
  if (h < 0.08) return { ok: false, msg: '木桩太矮了' };
  const gaps = cols.slice(1).map((g, i) => g.cx - cols[i].cx), mg = avg(gaps);
  const even = clamp(1 - sdev(gaps) / mg * 2, 0, 1), level = clamp(1 - sdev(cols.map(g => g.b.y1)) / 0.04, 0, 1);
  return {
    ok: true, msg: even > 0.6 ? `${cols.length} 根桩排得匀` : '桩子疏密不匀',
    v: { n: cols.length, h, gap: mg, even, level, x0: cols[0].cx, x1: cols.at(-1).cx, tops: cols.map(g => ({ x: g.cx, y: g.b.y0 })), cols: cols.map(g => g.lines) },
  };
}
function fitRails(S, parts) {
  const k = parts.stakes.v, need = Math.max(2, Math.ceil(k.n * 0.6));
  const rails = S.filter(s => length(s) > 0.1 && tilt(s) < 20).filter(s => k.cols.filter(c => c.some(L => crossings(s, L).length)).length >= need);
  if (!rails.length) return { ok: false, msg: '横着画一两道横档，把木桩连起来' };
  return { ok: true, msg: rails.length >= 2 ? `${rails.length} 道横档，钉牢了` : '只一道横档，不太牢', v: { n: Math.min(3, rails.length) } };
}
function fitTips(S, parts) {
  const k = parts.stakes.v;
  const T = S.filter(s => length(s) > 0.015).map(s => bbox([s]));
  const n = k.tops.filter(t => T.some(b => Math.abs(b.cx - t.x) < 0.04 && Math.abs(b.cy - t.y) < 0.05)).length;
  return { ok: true, msg: n ? `削尖了 ${n} 根` : '桩头没削尖', v: { sharp: n / k.n } };
}
const HEIGHT_WORD = h => (h < 0.45 ? '齐膝' : h < 0.6 ? '齐腰' : h < 0.8 ? '齐胸' : '过头');
function fenceParams(P) {
  const k = P.stakes.v, r = P.rails?.v || { n: 0 }, t = P.tips?.v || { sharp: 0 };
  const dens = clamp(0.12 / k.gap, 0.4, 1.6);
  const q = {
    high: clamp((k.h - 0.1) / 0.3, 0, 1),
    strong: clamp(0.4 * clamp(r.n / 2, 0, 1) + 0.3 * k.even * Math.min(1, dens) + 0.15 * k.level + 0.15 * t.sharp, 0, 1),
    sharp: t.sharp,
  };
  return {
    height: +clamp(0.3 + 0.7 * q.high, 0.3, 1).toFixed(2),
    hp: Math.round(80 + 160 * q.strong),
    sharp: +t.sharp.toFixed(2),
    woodPer40: +clamp(0.8 + 1.4 * dens * (0.6 + 0.4 * q.high) + 0.3 * r.n, 1, 4).toFixed(1),
    workPer40: +clamp(0.5 + 0.4 * dens + 0.15 * r.n, 0.5, 1.6).toFixed(2),
    q,
  };
}
function fenceStats(P) {
  const p = fenceParams(P), q = p.q;
  return [
    { k: '高度', v: HEIGHT_WORD(p.height), x: bar(q.high), why: '木桩越高越难翻；齐胸以上虎也跳不过' },
    { k: '结实', v: `${p.hp}`, x: bar(q.strong), why: '横档多、桩排得匀、桩脚齐、削了尖，撞不开（80–240）' },
    { k: '削尖', v: p.sharp > 0 ? `${Math.round(p.sharp * 100)}%` : '没削', x: bar(q.sharp), why: '削尖的桩，野兽撞上去会掉头' },
    { k: '用料', v: `每段木 ${p.woodPer40}`, x: null, why: `桩越密越高越费木头；每段约 ${p.workPer40} 个钟头的活` },
  ];
}


// ---------------- 石器台（第一代） ----------------
// 台面：一块平石板（横着一笔）；垫石：底下两块；石器（可跳过）：台上摆几件
// 一道横线断成了几笔（手一抖、笔一提）：把同一高度、首尾相接的横笔并成一道
function hspan(S, s) {
  const y = bbox([s]).cy;
  const parts = S.filter(x => x === s || (length(x) > 0.03 && tilt(x) < 18 && Math.abs(bbox([x]).cy - y) < 0.035));
  let b = bbox([s]), grew = true;
  while (grew) {
    grew = false;
    for (const x of parts) {
      const c = bbox([x]);
      if ((c.x0 < b.x0 || c.x1 > b.x1) && c.x0 < b.x1 + 0.06 && c.x1 > b.x0 - 0.06) { b = bbox([[{ x: Math.min(b.x0, c.x0), y: b.y0 }, { x: Math.max(b.x1, c.x1), y: b.y1 }]]); grew = true; }
    }
  }
  return { ...b, cy: y };
}
function fitSlab(S) {
  const s = longest(S.filter(x => length(x) > 0.12), 1)[0];
  if (!s) return { ok: false, msg: '先画一块平平的石板（横着一笔）' };
  if (tilt(s) > 14) return { ok: false, msg: '石板要放平' };
  const b = hspan(S, s);
  if (b.w < 0.25) return { ok: false, msg: '石板太短了，画长一点' };
  return { ok: true, msg: straightness(s) > 0.95 ? '石板又平又直' : '石板有点凹凸', v: { x0: b.x0, x1: b.x1, w: b.w, y: b.cy, straight: straightness(s), flat: 1 - tilt(s) / 14 } };
}
function fitLegs(S, parts) {
  const sl = parts.slab.v;
  const legs = S.filter(x => length(x) > 0.03).map(x => bbox([x])).filter(b => b.cy > sl.y + 0.01 && b.y0 < sl.y + 0.1 && b.cx > sl.x0 - 0.04 && b.cx < sl.x1 + 0.04);
  if (legs.length < 2) return { ok: false, msg: '在石板底下垫两块石头' };
  const xs = legs.map(b => b.cx).sort((a, b) => a - b);
  const spread = (xs.at(-1) - xs[0]) / sl.w;
  if (spread < 0.35) return { ok: false, msg: '两块垫石分开些，一边一块' };
  const level = clamp(1 - sdev(legs.map(b => b.y1)) / 0.04, 0, 1), touch = clamp(1 - avg(legs.map(b => Math.max(0, b.y0 - sl.y))) / 0.06, 0, 1);
  return { ok: true, msg: spread > 0.6 && level > 0.6 ? '垫稳了，石板不晃' : spread <= 0.6 ? '垫石靠得太近，两头悬空' : '垫石一高一低', v: { n: Math.min(4, legs.length), spread: clamp(spread, 0, 1), level, touch } };
}
function fitTools(S, parts) {
  const sl = parts.slab.v;
  const n = S.filter(x => length(x) > 0.02 && length(x) < 0.3).map(x => bbox([x])).filter(b => b.y1 < sl.y + 0.03 && b.y0 > sl.y - 0.22 && b.cx > sl.x0 && b.cx < sl.x1).length;
  return { ok: true, msg: n ? `台上摆了 ${n} 件石器` : '台上空着：也能用', v: { n: Math.min(5, n) } };
}
function benchParams(P) {
  const sl = P.slab.v, lg = P.legs?.v || { spread: 0.3, level: 0.3, touch: 0.3, n: 2 }, tl = P.tools?.v || { n: 0 };
  const q = { flat: sl.straight * (0.6 + 0.4 * sl.flat), support: lg.spread * (0.5 + 0.25 * lg.level + 0.25 * lg.touch), tools: Math.min(4, tl.n) / 4 };
  return {
    tool: +clamp(0.06 + 0.12 * q.flat * q.support + 0.04 * q.tools, 0.06, 0.22).toFixed(2),
    research: +clamp(0.15 + 0.2 * q.tools, 0.15, 0.35).toFixed(2),
    need: { stone: 4 + Math.round(sl.w / 0.1), wood: 2 },
    q,
  };
}
function benchStats(P) {
  const p = benchParams(P), q = p.q;
  return [
    { k: '趁手', v: `+${Math.round(p.tool * 100)}%`, x: bar(q.flat * q.support), why: '石板平直、垫得稳：会打石器的人砍柴采石盖房更快（6–22%）' },
    { k: '琢磨', v: `+${Math.round(p.research * 100)}%`, x: bar(q.tools), why: '台上摆的石器越多，琢磨手艺类技艺越快（15–35%）' },
    { k: '用料', v: `石 ${p.need.stone} · 木 ${p.need.wood}`, x: null, why: '石板越长越费石头' },
  ];
}

// ---------------- 陷阱（第一代） ----------------
// 坑：一个开口朝上的 U；尖桩：坑底几根竖桩；盖（可跳过）：坑口铺一层草枝
function fitPit(S) {
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: false, msg: '先挖个坑：画一个开口朝上的 U' };
  const P = flat(S), b = bbox(S);
  if (b.w < 0.16 || b.h < 0.1) return { ok: false, msg: '坑太小了，画大一点' };
  const inX = (p, a, c) => p.x > b.x0 + b.w * a && p.x < b.x0 + b.w * c;
  const bottom = P.filter(p => inX(p, 0.3, 0.7) && p.y > b.y1 - b.h * 0.2).length;
  const left = P.filter(p => p.x < b.x0 + b.w * 0.2 && p.y > b.y0 + b.h * 0.3).length, right = P.filter(p => p.x > b.x1 - b.w * 0.2 && p.y > b.y0 + b.h * 0.3).length;
  const lid = P.filter(p => inX(p, 0.25, 0.75) && p.y < b.y0 + b.h * 0.2).length / P.length;
  if (!bottom || !left || !right) return { ok: false, msg: '坑要有两壁和坑底' };
  if (lid > 0.12) return { ok: false, msg: '坑口要敞着（盖子最后一步再画）' };
  return { ok: true, msg: b.h / b.w > 0.5 ? '坑挖得深' : '坑浅了点，大兽跳得出来', v: { x0: b.x0, x1: b.x1, w: b.w, top: b.y0, bottom: b.y1, depth: b.h } };
}
function fitSpikes(S, parts) {
  const pt = parts.pit.v;
  const cols = columns(S, 30, 0.03).filter(g => g.cx > pt.x0 && g.cx < pt.x1 && g.b.y1 > pt.bottom - pt.depth * 0.45);
  if (cols.length < 2) return { ok: false, msg: '在坑底插两根以上的尖桩' };
  const h = avg(cols.map(g => g.b.h)) / pt.depth;
  return { ok: true, msg: `坑底 ${cols.length} 根尖桩${h > 0.6 ? '，又长又密' : ''}`, v: { n: Math.min(6, cols.length), h: clamp(h, 0, 1) } };
}
function fitLid(S, parts) {
  const pt = parts.pit.v;
  S = S.filter(x => length(x) > 0.03);
  if (!S.length) return { ok: true, msg: '没盖：野物看得见，逮得少', v: { cover: 0 } };
  const b = bbox(S);
  if (Math.abs(b.cy - pt.top) > 0.07) return { ok: false, msg: '盖要铺在坑口上' };
  const cover = overlap(b.x0, b.x1, pt.x0, pt.x1) / pt.w;
  return { ok: true, msg: cover > 0.8 ? '坑口盖严了，看不出来' : '盖没铺满', v: { cover: clamp(cover, 0, 1) } };
}
function trapParams(P) {
  const pt = P.pit.v, sp = P.spikes?.v || { n: 0, h: 0 }, ld = P.lid?.v || { cover: 0 };
  const q = { size: clamp((pt.w - 0.16) / 0.3, 0, 1) * 0.5 + clamp(pt.depth / pt.w, 0, 1) * 0.5, spikes: clamp(sp.n / 4, 0, 1) * (0.5 + 0.5 * sp.h), hide: ld.cover };
  return {
    catch: +clamp(0.22 + 0.16 * q.size + 0.2 * q.hide, 0.2, 0.6).toFixed(2),
    deadly: +clamp(0.12 + 0.43 * q.spikes, 0.12, 0.55).toFixed(2),
    need: { wood: 1 + Math.min(5, sp.n) },
    work: +(2.5 + 2 * clamp(pt.depth / 0.25, 0, 1)).toFixed(1),
    q,
  };
}
function trapStats(P) {
  const p = trapParams(P), q = p.q;
  return [
    { k: '逮到', v: `${Math.round(p.catch * 100)}%/天`, x: bar(0.5 * q.size + 0.5 * q.hide), why: '坑大、坑口盖严，野物不起疑；放在林子边、鹿群附近更多' },
    { k: '伤兽', v: `${Math.round(p.deadly * 100)}%`, x: bar(q.spikes), why: '尖桩多、长：狼踩进去多半扎死，虎也要带伤' },
    { k: '用料', v: `木 ${p.need.wood}`, x: null, why: `一根尖桩一份木；挖坑约 ${p.work} 个钟头` },
  ];
}

// ---------------- 大祭坛（第一代的时代工程，分三段） ----------------
const horiz = (S, minLen) => S.filter(x => length(x) > minLen && tilt(x) < 14);
// 一段：台基。底层一道长横，往上一层比一层窄，正中一道台阶（可跳过）
function fitBase(S) {
  const s = longest(horiz(S, 0.18), 1)[0];
  if (!s) return { ok: false, msg: '先画台基最底下一层：一道长长的横线' };
  const b = hspan(S, s);
  if (b.w < 0.35) return { ok: false, msg: '底层要长：整座祭坛都压在它上面' };
  return { ok: true, msg: straightness(s) > 0.95 ? '底层平直' : '底层不太平', v: { x0: b.x0, x1: b.x1, w: b.w, y: b.cy, cx: b.cx, straight: straightness(s) } };
}
function fitTiers(S, parts) {
  const bs = parts.base.v;
  const T = horiz(S, 0.1).map(x => ({ s: x, b: bbox([x]) })).filter(t => t.b.cy < bs.y - 0.025).sort((a, b) => b.b.cy - a.b.cy);
  if (!T.length) return { ok: false, msg: '往上再画一两层，一层比一层窄' };
  let prevW = bs.w, prevY = bs.y, ok = 0, off = 0;
  for (const t of T) {
    if (t.b.w > prevW + 0.02 || t.b.cy > prevY - 0.02) break;
    off = Math.max(off, Math.abs(t.b.cx - bs.cx));
    prevW = t.b.w; prevY = t.b.cy; ok++;
  }
  if (!ok) return { ok: false, msg: '上面一层要比下面窄，画在它上头' };
  const n = Math.min(3, ok);
  return { ok: true, msg: off < 0.05 ? `${n + 1} 层，层层居中` : `${n + 1} 层，有点歪`, v: { n, top: prevY, topW: prevW, even: clamp(1 - off / 0.1, 0, 1), level: avg(T.slice(0, n).map(t => 1 - tilt(t.s) / 14)) } };
}
function fitStairs(S, parts) {
  const bs = parts.base.v, tr = parts.tiers.v;
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: true, msg: '没修台阶：上下不方便', v: { stairs: 0 } };
  const b = bbox(S);
  if (Math.abs(b.cx - bs.cx) > 0.12) return { ok: false, msg: '台阶修在正中' };
  const span = (Math.min(bs.y, b.y1) - Math.max(tr.top, b.y0)) / Math.max(0.02, bs.y - tr.top);
  return { ok: true, msg: span > 0.6 ? '台阶从地上通到台顶' : '台阶短了，够不着台顶', v: { stairs: clamp(span, 0, 1) } };
}
function altar1Params(P) {
  const bs = P.base.v, tr = P.tiers?.v || { n: 1, even: 0.5, level: 0.5 }, st = P.stairs?.v || { stairs: 0 };
  const tiers = 1 + tr.n;
  const q = { form: bs.straight * (0.5 + 0.5 * tr.even) * (0.6 + 0.4 * tr.level), stairs: st.stairs };
  return {
    tiers, dev: +clamp(0.08 + 0.03 * tiers + 0.05 * q.form + 0.03 * q.stairs, 0.1, 0.28).toFixed(2),
    need: { stone: 16 + 4 * tiers + Math.round(bs.w * 10), wood: 6 }, work: 22 + 3 * tiers,
    q,
  };
}
function altar1Stats(P) {
  const p = altar1Params(P), q = p.q;
  return [
    { k: '层数', v: `${p.tiers} 层`, x: clamp(p.tiers / 4, 0.25, 1), why: '层数越多越气派，也越费石头' },
    { k: '信仰', v: `+${Math.round(p.dev * 100)}%`, x: bar(q.form), why: '底层平、层层居中、有台阶：族人更虔诚，墨回得快（10–28%）' },
    { k: '用料', v: `石 ${p.need.stone} · 木 ${p.need.wood}`, x: null, why: `约 ${p.work} 个钟头的活；开工 10 墨，边修边再吸 10 墨开光（神留四成墨应急）` },
  ];
}
// 二段：立石。在台顶立三块以上的石头，中间最高；刻纹（可跳过）
function fitStones(S) {
  const cols = columns(S, 18, 0.07);
  if (cols.length < 3) return { ok: false, msg: '在台顶立三块以上竖着的石头' };
  const bottoms = cols.map(g => g.b.y1), level = clamp(1 - sdev(bottoms) / 0.04, 0, 1);
  if (level < 0.2) return { ok: false, msg: '立石要站在同一层台面上' };
  const hs = cols.map(g => g.b.h), mid = cols.reduce((m, g) => (Math.abs(g.cx - avg(cols.map(c => c.cx))) < Math.abs(m.cx - avg(cols.map(c => c.cx))) ? g : m));
  const center = mid.b.h >= Math.max(...hs) - 0.01;
  const b = bbox(cols.flatMap(g => g.lines));
  return { ok: true, msg: center ? `${cols.length} 块立石，中间那块最高` : `${cols.length} 块立石`, v: { n: Math.min(6, cols.length), h: avg(hs), center: center ? 1 : 0, level, box: { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 } } };
}
function fitMarks(S, parts) {
  const bx = parts.stones.v.box;
  const n = S.filter(x => length(x) > 0.015 && length(x) < 0.2).map(x => bbox([x])).filter(b => b.cx > bx.x0 - 0.03 && b.cx < bx.x1 + 0.03 && b.cy > bx.y0 - 0.03 && b.cy < bx.y1 + 0.01).length;
  return { ok: true, msg: n ? `刻了 ${n} 道纹` : '石头素着：也行', v: { n: Math.min(6, n) } };
}
function altar2Params(P) {
  const st = P.stones.v, mk = P.marks?.v || { n: 0 };
  const q = { tall: clamp((st.h - 0.07) / 0.2, 0, 1), form: (0.5 + 0.5 * st.center) * (0.5 + 0.5 * st.level), marks: clamp(mk.n / 4, 0, 1) };
  return {
    stones: st.n, ward: Math.round(220 + 25 * st.n + 80 * q.tall), awe: +clamp(0.03 + 0.03 * q.form + 0.04 * q.marks, 0.03, 0.1).toFixed(2),
    need: { stone: 10 + 3 * st.n, wood: 6 + 2 * st.n }, work: 20 + 2 * st.n,
    q,
  };
}
function altar2Stats(P) {
  const p = altar2Params(P), q = p.q;
  return [
    { k: '立石', v: `${p.stones} 块`, x: clamp(p.stones / 6, 0.3, 1), why: '立得越多越费料' },
    { k: '镇兽', v: `${p.ward} 步`, x: bar(q.tall), why: '立石越高越多，虎越不敢靠近祭坛这一圈（不饿急了的话）' },
    { k: '敬畏', v: `+${Math.round(p.awe * 100)}`, x: bar(0.5 * q.form + 0.5 * q.marks), why: '中间最高、站得齐、刻了纹：族人更敬畏也更爱戴' },
    { k: '用料', v: `石 ${p.need.stone} · 木 ${p.need.wood}`, x: null, why: `约 ${p.work} 个钟头；开工 15 墨，边修边再吸 30 墨开光（神留四成墨应急）` },
  ];
}
// 三段：墨池。祭坛前一个围严的池子；引水的沟（可跳过）
function fitPool(S) {
  const r = fitRing(S);
  if (!r.ok) return { ok: false, msg: r.msg.replace('石圈', '池子').replace('用石头围一个圈', '在祭坛前围一个池子') };
  return { ok: true, msg: r.v.cover > 0.9 ? '池子围严了，不漏墨' : '池子有缺口：会漏', v: r.v };
}
function fitChannels(S, parts) {
  const g = parts.pool.v, rx = g.w / 2 + 0.03, ry = g.h / 2 + 0.03;
  const inside = p => ((p.x - g.cx) / rx) ** 2 + ((p.y - g.cy) / ry) ** 2 < 1.15;
  const n = S.filter(x => length(x) > 0.07).filter(x => inside(x[0]) !== inside(x[x.length - 1]) || inside(x[x.length - 1])).length;
  return { ok: true, msg: n ? `${n} 道沟把水引进池里` : '没引水：墨池全靠天上落的', v: { n: Math.min(3, n) } };
}
function altar3Params(P) {
  const g = P.pool.v, ch = P.channels?.v || { n: 0 };
  const q = { size: clamp((g.w - 0.15) / 0.35, 0, 1), seal: g.cover * (0.5 + 0.5 * g.even), flow: ch.n / 3 };
  return {
    bonus: Math.round(10 * q.size * q.seal), flow: +(0.08 * ch.n).toFixed(2),
    need: { stone: 12 + Math.round(g.w * 30), wood: 4 }, work: 32,
    q,
  };
}
function altar3Stats(P) {
  const p = altar3Params(P), q = p.q;
  return [
    { k: '墨池', v: `上限 ${60 + p.bonus}`, x: bar(q.size * q.seal), why: '修成后墨的上限翻倍（30 → 60）；池子越大、围得越严，再多 0–10' },
    { k: '回墨', v: p.flow ? `+${Math.round(p.flow * 100)}%` : '—', x: bar(q.flow), why: '每道引水沟让墨回得快 8%' },
    { k: '用料', v: `石 ${p.need.stone} · 木 ${p.need.wood}`, x: null, why: `约 ${p.work} 个钟头；开工 24 墨，边修边再吸 56 墨开光（神留四成墨应急）` },
  ];
}

// ---------------- 第二代图纸（农耕时代） ----------------
// 公共粮仓：高脚桩 → 仓身 → 仓顶（可跳过）
function fitStilts(S) {
  const cols = columns(S, 24, 0.05);
  if (cols.length < 2) return { ok: false, msg: '画至少两根竖直的高脚木桩，把粮仓架离地面' };
  const span = cols.at(-1).cx - cols[0].cx;
  if (span < 0.16) return { ok: false, msg: '木桩之间拉宽一点，容得下粮仓' };
  const h = avg(cols.map(c => c.b.h)), top = avg(cols.map(c => c.b.y0)), bottom = avg(cols.map(c => c.b.y1));
  const level = clamp(1 - sdev(cols.map(c => c.b.y0)) / 0.05, 0, 1);
  return {
    ok: true,
    msg: cols.length >= 3 ? `${cols.length} 根高脚桩，离地防潮防鼠` : '两根桩架起来了，再多几根更稳',
    v: { n: Math.min(6, cols.length), x0: cols[0].cx, x1: cols.at(-1).cx, span, h, top, bottom, level },
  };
}
function fitWalls(S, parts) {
  const st = parts.stilts.v;
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: false, msg: '在高脚桩上方画出仓身' };
  const b = bbox(S);
  if (b.w < 0.16 || b.h < 0.08) return { ok: false, msg: '仓身太小了，画大一点装更多粮' };
  if (b.y1 > st.bottom + 0.02 || b.y0 > st.top + 0.05) return { ok: false, msg: '仓身要画在高脚桩顶上' };
  const cover = overlap(b.x0, b.x1, st.x0, st.x1) / st.span;
  if (cover < 0.5) return { ok: false, msg: '仓身要盖住底下的木桩' };
  return {
    ok: true,
    msg: cover > 0.85 ? '仓身稳稳压在木桩上' : '仓身略偏，一头探出桩外',
    v: { w: b.w, h: b.h, x0: b.x0, x1: b.x1, top: b.y0, bottom: b.y1, cover: clamp(cover, 0, 1) },
  };
}
function fitGranaryRoof(S, parts) {
  const wl = parts.walls.v;
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: true, msg: '没有仓顶：下雨容易淋坏谷物', v: { cover: 0, pitch: 0 } };
  const b = bbox(S);
  if (b.y1 > wl.top + 0.08) return { ok: false, msg: '仓顶要画在仓身上面' };
  const cover = overlap(b.x0, b.x1, wl.x0, wl.x1) / wl.w;
  const pitch = clamp(b.h / Math.max(0.08, b.w * 0.5), 0, 1);
  return { ok: true, msg: cover > 0.85 ? '仓顶遮严了仓身，不漏雨' : '仓顶偏窄，檐口遮不住', v: { cover: clamp(cover, 0, 1), pitch } };
}
function granaryParams(P) {
  const st = P.stilts.v, wl = P.walls.v, rf = P.roof?.v || { cover: 0, pitch: 0 };
  const q = {
    size: clamp((wl.w * wl.h - 0.02) / 0.09, 0, 1),
    damp: clamp(0.55 * clamp(st.h / 0.14, 0, 1) + 0.45 * rf.cover, 0, 1),
    sturdy: clamp(0.45 * st.level + 0.35 * wl.cover + 0.2 * clamp(st.n / 4, 0, 1), 0, 1),
  };
  return {
    cap: clamp(Math.round(45 + 115 * q.size), 40, 160),
    dampProof: +bar(q.damp, 0.35).toFixed(2),
    sturdy: +bar(q.sturdy, 0.35).toFixed(2),
    need: { wood: 5 + Math.round(wl.w * 12) + st.n, stone: 3 + st.n },
    q,
  };
}
function granaryStats(P) {
  const p = granaryParams(P), q = p.q;
  return [
    { k: '容粮', v: `${p.cap} 份`, x: bar(q.size, 0.25), why: '仓身画得越大，能护住的谷物越多（45–160 份）' },
    { k: '防潮', v: `${Math.round(p.dampProof * 100)}%`, x: p.dampProof, why: '桩高离地、仓顶盖严，谷物不发霉不招鼠' },
    { k: '稳固', v: '', x: p.sturdy, why: '桩柱齐平、仓身落稳' },
    { k: '用料', v: `木 ${p.need.wood} · 石 ${p.need.stone}`, x: null, why: '柱多仓大费木石' },
  ];
}

// 陶窑：拱形窑室 → 烟囱 → 火口（可跳过）
function fitDome(S) {
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: false, msg: '先画一个半圆拱形的窑室' };
  const P = flat(S), b = bbox(S);
  if (b.w < 0.16 || b.h < 0.1) return { ok: false, msg: '窑室太小了，画大一点' };
  const left = P.some(p => p.x < b.x0 + b.w * 0.25 && p.y > b.y0 + b.h * 0.35);
  const right = P.some(p => p.x > b.x1 - b.w * 0.25 && p.y > b.y0 + b.h * 0.35);
  const crown = P.some(p => p.x > b.x0 + b.w * 0.25 && p.x < b.x1 - b.w * 0.25 && p.y < b.y0 + b.h * 0.28);
  if (!left || !right || !crown) return { ok: false, msg: '窑室要有左右拱壁和拱顶' };
  const sym = 1 - Math.min(1, Math.abs(avg(P.map(p => p.x)) - b.cx) / (b.w * 0.25));
  return {
    ok: true,
    msg: sym > 0.75 ? '拱形窑室起得好，蓄热稳' : '窑室歪了些，还烧得着',
    v: { w: b.w, h: b.h, cx: b.cx, x0: b.x0, x1: b.x1, top: b.y0, bottom: b.y1, sym },
  };
}
function fitFlue(S, parts) {
  const dm = parts.dome.v;
  S = S.filter(x => length(x) > 0.03);
  if (!S.length) return { ok: false, msg: '在窑顶上方画一道排烟的烟囱' };
  const b = bbox(S);
  if (b.y0 > dm.top + 0.06 || b.y1 < dm.top - 0.18) return { ok: false, msg: '烟囱要接在窑顶上方' };
  if (b.h < 0.04) return { ok: false, msg: '烟囱太矮了，抽风不动' };
  const centered = clamp(1 - Math.abs(b.cx - dm.cx) / (dm.w * 0.45), 0, 1);
  return { ok: true, msg: b.h > 0.09 ? '烟囱拔得高，窑火烧得透' : '烟囱偏矮', v: { h: b.h, centered } };
}
function fitMouth(S, parts) {
  const dm = parts.dome.v;
  S = S.filter(x => length(x) > 0.02);
  if (!S.length) return { ok: true, msg: '没留小火口：烧窑费力', v: { has: 0 } };
  const b = bbox(S);
  const near = b.cx > dm.x0 && b.cx < dm.x1 && b.y1 > dm.bottom - dm.h * 0.55;
  return { ok: true, msg: near ? '火口开在窑腹底，添柴方便' : '火口偏了点', v: { has: near ? 1 : 0.5 } };
}
function kilnParams(P) {
  const dm = P.dome.v, fl = P.flue?.v || { h: 0.05, centered: 0.5 }, mt = P.mouth?.v || { has: 0 };
  const q = {
    cap: clamp((dm.w * dm.h - 0.03) / 0.12, 0, 1),
    heat: clamp(0.55 * clamp(fl.h / 0.12, 0, 1) + 0.25 * fl.centered + 0.2 * mt.has, 0, 1),
    sturdy: clamp(0.6 * dm.sym + 0.4 * fl.centered, 0, 1),
  };
  return {
    cap: clamp(1 + Math.round(q.cap * 1.6), 1, 3),
    heat: +bar(q.heat, 0.4).toFixed(2),
    sturdy: +bar(q.sturdy, 0.4).toFixed(2),
    need: { stone: 6 + Math.round(dm.w * 12), wood: 4 },
    q,
  };
}
function kilnStats(P) {
  const p = kilnParams(P), q = p.q;
  return [
    { k: '烧制', v: `${p.cap} 窑`, x: clamp(p.cap / 3, 0.3, 1), why: '窑室越大，出陶罐越快（1–3 窑量）' },
    { k: '窑火', v: `${Math.round(p.heat * 100)}%`, x: p.heat, why: '烟囱拔高、有火口，烧陶火候旺' },
    { k: '稳固', v: '', x: p.sturdy, why: '拱壁匀称、烟囱居中' },
    { k: '用料', v: `石 ${p.need.stone} · 木 ${p.need.wood}`, x: null, why: '窑室越大越费石料' },
  ];
}

// 木构房：立柱 → 人字坡顶 → 地基（可跳过）
function fitPillars(S) {
  const cols = columns(S, 22, 0.08);
  if (cols.length < 2) return { ok: false, msg: '画两根以上竖直的木立柱' };
  const span = cols.at(-1).cx - cols[0].cx;
  if (span < 0.16) return { ok: false, msg: '立柱拉宽些，房子住人宽敞' };
  const h = avg(cols.map(c => c.b.h));
  const level = clamp(1 - sdev(cols.map(c => c.b.y1)) / 0.05, 0, 1);
  return {
    ok: true,
    msg: cols.length >= 3 ? `${cols.length} 根立柱排得齐整` : '立柱站稳了',
    v: { n: Math.min(5, cols.length), x0: cols[0].cx, x1: cols.at(-1).cx, span, h, top: avg(cols.map(c => c.b.y0)), bottom: avg(cols.map(c => c.b.y1)), level },
  };
}
function fitTimberRoof(S, parts) {
  const pl = parts.pillars.v;
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: false, msg: '在立柱顶上画坡顶' };
  const b = bbox(S);
  if (b.y1 > pl.top + 0.09) return { ok: false, msg: '屋顶要搭在立柱顶上' };
  const cover = overlap(b.x0, b.x1, pl.x0, pl.x1) / pl.span;
  if (cover < 0.55) return { ok: false, msg: '屋顶要罩住两边的立柱' };
  const pitch = clamp(b.h / Math.max(0.1, b.w * 0.5), 0, 1);
  return { ok: true, msg: pitch > 0.35 ? '人字坡顶稳实挡雨' : '屋顶偏平', v: { cover: clamp(cover, 0, 1), pitch } };
}
function fitTimberBase(S, parts) {
  const pl = parts.pillars.v;
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: true, msg: '没垫地基横梁：防潮略差', v: { cover: 0 } };
  const b = bbox(S);
  if (Math.abs(b.cy - pl.bottom) > 0.09) return { ok: false, msg: '地基要画在立柱脚下' };
  const cover = overlap(b.x0, b.x1, pl.x0, pl.x1) / pl.span;
  return { ok: true, msg: cover > 0.85 ? '地基托全了立柱' : '地基窄了点', v: { cover: clamp(cover, 0, 1) } };
}
function timberhouseParams(P) {
  const pl = P.pillars.v, rf = P.roof?.v || { cover: 0.6, pitch: 0.5 }, bs = P.base?.v || { cover: 0 };
  const q = {
    size: clamp((pl.span - 0.16) / 0.36, 0, 1),
    rain: clamp(0.55 * rf.cover + 0.45 * rf.pitch, 0, 1),
    sturdy: clamp(0.4 * pl.level + 0.35 * rf.cover + 0.25 * bs.cover, 0, 1),
  };
  return {
    cap: clamp(Math.round(4 + 5 * q.size), 4, 9),
    rainproof: +bar(q.rain, 0.45).toFixed(2),
    warmth: +bar(0.5 + 0.3 * q.sturdy + 0.2 * q.rain, 0.45).toFixed(2),
    sturdy: +bar(q.sturdy, 0.45).toFixed(2),
    need: { wood: 6 + Math.round(pl.span * 14) + pl.n, stone: 3 + Math.round(bs.cover * 3) },
    q,
  };
}
function timberhouseStats(P) {
  const p = timberhouseParams(P), q = p.q;
  return [
    { k: '容纳', v: `${p.cap} 人`, x: bar(q.size, 0.3), why: '柱跨越大越宽敞，可住下一整户（4–9 人）' },
    { k: '防雨', v: `${Math.round(p.rainproof * 100)}%`, x: p.rainproof, why: '坡顶高且罩全立柱，风雨不漏' },
    { k: '稳固', v: '', x: p.sturdy, why: '立柱齐、地基稳' },
    { k: '用料', v: `木 ${p.need.wood} · 石 ${p.need.stone}`, x: null, why: '大房费木石' },
  ];
}

// 畜栏：围栏圈 → 食槽 → 遮雨棚（可跳过）
function fitEnclosure(S) {
  const r = fitRing(S);
  if (!r.ok) return { ok: false, msg: r.msg.replace('石圈', '围栏').replace('用石头围一个圈', '画一道闭合的木围栏') };
  return { ok: true, msg: r.v.cover > 0.88 ? '围栏围严了，牲口跑不出去' : '围栏有缺口', v: r.v };
}
function fitTrough(S, parts) {
  const en = parts.enclosure.v;
  S = S.filter(x => length(x) > 0.03);
  if (!S.length) return { ok: false, msg: '在栏里画个食槽' };
  const b = bbox(S);
  if (b.cx < en.x0 - 0.05 || b.cx > en.x1 + 0.05 || b.cy < en.top - 0.08 || b.cy > en.bottom + 0.08) return { ok: false, msg: '食槽要画在围栏里' };
  return { ok: true, msg: '食槽摆好了', v: { size: clamp(b.w / 0.2, 0.3, 1) } };
}
function fitShed(S, parts) {
  const en = parts.enclosure.v;
  S = S.filter(x => length(x) > 0.04);
  if (!S.length) return { ok: true, msg: '没有遮雨棚：大雨牲口受凉', v: { has: 0 } };
  const b = bbox(S);
  const ok = b.y0 < en.top + 0.06 && overlap(b.x0, b.x1, en.x0, en.x1) > 0.1;
  return { ok: true, msg: ok ? '搭好了遮雨小棚' : '棚子偏开围栏了', v: { has: ok ? 1 : 0.4 } };
}
function penParams(P) {
  const en = P.enclosure.v, tr = P.trough?.v || { size: 0.4 }, sh = P.shed?.v || { has: 0 };
  const q = {
    size: clamp((en.w - 0.14) / 0.34, 0, 1),
    care: clamp(0.6 * tr.size + 0.4 * sh.has, 0, 1),
    sturdy: en.cover * (0.5 + 0.5 * en.even),
  };
  return {
    yield: clamp(1 + Math.round(q.size * 1.5 + q.care * 1.2), 1, 4),
    sturdy: +bar(q.sturdy, 0.35).toFixed(2),
    neat: +bar(q.care, 0.35).toFixed(2),
    need: { wood: 4 + Math.round(en.w * 10) },
    q,
  };
}
function penStats(P) {
  const p = penParams(P), q = p.q;
  return [
    { k: '产肉', v: `${p.yield} 份/天`, x: bar(0.5 * q.size + 0.5 * q.care), why: '栏大槽深、有遮雨棚，畜生养得肥，邻近农田也借肥' },
    { k: '围严', v: '', x: p.sturdy, why: '围栏闭合匀整' },
    { k: '照料', v: '', x: p.neat, why: '食槽与遮雨棚齐备' },
    { k: '用料', v: `木 ${p.need.wood}`, x: null, why: '围栏越大越费木头' },
  ];
}

// 木桥：拱形桥面 → 桥墩 → 护栏（可跳过）
function fitBridgeArch(S) {
  const s = longest(S.filter(x => length(x) > 0.12), 1)[0];
  if (!s) return { ok: false, msg: '横着画一道长桥面或拱形桥身' };
  if (tilt(s) > 20) return { ok: false, msg: '桥面要横跨河岸' };
  const b = bbox([s]);
  if (b.w < 0.25) return { ok: false, msg: '桥太短了，跨不过河' };
  return {
    ok: true,
    msg: straightness(s) > 0.9 ? '桥面铺得宽阔平稳' : '桥身带拱，跨越稳当',
    v: { x0: b.x0, x1: b.x1, w: b.w, y: b.y1, top: b.y0, cx: b.cx, smooth: clamp(1 - Math.abs(b.h - 0.08) * 2, 0.4, 1) },
  };
}
function fitPiers(S, parts) {
  const ar = parts.arch.v;
  const cols = columns(S, 26, 0.05).filter(c => c.b.y1 > ar.top + 0.02 && c.cx > ar.x0 - 0.05 && c.cx < ar.x1 + 0.05);
  if (cols.length < 2) return { ok: false, msg: '在桥面下面画至少两根竖直桥墩' };
  const span = cols.at(-1).cx - cols[0].cx;
  if (span < ar.w * 0.25) return { ok: false, msg: '桥墩分开一点立在河床两边' };
  const level = clamp(1 - sdev(cols.map(c => c.b.y1)) / 0.05, 0, 1);
  return { ok: true, msg: `${cols.length} 座桥墩立在水里，架住了桥身`, v: { n: Math.min(4, cols.length), span: clamp(span / ar.w, 0, 1), level } };
}
function fitRail(S, parts) {
  const ar = parts.arch.v;
  S = S.filter(x => length(x) > 0.06);
  if (!S.length) return { ok: true, msg: '没装栏杆：走着得小心', v: { has: 0 } };
  const b = bbox(S);
  const ok = b.y0 < ar.y + 0.04 && overlap(b.x0, b.x1, ar.x0, ar.x1) / ar.w > 0.45;
  return { ok: true, msg: ok ? '桥上安了护栏，挑重担也不怕' : '护栏短了些', v: { has: ok ? 1 : 0.4 } };
}
function bridgeParams(P) {
  const ar = P.arch.v, pr = P.piers?.v || { n: 2, span: 0.5, level: 0.5 }, rl = P.rail?.v || { has: 0 };
  const q = {
    span: clamp((ar.w - 0.25) / 0.45, 0, 1),
    sturdy: clamp(0.4 * pr.level + 0.35 * pr.span + 0.25 * ar.smooth, 0, 1),
    safe: rl.has,
  };
  return {
    speedMul: +(1.22 + 0.28 * (0.6 * q.sturdy + 0.4 * q.safe)).toFixed(2),
    sturdy: +bar(q.sturdy, 0.4).toFixed(2),
    span: Math.round(85 + 65 * q.span),
    need: { wood: 7 + Math.round(ar.w * 10), stone: 4 + pr.n * 2 },
    q,
  };
}
function bridgeStats(P) {
  const p = bridgeParams(P), q = p.q;
  return [
    { k: '通行', v: `${Math.round(p.speedMul * 100)}% 步速`, x: bar(0.6 * q.sturdy + 0.4 * q.safe), why: '桥稳又有护栏，族人挑粮过河更快（不涉水减速）' },
    { k: '跨度', v: `${p.span} 步`, x: bar(q.span, 0.3), why: '桥跨度越宽，覆盖两岸河段越大' },
    { k: '稳固', v: '', x: p.sturdy, why: '桥墩立齐、分跨合适' },
    { k: '用料', v: `木 ${p.need.wood} · 石 ${p.need.stone}`, x: null, why: '桥长墩多越费木石' },
  ];
}

// ---------------- 发射台（第八代） ----------------

function fitRocket(S) {
  S = S.filter(s => length(s) > 0.02);
  if (!S.length) return { ok: false, msg: '画直立的箭塔：两条竖边，顶上收尖' };
  const P = flat(S), b = bbox(S), axis = pca(P);
  const vert = Math.abs(90 - Math.abs(deg(axis.angle)));
  if (b.h < 0.15 || b.h / (b.w || 1e-6) < 2) return { ok: false, msg: '箭塔要又高又细' };
  if (vert > 20) return { ok: false, msg: '箭塔要立直' };
  // 鼻锥：顶部 15% 的宽度比身子窄多少
  const topBand = P.filter(p => p.y < b.y0 + b.h * 0.15), midBand = P.filter(p => p.y > b.y0 + b.h * 0.4 && p.y < b.y0 + b.h * 0.8);
  const wOf = A => (A.length ? Math.max(...A.map(p => p.x)) - Math.min(...A.map(p => p.x)) : 0);
  const nose = 1 - wOf(topBand) / (wOf(midBand) || b.w);
  return { ok: true, msg: nose > 0.35 ? '箭塔立住了，顶上收了尖' : '顶上没收尖，风阻大', v: { h: b.h, w: b.w, vert, nose, x0: b.x0, x1: b.x1, bottom: b.y1, top: b.y0 } };
}

function fitTower(S, parts) {
  const r = parts.rocket.v;
  S = S.filter(s => length(s) > 0.02);
  const verts = longest(S.filter(s => length(s) > 0.1 && lean(s) < 15), 2);
  if (verts.length < 2) return { ok: false, msg: '勤务塔要两条竖线' };
  const bx = bbox(verts);
  if (overlap(bx.x0, bx.x1, r.x0, r.x1) > 0.3 * (bx.x1 - bx.x0)) return { ok: false, msg: '勤务塔画在箭塔旁边，别叠在一起' };
  const bars = S.filter(s => !verts.includes(s)).filter(s => { const b = bbox([s]); return overlap(b.x0, b.x1, bx.x0, bx.x1) > 0.6 * bx.w; }).length;
  const gapX = Math.max(0, Math.max(bx.x0 - r.x1, r.x0 - bx.x1));
  return { ok: true, msg: bars >= 2 ? `塔身 ${bars} 道横撑` : '横撑太少，塔会晃', v: { h: bx.h, ratio: bx.h / r.h, bars, gapX, x0: bx.x0, x1: bx.x1, bottom: bx.y1, lean: (lean(verts[0]) + lean(verts[1])) / 2 } };
}

function fitDeck(S, parts) {
  const r = parts.rocket.v, t = parts.tower.v;
  const s = longest(S.filter(x => length(x) > 0.05), 1)[0];
  if (!s) return { ok: false, msg: '在底部画一条横向平台' };
  const b = bbox([s]);
  if (tilt(s) > 12) return { ok: false, msg: '平台要水平' };
  const baseY = Math.max(r.bottom, t.bottom);
  if (b.cy < baseY - 0.05 || b.cy > baseY + 0.09) return { ok: false, msg: '平台要托在两座塔的脚下' };
  const x0 = Math.min(r.x0, t.x0), x1 = Math.max(r.x1, t.x1);
  const cover = overlap(b.x0, b.x1, x0, x1) / (x1 - x0);
  return { ok: true, msg: cover > 0.95 ? '平台托住了两座塔' : '平台没托全', v: { cover, flat: 1 - tilt(s) / 12, straight: straightness(s), off: Math.abs(b.cy - baseY) } };
}

function padStats(P) {
  const r = P.rocket.v, t = P.tower?.v, d = P.deck?.v;
  const bar = (x, lo = 0.35) => clamp(lo + (1 - lo) * x, lo, 1);
  const payload = clamp(Math.round(r.h / 0.45 * 20), 6, 30);
  return [
    { k: '载荷', v: `${payload} 吨`, x: clamp(r.h / 0.5, 0.2, 1), why: '箭塔画得越高，装得越多（6–30 吨）' },
    { k: '稳定', v: `偏 ${r.vert.toFixed(1)}°`, x: bar(clamp(1 - r.vert / 15, 0, 1) * (d ? clamp(d.cover, 0, 1) : 0.5) * (0.6 + 0.4 * clamp(r.nose / 0.6, 0, 1))), why: '立得直、顶上收尖、平台托全' },
    { k: '加注', v: t ? `塔高 ${Math.round(t.ratio * 100)}%` : '—', x: t ? bar(clamp((t.ratio - 0.5) / 0.4, 0, 1)) : 0.35, why: '勤务塔够得着箭塔顶部（≥ 90%）才能加满' },
    { k: '承重', v: d ? `平台 ${Math.round(d.cover * 100)}%` : '—', x: d ? bar(d.flat * d.straight * clamp(d.cover, 0, 1) * (t ? clamp(t.bars / 3, 0.4, 1) : 0.4)) : 0.35, why: '平台平直托全，塔有横撑' },
  ];
}

// 提示淡影（图纸坐标）
const GHOST = {
  frame: [line(0.3, 0.6, 0.515, 0.165), line(0.7, 0.6, 0.485, 0.165)],
  ground: [line(0.24, 0.605, 0.76, 0.605)],
  door: [curve([[0.45, 0.6], [0.455, 0.5], [0.5, 0.46], [0.545, 0.5], [0.55, 0.6]])],
  thatch: [line(0.37, 0.36, 0.43, 0.42), line(0.42, 0.27, 0.48, 0.33), line(0.63, 0.36, 0.57, 0.42), line(0.58, 0.27, 0.52, 0.33)],
  rocket: [poly([[0.37, 0.62], [0.37, 0.24], [0.4, 0.1], [0.43, 0.24], [0.43, 0.62]])],
  tower: [line(0.52, 0.62, 0.52, 0.18), line(0.58, 0.62, 0.58, 0.18), line(0.52, 0.28, 0.58, 0.28), line(0.52, 0.4, 0.58, 0.4), line(0.52, 0.52, 0.58, 0.52)],
  deck: [line(0.28, 0.635, 0.68, 0.635)],
  ring: [arc(0.5, 0.53, 0.2, 0.075, 0, Math.PI * 2)],
  wood: [line(0.38, 0.55, 0.56, 0.34), line(0.62, 0.55, 0.44, 0.34), line(0.5, 0.57, 0.5, 0.31)],
  cover: [poly([[0.28, 0.27], [0.5, 0.14], [0.72, 0.27]])],
  posts: [line(0.32, 0.62, 0.32, 0.2), line(0.68, 0.62, 0.68, 0.2)],
  bar: [line(0.27, 0.22, 0.73, 0.22)],
  strips: [0.4, 0.47, 0.54, 0.61].map((x, i) => curve([[x, 0.235], [x + 0.012, 0.3], [x - 0.006, 0.36 + 0.02 * (i % 2)]])),
  stakes: [0.26, 0.38, 0.5, 0.62, 0.74].map(x => line(x, 0.6, x, 0.25)),
  rails: [line(0.2, 0.34, 0.8, 0.34), line(0.2, 0.5, 0.8, 0.5)],
  tips: [0.26, 0.38, 0.5, 0.62, 0.74].map(x => poly([[x - 0.022, 0.27], [x, 0.215], [x + 0.022, 0.27]])),
  slab: [line(0.24, 0.4, 0.76, 0.4)],
  legs: [poly([[0.3, 0.415], [0.29, 0.55], [0.39, 0.55], [0.38, 0.415]]), poly([[0.62, 0.415], [0.61, 0.55], [0.71, 0.55], [0.7, 0.415]])],
  tools: [poly([[0.36, 0.385], [0.4, 0.3], [0.44, 0.385]]), arc(0.53, 0.36, 0.03, 0.022, 0, Math.PI * 2), line(0.6, 0.38, 0.68, 0.34)],
  pit: [poly([[0.3, 0.32], [0.33, 0.6], [0.67, 0.6], [0.7, 0.32]])],
  spikes: [0.41, 0.48, 0.55, 0.62].map(x => line(x - 0.03, 0.59, x - 0.03, 0.47)),
  lid: [line(0.27, 0.315, 0.73, 0.315)],
  base: [line(0.14, 0.56, 0.86, 0.56)],
  tiers: [line(0.24, 0.47, 0.76, 0.47), line(0.34, 0.38, 0.66, 0.38)],
  stairs: [poly([[0.46, 0.56], [0.46, 0.52], [0.49, 0.52], [0.49, 0.47], [0.52, 0.47], [0.52, 0.43], [0.55, 0.43], [0.55, 0.38]])],
  stones: [line(0.365, 0.375, 0.365, 0.25), line(0.455, 0.375, 0.455, 0.14), line(0.545, 0.375, 0.545, 0.14), line(0.635, 0.375, 0.635, 0.25)],
  marks: [arc(0.455, 0.22, 0.016, 0.016, 0, Math.PI * 2), arc(0.545, 0.22, 0.016, 0.016, 0, Math.PI * 2), line(0.35, 0.29, 0.38, 0.31), line(0.62, 0.29, 0.65, 0.31)],
  pool: [arc(0.5, 0.63, 0.24, 0.045, 0, Math.PI * 2)],
  channels: [curve([[0.08, 0.6], [0.17, 0.625], [0.27, 0.63]]), curve([[0.92, 0.6], [0.83, 0.625], [0.73, 0.63]])],
  stilts: [0.32, 0.44, 0.56, 0.68].map(x => line(x, 0.62, x, 0.48)),
  walls: [poly([[0.28, 0.48], [0.28, 0.28], [0.72, 0.28], [0.72, 0.48], [0.28, 0.48]])],
  granaryRoof: [poly([[0.23, 0.28], [0.5, 0.13], [0.77, 0.28]])],
  dome: [curve([[0.26, 0.58], [0.28, 0.34], [0.5, 0.22], [0.72, 0.34], [0.74, 0.58]]), line(0.24, 0.58, 0.76, 0.58)],
  flue: [line(0.46, 0.23, 0.46, 0.10), line(0.54, 0.23, 0.54, 0.10)],
  mouth: [curve([[0.42, 0.58], [0.43, 0.47], [0.5, 0.44], [0.57, 0.47], [0.58, 0.58]])],
  pillars: [0.28, 0.5, 0.72].map(x => line(x, 0.60, x, 0.30)),
  timberRoof: [poly([[0.2, 0.31], [0.5, 0.14], [0.8, 0.31]]), line(0.24, 0.31, 0.76, 0.31)],
  timberBase: [line(0.22, 0.605, 0.78, 0.605)],
  enclosure: [arc(0.5, 0.46, 0.24, 0.12, 0, Math.PI * 2)],
  trough: [poly([[0.40, 0.42], [0.60, 0.42], [0.58, 0.49], [0.42, 0.49], [0.40, 0.42]])],
  shed: [poly([[0.27, 0.34], [0.44, 0.24], [0.61, 0.34]])],
  arch: [curve([[0.16, 0.46], [0.34, 0.38], [0.5, 0.36], [0.66, 0.38], [0.84, 0.46]])],
  piers: [line(0.32, 0.42, 0.32, 0.62), line(0.68, 0.42, 0.68, 0.62)],
  rail: [curve([[0.18, 0.39], [0.5, 0.30], [0.82, 0.39]])],
};

export const BLUEPRINTS = {
  shack: {
    id: 'shack', name: '窝棚', era: '第一代', cost: '木、草', place: 'point', blurb: '住人：挡风挡雨，夜里暖和，有了家才肯生养',
    steps: [
      { id: 'frame', prompt: '先画两根斜木，在顶上交成「人」字', fit: fitFrame, ghost: GHOST.frame },
      { id: 'ground', prompt: '在斜木脚下画一道地面', fit: fitGround, ghost: GHOST.ground },
      { id: 'door', prompt: '在中间开一扇门', fit: fitDoor, ghost: GHOST.door },
      { id: 'thatch', prompt: '在斜木上铺几道草（可跳过）', fit: fitThatch, ghost: GHOST.thatch, optional: true },
    ],
    stats: shackStats, params: shackParams,
  },
  hearth: {
    id: 'hearth', name: '火塘', era: '第一代', cost: '石、木', place: 'point', blurb: '把营火围起来：更暖、更省柴，有棚顶不怕雨',
    steps: [
      { id: 'ring', prompt: '先用石头围一个圈', fit: fitRing, ghost: GHOST.ring },
      { id: 'wood', prompt: '在圈里架几根柴，交叉着架', fit: fitWood, ghost: GHOST.wood },
      { id: 'cover', prompt: '在火上方罩个棚顶（可跳过）', fit: fitCover, ghost: GHOST.cover, optional: true },
    ],
    stats: hearthStats, params: hearthParams,
  },
  rack: {
    id: 'rack', name: '晾肉架', era: '第一代', cost: '木', place: 'point', blurb: '鲜肉鲜鱼两三天就坏，晾成干肉能放一个多月：过冬靠它',
    steps: [
      { id: 'posts', prompt: '先画两根竖着的立柱', fit: fitPosts, ghost: GHOST.posts },
      { id: 'bar', prompt: '在柱子顶上横搭一根杆子', fit: fitBar, ghost: GHOST.bar },
      { id: 'strips', prompt: '在横杆下挂几条肉（可跳过）', fit: fitStrips, ghost: GHOST.strips, optional: true },
    ],
    stats: rackStats, params: rackParams,
  },
  fence: {
    id: 'fence', name: '篱笆', era: '第一代', cost: '木', place: 'line', blurb: '挡野兽：画好样子，再回地图上用铅笔画出走向',
    steps: [
      { id: 'stakes', prompt: '先画一排竖着的木桩（至少三根）', fit: fitStakes, ghost: GHOST.stakes },
      { id: 'rails', prompt: '横着画一两道横档，把木桩连起来', fit: fitRails, ghost: GHOST.rails },
      { id: 'tips', prompt: '把桩头削尖（可跳过）', fit: fitTips, ghost: GHOST.tips, optional: true },
    ],
    stats: fenceStats, params: fenceParams,
  },
  bench: {
    id: 'bench', name: '石器台', era: '第一代', cost: '石、木', place: 'point', needs: 'knap', blurb: '打石器的地方：会打石器的人干活更快，琢磨手艺也快',
    steps: [
      { id: 'slab', prompt: '先画一块平平的石板', fit: fitSlab, ghost: GHOST.slab },
      { id: 'legs', prompt: '在石板底下垫两块石头', fit: fitLegs, ghost: GHOST.legs },
      { id: 'tools', prompt: '在台上摆几件石器（可跳过）', fit: fitTools, ghost: GHOST.tools, optional: true },
    ],
    stats: benchStats, params: benchParams,
  },
  trap: {
    id: 'trap', name: '陷阱', era: '第一代', cost: '木', place: 'point', needs: 'trap', blurb: '自己逮野物，狼踩进去多半扎死：放在营地外、林子边',
    steps: [
      { id: 'pit', prompt: '先挖个坑：画一个开口朝上的 U', fit: fitPit, ghost: GHOST.pit },
      { id: 'spikes', prompt: '在坑底插几根尖桩', fit: fitSpikes, ghost: GHOST.spikes },
      { id: 'lid', prompt: '在坑口铺一层草枝盖住（可跳过）', fit: fitLid, ghost: GHOST.lid, optional: true },
    ],
    stats: trapStats, params: trapParams,
  },
  altar1: {
    id: 'altar1', name: '祭坛·台基', era: '第一代 · 时代工程', cost: '石、木、墨', place: 'point', needs: 'knap', blurb: '大祭坛与墨池的第一段：拜神的台子，族人更虔诚',
    steps: [
      { id: 'base', prompt: '先画台基最底下一层：一道长横线', fit: fitBase, ghost: GHOST.base },
      { id: 'tiers', prompt: '往上画一两层，一层比一层窄', fit: fitTiers, ghost: GHOST.tiers },
      { id: 'stairs', prompt: '在正中画一道上去的台阶（可跳过）', fit: fitStairs, ghost: GHOST.stairs, optional: true },
    ],
    stats: altar1Stats, params: altar1Params,
  },
  altar2: {
    id: 'altar2', name: '祭坛·立石', era: '第一代 · 时代工程', cost: '石、木、墨', place: 'altar', needs: 'mural', blurb: '第二段：在台顶立起石头，刻上纹，虎不敢靠近',
    steps: [
      { id: 'stones', prompt: '在台顶立三块以上的石头，中间最高', fit: fitStones, ghost: GHOST.stones },
      { id: 'marks', prompt: '在石头上刻几道纹（可跳过）', fit: fitMarks, ghost: GHOST.marks, optional: true },
    ],
    stats: altar2Stats, params: altar2Params,
  },
  altar3: {
    id: 'altar3', name: '祭坛·墨池', era: '第一代 · 时代工程', cost: '石、木、墨', place: 'altar', needs: 'stars', blurb: '最后一段：祭坛前的墨池。修成后墨的上限翻倍，墨池里能看见远方',
    steps: [
      { id: 'pool', prompt: '在祭坛前围一个池子', fit: fitPool, ghost: GHOST.pool },
      { id: 'channels', prompt: '画一两道沟把水引进池里（可跳过）', fit: fitChannels, ghost: GHOST.channels, optional: true },
    ],
    stats: altar3Stats, params: altar3Params,
  },
  granary: {
    id: 'granary', name: '公共粮仓', era: '第二代', cost: '木、石', place: 'point', needs: 'granary', blurb: '高脚架仓：谷物能放好几季不坏，少招老鼠',
    steps: [
      { id: 'stilts', prompt: '先画至少两根竖直高脚木桩，架离地面', fit: fitStilts, ghost: GHOST.stilts },
      { id: 'walls', prompt: '在木桩顶上画出粮仓仓身', fit: fitWalls, ghost: GHOST.walls },
      { id: 'roof', prompt: '在仓身上方画屋顶遮雨（可跳过）', fit: fitGranaryRoof, ghost: GHOST.granaryRoof, optional: true },
    ],
    stats: granaryStats, params: granaryParams,
  },
  kiln: {
    id: 'kiln', name: '陶窑', era: '第二代', cost: '石、木', place: 'point', needs: 'pottery', blurb: '烧制陶罐的土窑：有了陶罐能久存谷物与干肉，防潮防鼠',
    steps: [
      { id: 'dome', prompt: '先画一个半圆拱形的窑室', fit: fitDome, ghost: GHOST.dome },
      { id: 'flue', prompt: '在窑顶上方画排烟的烟囱', fit: fitFlue, ghost: GHOST.flue },
      { id: 'mouth', prompt: '在窑腹底下开一个小火口（可跳过）', fit: fitMouth, ghost: GHOST.mouth, optional: true },
    ],
    stats: kilnStats, params: kilnParams,
  },
  timberhouse: {
    id: 'timberhouse', name: '木构房', era: '第二代', cost: '木、石', place: 'point', needs: 'timberhouse', blurb: '宽敞结实的木屋：让一家人按户同住，挡风遮雨',
    steps: [
      { id: 'pillars', prompt: '先画两根以上竖直的木立柱', fit: fitPillars, ghost: GHOST.pillars },
      { id: 'roof', prompt: '在立柱顶上画人字坡屋顶', fit: fitTimberRoof, ghost: GHOST.timberRoof },
      { id: 'base', prompt: '在立柱脚下画一道地基（可跳过）', fit: fitTimberBase, ghost: GHOST.timberBase, optional: true },
    ],
    stats: timberhouseStats, params: timberhouseParams,
  },
  pen: {
    id: 'pen', name: '畜栏', era: '第二代', cost: '木', place: 'point', needs: 'husbandry', blurb: '圈养牲畜的木栏：每天出产鲜肉，还能肥沃周围农田',
    steps: [
      { id: 'enclosure', prompt: '先画一道闭合的木围栏', fit: fitEnclosure, ghost: GHOST.enclosure },
      { id: 'trough', prompt: '在围栏里画一个食槽', fit: fitTrough, ghost: GHOST.trough },
      { id: 'shed', prompt: '在围栏上画个遮雨棚（可跳过）', fit: fitShed, ghost: GHOST.shed, optional: true },
    ],
    stats: penStats, params: penParams,
  },
  bridge: {
    id: 'bridge', name: '木桥', era: '第二代', cost: '木、石', place: 'river', needs: 'bridge', blurb: '跨河木桥：点河岸就能架起，过河挑粮再也不减速',
    steps: [
      { id: 'arch', prompt: '横着画一道长桥面或拱形桥身', fit: fitBridgeArch, ghost: GHOST.arch },
      { id: 'piers', prompt: '在桥面下面画至少两根竖直桥墩', fit: fitPiers, ghost: GHOST.piers },
      { id: 'rail', prompt: '在桥面上方加一道护栏（可跳过）', fit: fitRail, ghost: GHOST.rail, optional: true },
    ],
    stats: bridgeStats, params: bridgeParams,
  },
  pad: {
    id: 'pad', name: '发射台', era: '第八代', cost: '木、石、墨', place: 'point', demo: true, blurb: '远期样张：看图纸怎么随时代变复杂',
    steps: [
      { id: 'rocket', prompt: '先画直立的箭塔：两条竖边，顶上收尖', fit: fitRocket, ghost: GHOST.rocket },
      { id: 'tower', prompt: '在旁边画勤务塔：两条竖线，加几道横撑', fit: fitTower, ghost: GHOST.tower },
      { id: 'deck', prompt: '最后在底部画一条横向平台，托住两座塔', fit: fitDeck, ghost: GHOST.deck },
    ],
    stats: padStats,
  },
};

// 青铜图纸：轮廓确定后量质量；钟的口宽和铜腔比例单独决定声学参数。
const B = (a, b, c, d) => line(a, b, c, d);
const P = (...ps) => poly(ps);
const BRONZE_PLANS = {
  citywall: ['城墙', 'line', { stone: 30, wood: 8 }, '墙垛越整齐，守城时越能抵住压力', [
    ['画连续的城垛，间隔尽量匀', [P([.18,.48],[.18,.26],[.28,.26],[.28,.37],[.40,.37],[.40,.26],[.50,.26],[.50,.37],[.62,.37],[.62,.26],[.72,.26],[.72,.37],[.82,.37],[.82,.48])]],
    ['在城垛下画一道横着的墙基', [B(.16,.53,.84,.53)]],
  ]],
  palace: ['宫室', 'point', { wood: 24, stone: 18 }, '立法在这里颁行，稳住村落人心', [
    ['画三根殿柱', [B(.25,.31,.25,.57),B(.5,.31,.5,.57),B(.75,.31,.75,.57)]],
    ['在殿柱上画宽屋顶', [P([.13,.33],[.5,.13],[.87,.33],[.13,.33])]],
  ]],
  workshop: ['工坊', 'point', { wood: 15, stone: 8 }, '工匠有了地方打磨青铜，出货更多', [
    ['画工台和两条台脚', [B(.18,.42,.82,.42),B(.27,.42,.27,.61),B(.73,.42,.73,.61)]],
    ['在工台上画一把短柄工具', [B(.42,.31,.54,.4),B(.40,.34,.47,.27)]],
  ]],
  furnace: ['铸铜炉', 'point', { stone: 18, wood: 9 }, '每日消耗石料和柴，出铜、青铜', [
    ['画上窄下宽的炉腹', [P([.22,.56],[.34,.29],[.66,.29],[.78,.56],[.22,.56])]],
    ['在炉腹上面画中空烟颈', [P([.42,.29],[.42,.15],[.58,.15],[.58,.29])]],
  ]],
  market: ['市集', 'point', { wood: 22, stone: 7 }, '开放商队和邻邦物资交换', [
    ['画两张摊桌', [B(.16,.49,.46,.49),B(.54,.49,.84,.49),B(.23,.49,.23,.61),B(.77,.49,.77,.61)]],
    ['画一顶展开的棚，让两摊都能遮雨', [P([.14,.38],[.29,.22],[.71,.22],[.86,.38],[.14,.38])]],
  ]],
  temple: ['宗庙', 'point', { wood: 18, stone: 16 }, '祭祀安民，战前可以稳住士气', [
    ['画大门和两边的柱', [P([.39,.57],[.39,.36],[.61,.36],[.61,.57]),B(.24,.34,.24,.57),B(.76,.34,.76,.57)]],
    ['画上翘的庙檐', [P([.14,.25],[.25,.32],[.5,.17],[.75,.32],[.86,.25])]],
  ]],
  cartway: ['车道', 'line', { stone: 14, wood: 10 }, '村落运粮、商队和战车都走这条道', [
    ['画两道平行车辙', [B(.15,.32,.85,.32),B(.15,.48,.85,.48)]],
    ['在下面画两处横向压石', [B(.33,.29,.33,.51),B(.66,.29,.66,.51)]],
  ]],
  bell: ['大钟', 'point', { bronze: 24, wood: 13, stone: 12 }, '钟口宽则音低、传声远；钟身挺则余韵长', [
    ['画钟的剖面：两肩对称向外张开，底部闭合成钟口', [P([.19,.53],[.28,.45],[.31,.31],[.4,.18],[.6,.18],[.69,.31],[.72,.45],[.81,.53],[.19,.53])]],
    ['在钟顶接一个悬钮', [P([.43,.18],[.43,.10],[.57,.10],[.57,.18])]],
  ]],
};
for (const [id, [name, place, need, blurb, parts]] of Object.entries(BRONZE_PLANS)) {
  const params = values => {
    const shape = values.p0, detail = values.p1 || shape, quality = +((shape.q * 2 + detail.q) / 3).toFixed(2);
    const base = { citywall: 25, palace: 18, workshop: 14, furnace: 16, market: 14, temple: 16, cartway: 16, bell: 38 }[id];
    const work = Math.round(base * (1.22 - 0.22 * quality));
    if (id === 'bell') {
      const mouth = clamp(shape.w, .38, .84), ratio = clamp(shape.h / mouth, .34, 1.1);
      return { quality, work, need, hz: Math.round(286 - mouth * 145 + ratio * 58), reach: Math.round(375 + mouth * 470 + quality * 145), tone: +(ratio * quality).toFixed(2) };
    }
    return { quality, work, need, ...(id === 'citywall' ? { strength: Math.round(56 + 38 * quality) } : {}) };
  };
  BLUEPRINTS[id] = {
    id, name, place, era: '第三代', cost: Object.keys(need).map(k => ({ stone: '石', wood: '木', bronze: '青铜' })[k]).join('、'), blurb,
    steps: parts.map(([prompt, ghost], i) => {
      const ref = cloud(ghost), bg = bbox(ghost);
      return {
        id: `p${i}`, prompt, ghost,
        fit(strokes) {
          const c = cloud(strokes), b = bbox(strokes);
          const delta = c ? match(c, ref) : Infinity;
          if (!c || Math.max(b.w, b.h) < .075 || delta > .22 || Math.hypot(bg.cx - b.cx, bg.cy - b.cy) > .24) return { ok: false, msg: '照淡影把这一部分画清楚' };
          const q = clamp(1 - delta * 3.1, .36, 1);
          return { ok: true, q, w: b.w, h: b.h, msg: `齐整 ${Math.round(q * 100)}%` };
        },
      };
    }),
    params, stats(values) {
      const v = params(values);
      return [{ k: '齐整', x: v.quality, why: '笔画越贴合轮廓越齐整' },
        ...(id === 'bell' ? [{ k: '音高', v: `${v.hz} Hz` }, { k: '传声', v: `${v.reach} 步` }] : id === 'citywall' ? [{ k: '基础城防', v: `${v.strength}` }] : []),
        { k: '工时', v: `${v.work} 小时` },
        { k: '用料', v: Object.entries(need).map(([k, n]) => `${({ wood: '木', stone: '石', bronze: '铜' })[k]} ${n}`).join('、') }];
    },
  };
}

// 一张图纸的进度：按步骤喂笔画，量这一步；ok 才进下一步
export class BlueprintSession {
  constructor(id) {
    this.bp = BLUEPRINTS[id];
    this.i = 0;
    this.parts = {};
    this.strokes = {};
    this.last = null;
  }
  get step() { return this.bp.steps[this.i] || null; }
  get done() { return this.i >= this.bp.steps.length; }
  // 这一步的笔画（可多笔）。返回量的结果；ok 就记下并进下一步
  submit(strokes) {
    const st = this.step;
    if (!st) return null;
    const res = st.fit(strokes, this.parts);
    this.last = res;
    if (res.ok) { this.parts[st.id] = res; this.strokes[st.id] = strokes; this.i++; }
    return res;
  }
  skip() {
    const st = this.step;
    if (st?.optional) { this.parts[st.id] = st.fit([], this.parts); this.strokes[st.id] = []; this.i++; }
  }
  stats() { return this.parts[this.bp.steps[0].id] ? this.bp.stats(this.parts) : []; }
  // 交给模拟的数值（不带 q 这些中间量）
  params() {
    if (!this.bp.params || !this.parts[this.bp.steps[0].id]) return null;
    const { q, pitch, ...p } = this.bp.params(this.parts);
    return p;
  }
}
