// 朱笔：线只取几何，红符只有两个，形状差得远，用规则判，不用模型。
//   - 一长笔：封锁线；首尾相接圈起来：禁区。
//   - 一小笔短直线横穿你自己的一条封锁线：启封（划破那条线）。
//   - 小小的 ✕（两笔直线相交）：禁；小小的 ○（一笔闭合的圆）：护。
// 门槛按屏幕像素定（手底下画多大）。笔画用纸面坐标时，scale 传「1 屏幕像素合多少纸面单位」。

import { length, straightness, gapRatio, bbox, segIntersect, crossings, area, resample } from './geom.js';

export const RED = { long: 150, slashMax: 170, symbolMax: 110, closeGap: 0.12, zoneArea: 2500 };

// 抬笔时先看这一笔：返回 { kind: 'line' | 'zone' | 'unseal' | 'symbol-part' }
export function classifyRedStroke(s, lines = [], scale = 1) {
  const L = length(s), st = straightness(s);
  if (L < 4) return { kind: 'symbol-part' };
  // 启封：一刀短直线横穿自己的某条线
  if (L < RED.slashMax * scale && st > 0.8) {
    const hit = lines.findIndex(l => crossings(s, l.points).length > 0);
    if (hit >= 0) return { kind: 'unseal', line: hit };
  }
  if (L >= RED.long * scale) {
    const gap = gapRatio(s);
    if (gap < RED.closeGap && area(s) > RED.zoneArea * scale * scale) return { kind: 'zone', points: s, length: L };
    return { kind: 'line', points: s, length: L };
  }
  return { kind: 'symbol-part' };
}

// 断笔接回去：去掉手滑的小点，首尾挨着、方向一致的两笔并成一笔
export function mergeBroken(strokes) {
  let S = strokes.filter(s => s.length > 1);
  const b = bbox(S), span = Math.max(b.w, b.h) || 1;
  S = S.filter(s => length(s) > 0.12 * span);
  const dir = (s, atEnd) => {
    const a = atEnd ? s[Math.max(0, s.length - 4)] : s[Math.min(s.length - 1, 3)], o = atEnd ? s[s.length - 1] : s[0];
    return Math.atan2(o.y - a.y, o.x - a.x); // 指向笔画外面
  };
  // A 的尾接 B 的头：缺口小，且 A 收笔的方向和 B 起笔的方向一致
  const joins = (A, B) => {
    const e = A[A.length - 1], f = B[0];
    if (Math.hypot(e.x - f.x, e.y - f.y) > 0.18 * span) return false;
    const diff = Math.abs(((dir(A, true) - dir(B, false) - Math.PI + 4 * Math.PI) % (2 * Math.PI)) - Math.PI);
    return Math.PI - diff < 0.45;
  };
  // 每次只并一对，并完从头再找（并过之后下标就变了，不能接着用）
  const joinOnce = () => {
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const Si = S[i], Sj = S[j];
      for (const A of [Si, Si.slice().reverse()]) for (const B of [Sj, Sj.slice().reverse()]) {
        if (!joins(A, B)) continue;
        S = S.filter((_, k) => k !== i && k !== j);
        S.push([...A, ...B]);
        return true;
      }
    }
    return false;
  };
  while (S.length > 1 && joinOnce());
  return S;
}

// 一笔一共转了几圈（各段转角绝对值之和 ÷ 360°）：圆约 1 圈，方、三角略多，乱线、螺旋、星形多得多
function turns(s) {
  const q = resample(s, 40);
  let tot = 0;
  for (let i = 2; i < q.length; i++) {
    let d = Math.atan2(q[i].y - q[i - 1].y, q[i].x - q[i - 1].x) - Math.atan2(q[i - 1].y - q[i - 2].y, q[i - 1].x - q[i - 2].x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    tot += Math.abs(d);
  }
  return tot / (2 * Math.PI);
}

// 收笔后的小红符：✕ 禁 / ○ 护 / 认不出
export function classifyRedSymbol(strokes, scale = 1) {
  const S = mergeBroken(strokes);
  const b = bbox(S);
  if (!S.length || Math.max(b.w, b.h) > RED.symbolMax * 1.6 * scale) return { kind: 'unknown', why: '太大了：大的红线是封锁线' };
  if (S.length === 1) {
    // ○：一笔圈起来（圆的、方的、三角的都算），首尾接上、不太扁、不是绕好几圈的乱线
    const s = S[0], L = length(s) || 1, size = Math.max(b.w, b.h) || 1;
    const gap = Math.hypot(s[0].x - s[s.length - 1].x, s[0].y - s[s.length - 1].y);
    const aspect = Math.max(b.w, b.h) / (Math.min(b.w, b.h) || 1e-6);
    let cx = 0, cy = 0;
    for (const p of s) { cx += p.x; cy += p.y; }
    cx /= s.length; cy /= s.length;
    const R = s.map(p => Math.hypot(p.x - cx, p.y - cy)), mr = R.reduce((a, c) => a + c, 0) / R.length;
    const cv = Math.sqrt(R.reduce((a, c) => a + (c - mr) ** 2, 0) / R.length) / (mr || 1); // 各点到中心远近的离散程度
    const tu = turns(s);
    if (gap / L < 0.22 && gap / size < 0.3 && aspect < 2.2 && tu < 2.4 && cv < 0.3) return { kind: 'guard', round: 1 - cv, turns: tu };
    return { kind: 'unknown', why: '○ 要一笔圈起来、首尾接上' };
  }
  if (S.length === 2) {
    const [a, c] = S;
    if (straightness(a) > 0.82 && straightness(c) > 0.82) {
      const q = segIntersect(a[0], a[a.length - 1], c[0], c[c.length - 1]);
      if (q && q.t > 0.15 && q.t < 0.85 && q.u > 0.15 && q.u < 0.85) {
        const ang = Math.abs(Math.atan2(a[a.length - 1].y - a[0].y, a[a.length - 1].x - a[0].x) - Math.atan2(c[c.length - 1].y - c[0].y, c[c.length - 1].x - c[0].x)) % Math.PI;
        const deg = ang * 180 / Math.PI;
        if (deg > 40 && deg < 140) return { kind: 'forbid', angle: deg };
      }
    }
    return { kind: 'unknown', why: '✕ 要两笔直线，在中间交叉' };
  }
  return { kind: 'unknown', why: '朱笔只认 ✕（禁）和 ○（护）' };
}

// 封锁线的承受度（临界值）：线越长越薄。len 为纸面长度（玩法数值不随屏幕缩放变），返回 40..120
export const endurance = len => Math.round(Math.max(40, Math.min(120, 140 - len / 8)));
