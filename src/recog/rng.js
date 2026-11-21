// 可复现的随机数：同一个种子在 Node 和浏览器里出同一串数。
// 合成样本、出厂模板、训练初始化都靠它，所以测试和评测能逐条复现。

export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = n => Math.floor(r() * n);
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.chance = p => r() < p;
  let spare = null;
  r.normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = r() * 2 - 1; v = r() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    return u * m;
  };
  // 按权重挑：items 为 [[权重, 值], ...]
  r.weighted = items => {
    let total = 0;
    for (const [w] of items) total += w;
    let x = r() * total;
    for (const [w, v] of items) { if ((x -= w) < 0) return v; }
    return items[items.length - 1][1];
  };
  return r;
}

// 「标准写法」用的随机源：每个参数取区间正中，每个「偶尔」都不发生，挑选取第一个。
export function midRng() {
  const r = () => 0.5;
  r.range = (lo, hi) => (lo + hi) / 2;
  r.int = () => 0;
  r.pick = arr => arr[0];
  r.chance = () => false;
  r.normal = () => 0;
  r.weighted = items => items[0][1];
  return r;
}

// 把若干字符串或数字揉成一个 32 位种子（FNV-1a）
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0x2f; h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
