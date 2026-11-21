// 点云模板（$P，思路同墨灵 glyph.js）：把一个符的全部笔画等距取 N 个点，缩放到单位大小、质心移到原点，
// 再和模板逐点贪心配对，算加权平均距离。不看笔顺和方向，只看形状与比例；靠它给 CNN 做第二票。
import { bbox, length, resample } from './geom.js';

export const N = 32;
const WSUM = (N + 1) / 2;
export const STROKE_PEN = 0.015; // 笔数每差一笔多算的距离

export function cloud(strokes) {
  let S = strokes.filter(s => s && s.length);
  if (!S.length) return null;
  if (S.length > N / 2) S = [S.flat()]; // 笔太碎：当一笔
  const b = bbox(S), span = Math.max(b.w, b.h) || 1;
  // 每笔按长短分点；太短的笔（如点）至少按 4% 的长度算，好让「点」也占一个点
  const eff = S.map(s => Math.max(length(s), 0.04 * span));
  const total = eff.reduce((a, c) => a + c, 0);
  const counts = eff.map(l => Math.max(1, Math.round(N * l / total)));
  let diff = N - counts.reduce((a, c) => a + c, 0);
  const order = eff.map((l, i) => i).sort((i, j) => eff[j] - eff[i]);
  for (let k = 0; diff !== 0 && k < 1000; k++) {
    const i = order[k % order.length];
    if (diff > 0) { counts[i]++; diff--; } else if (counts[i] > 1) { counts[i]--; diff++; }
  }
  const pts = [];
  S.forEach((s, i) => { for (const p of resample(s, counts[i])) pts.push(p); });
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= N; cy /= N;
  const xy = new Float64Array(2 * N);
  pts.forEach((p, i) => { xy[2 * i] = (p.x - cx) / span; xy[2 * i + 1] = (p.y - cy) / span; });
  return { xy, ns: S.length };
}

const matched = new Uint8Array(N);
function cloudDist(A, B, start, best) {
  matched.fill(0);
  let sum = 0, i = start;
  do {
    const ax = A[2 * i], ay = A[2 * i + 1];
    let min = Infinity, idx = 0;
    for (let j = 0; j < N; j++) {
      if (matched[j]) continue;
      const dx = ax - B[2 * j], dy = ay - B[2 * j + 1], d = dx * dx + dy * dy;
      if (d < min) { min = d; idx = j; }
    }
    matched[idx] = 1;
    sum += (1 - ((i - start + N) % N) / N) * Math.sqrt(min);
    if (sum >= best) return sum;
    i = (i + 1) % N;
  } while (i !== start);
  return sum;
}

// 归一化距离（约 0..0.5，越小越像）。bound：已知的最好成绩，超过就提前放弃并返回 Infinity
export function match(a, b, bound = Infinity) {
  const pen = STROKE_PEN * Math.abs(a.ns - b.ns);
  let raw = (bound - pen) * WSUM;
  if (raw <= 0) return Infinity;
  const step = Math.floor(Math.sqrt(N));
  let min = raw;
  for (let i = 0; i < N; i += step) {
    min = Math.min(min, cloudDist(a.xy, b.xy, i, min));
    min = Math.min(min, cloudDist(b.xy, a.xy, i, min));
  }
  return min >= raw ? Infinity : min / WSUM + pen;
}
