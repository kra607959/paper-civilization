// 小卷积网：32×32 灰度 → 三层 3×3 卷积（8/16/32 通道，各接 ReLU 和 2×2 最大池化）
// → 64 维特征（个人原型就比这串特征）→ 11 类（十符 + 乱画）。
// 只用定型数组和循环：Node 里训练（tools/train.mjs），浏览器里推理，两边同一份代码。

export const ARCH = { size: 32, conv: [8, 16, 32], embed: 64, classes: 11 };

// 全部参数排在一个数组里：c1w c1b c2w c2b c3w c3b f1w f1b f2w f2b
export function layout(arch = ARCH) {
  const tensors = [];
  let off = 0, c = 1;
  const add = (name, shape) => {
    const n = shape.reduce((a, b) => a * b, 1);
    tensors.push({ name, shape, off, n });
    off += n;
  };
  arch.conv.forEach((k, i) => { add(`c${i + 1}w`, [k, c, 3, 3]); add(`c${i + 1}b`, [k]); c = k; });
  const s = arch.size >> arch.conv.length;
  const flatN = c * s * s;
  add('f1w', [arch.embed, flatN]); add('f1b', [arch.embed]);
  add('f2w', [arch.classes, arch.embed]); add('f2b', [arch.classes]);
  return { arch, tensors, total: off, flatN };
}

// 网络 = 参数数组 P 上的一组视图 + 前向缓存。P 可以是 Float32Array（实用）或 Float64Array（梯度检验）。
export function createNet(P, arch = ARCH) {
  const L = layout(arch);
  if (P.length !== L.total) throw new Error(`参数个数不对：要 ${L.total}，给了 ${P.length}`);
  const F = P.constructor;
  const v = {};
  for (const t of L.tensors) v[t.name] = P.subarray(t.off, t.off + t.n);
  const layers = [];
  let C = 1, H = arch.size;
  arch.conv.forEach((K, i) => {
    layers.push({
      C, K, H, W: H, w: v[`c${i + 1}w`], b: v[`c${i + 1}b`], wName: `c${i + 1}w`, bName: `c${i + 1}b`,
      inp: new F(C * H * H), z: new F(K * H * H), pool: new F(K * (H >> 1) * (H >> 1)), idx: new Int32Array(K * (H >> 1) * (H >> 1)),
    });
    C = K; H >>= 1;
  });
  return {
    arch, L, P, v, layers,
    h: new F(arch.embed), e: new F(arch.embed), logits: new F(arch.classes), probs: new F(arch.classes),
    // 反向用的草稿
    dz: layers.map(l => new F(l.K * l.H * l.W)), dinp: layers.map(l => new F(l.C * l.H * l.W)),
    dflat: new F(L.flatN), dh: new F(arch.embed), de: new F(arch.embed),
  };
}

// He 初始化
export function initParams(P, rng, arch = ARCH) {
  const L = layout(arch);
  for (const t of L.tensors) {
    if (t.name.endsWith('b')) { P.fill(0, t.off, t.off + t.n); continue; }
    const fanIn = t.shape.slice(1).reduce((a, b) => a * b, 1);
    const std = t.name === 'f2w' ? Math.sqrt(1 / fanIn) : Math.sqrt(2 / fanIn);
    for (let i = 0; i < t.n; i++) P[t.off + i] = rng.normal() * std;
  }
  return P;
}

function conv3(inp, C, H, W, w, b, K, out) {
  const HW = H * W;
  for (let k = 0; k < K; k++) {
    const ok = k * HW;
    out.fill(b[k], ok, ok + HW);
    for (let c = 0; c < C; c++) {
      const ic = c * HW, wk = (k * C + c) * 9;
      for (let dy = -1; dy <= 1; dy++) {
        const y0 = dy < 0 ? 1 : 0, y1 = dy > 0 ? H - 1 : H;
        for (let dx = -1; dx <= 1; dx++) {
          const wv = w[wk + (dy + 1) * 3 + dx + 1];
          const x0 = dx < 0 ? 1 : 0, x1 = dx > 0 ? W - 1 : W;
          for (let y = y0; y < y1; y++) {
            const orow = ok + y * W, irow = ic + (y + dy) * W + dx;
            for (let x = x0; x < x1; x++) out[orow + x] += wv * inp[irow + x];
          }
        }
      }
    }
  }
}

function conv3Back(inp, C, H, W, w, K, dout, dW, db, dinp) {
  const HW = H * W;
  if (dinp) dinp.fill(0);
  for (let k = 0; k < K; k++) {
    const ok = k * HW;
    let sb = 0;
    for (let i = 0; i < HW; i++) sb += dout[ok + i];
    db[k] += sb;
    if (sb === 0) { // 整张图梯度为零（ReLU 全关）时跳过
      let any = false;
      for (let i = 0; i < HW; i++) if (dout[ok + i] !== 0) { any = true; break; }
      if (!any) continue;
    }
    for (let c = 0; c < C; c++) {
      const ic = c * HW, wk = (k * C + c) * 9;
      for (let dy = -1; dy <= 1; dy++) {
        const y0 = dy < 0 ? 1 : 0, y1 = dy > 0 ? H - 1 : H;
        for (let dx = -1; dx <= 1; dx++) {
          const wi = wk + (dy + 1) * 3 + dx + 1, wv = w[wi];
          const x0 = dx < 0 ? 1 : 0, x1 = dx > 0 ? W - 1 : W;
          let acc = 0;
          for (let y = y0; y < y1; y++) {
            const orow = ok + y * W, irow = ic + (y + dy) * W + dx;
            if (dinp) {
              for (let x = x0; x < x1; x++) {
                const g = dout[orow + x];
                if (g !== 0) { acc += g * inp[irow + x]; dinp[irow + x] += g * wv; }
              }
            } else {
              for (let x = x0; x < x1; x++) { const g = dout[orow + x]; if (g !== 0) acc += g * inp[irow + x]; }
            }
          }
          dW[wi] += acc;
        }
      }
    }
  }
}

// ReLU 后 2×2 最大池化；idx 记下赢家位置
function reluPool(z, K, H, W, out, idx) {
  const Ho = H >> 1, Wo = W >> 1;
  for (let i = 0; i < z.length; i++) if (z[i] < 0) z[i] = 0;
  for (let k = 0; k < K; k++) for (let y = 0; y < Ho; y++) for (let x = 0; x < Wo; x++) {
    const i0 = k * H * W + 2 * y * W + 2 * x;
    let bi = i0, bv = z[i0];
    if (z[i0 + 1] > bv) { bv = z[i0 + 1]; bi = i0 + 1; }
    if (z[i0 + W] > bv) { bv = z[i0 + W]; bi = i0 + W; }
    if (z[i0 + W + 1] > bv) { bv = z[i0 + W + 1]; bi = i0 + W + 1; }
    const o = k * Ho * Wo + y * Wo + x;
    out[o] = bv; idx[o] = bi;
  }
}

export function softmax(z, out) {
  let m = -Infinity;
  for (let i = 0; i < z.length; i++) if (z[i] > m) m = z[i];
  let s = 0;
  for (let i = 0; i < z.length; i++) { out[i] = Math.exp(z[i] - m); s += out[i]; }
  for (let i = 0; i < z.length; i++) out[i] /= s;
  return out;
}

// 前向。x 为 size×size 的墨图。结果留在 net.logits / net.probs / net.e（64 维特征，ReLU 后）
export function forward(net, x) {
  const { layers, v, arch } = net;
  let inp = x;
  for (const l of layers) {
    l.inp.set(inp);
    conv3(l.inp, l.C, l.H, l.W, l.w, l.b, l.K, l.z);
    reluPool(l.z, l.K, l.H, l.W, l.pool, l.idx);
    inp = l.pool;
  }
  const flatIn = inp, N = flatIn.length, E = arch.embed;
  const f1w = v.f1w, f1b = v.f1b;
  for (let j = 0; j < E; j++) {
    let s = f1b[j];
    const row = j * N;
    for (let i = 0; i < N; i++) s += f1w[row + i] * flatIn[i];
    net.h[j] = s;
    net.e[j] = s > 0 ? s : 0;
  }
  const f2w = v.f2w, f2b = v.f2b, K = arch.classes;
  for (let j = 0; j < K; j++) {
    let s = f2b[j];
    for (let i = 0; i < E; i++) s += f2w[j * E + i] * net.e[i];
    net.logits[j] = s;
  }
  softmax(net.logits, net.probs);
  return net;
}

// 交叉熵（带标签平滑）对 logits 的梯度写进 dlogits，返回损失
export function xentGrad(probs, label, dlogits, smooth = 0.05, weight = 1) {
  const K = probs.length, off = smooth / K;
  let loss = 0;
  for (let i = 0; i < K; i++) {
    const t = (i === label ? 1 - smooth : 0) + off;
    dlogits[i] = (probs[i] - t) * weight;
    if (t > 0) loss -= t * Math.log(Math.max(probs[i], 1e-12));
  }
  return loss * weight;
}

// 反向：把这一条样本的梯度加进 G（与 P 同布局）。须紧跟在同一条样本的 forward 之后。
export function backward(net, dlogits, G) {
  const { layers, v, arch, L } = net;
  const g = {};
  for (const t of L.tensors) g[t.name] = G.subarray(t.off, t.off + t.n);
  const E = arch.embed, K = arch.classes, N = L.flatN;
  const last = layers[layers.length - 1];
  const flatIn = last.pool;
  // f2
  const de = net.de.fill(0);
  for (let j = 0; j < K; j++) {
    const d = dlogits[j];
    g.f2b[j] += d;
    for (let i = 0; i < E; i++) { g.f2w[j * E + i] += d * net.e[i]; de[i] += v.f2w[j * E + i] * d; }
  }
  // ReLU + f1
  const dflat = net.dflat.fill(0);
  for (let j = 0; j < E; j++) {
    const d = net.h[j] > 0 ? de[j] : 0;
    if (d === 0) continue;
    g.f1b[j] += d;
    const row = j * N;
    for (let i = 0; i < N; i++) { g.f1w[row + i] += d * flatIn[i]; dflat[i] += v.f1w[row + i] * d; }
  }
  // 卷积层倒着走
  let dpool = dflat;
  for (let li = layers.length - 1; li >= 0; li--) {
    const l = layers[li], dz = net.dz[li].fill(0);
    for (let o = 0; o < dpool.length; o++) {
      const i = l.idx[o];
      if (l.z[i] > 0) dz[i] += dpool[o]; // z 已就地做过 ReLU：>0 才有梯度
    }
    const dinp = li > 0 ? net.dinp[li] : null;
    conv3Back(l.inp, l.C, l.H, l.W, l.w, l.K, dz, g[l.wName], g[l.bName], dinp);
    dpool = dinp;
  }
}

// AdamW：wd 只作用在权重上（不含偏置）
export function createAdam(P, arch = ARCH) {
  const L = layout(arch);
  const decay = new Uint8Array(P.length);
  for (const t of L.tensors) if (t.name.endsWith('w')) decay.fill(1, t.off, t.off + t.n);
  return { m: new Float32Array(P.length), v: new Float32Array(P.length), t: 0, decay };
}

export function adamStep(P, G, opt, lr, { b1 = 0.9, b2 = 0.999, eps = 1e-8, wd = 1e-4 } = {}) {
  opt.t++;
  const c1 = 1 - Math.pow(b1, opt.t), c2 = 1 - Math.pow(b2, opt.t);
  const { m, v, decay } = opt;
  for (let i = 0; i < P.length; i++) {
    const g = G[i];
    m[i] = b1 * m[i] + (1 - b1) * g;
    v[i] = b2 * v[i] + (1 - b2) * g * g;
    P[i] -= lr * ((m[i] / c1) / (Math.sqrt(v[i] / c2) + eps) + (decay[i] ? wd * P[i] : 0));
  }
}

// ---- 存取：权重按输出通道量化成 int8（每通道一个比例），偏置留 float32 ----

const b64enc = bytes => (typeof Buffer !== 'undefined' ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  : btoa(Array.from(bytes, c => String.fromCharCode(c)).join('')));
function b64dec(str) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(str, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function packParams(P, arch = ARCH) {
  const L = layout(arch), tensors = {};
  for (const t of L.tensors) {
    const a = P.subarray(t.off, t.off + t.n);
    if (t.name.endsWith('b')) { tensors[t.name] = { shape: t.shape, f32: b64enc(new Uint8Array(Float32Array.from(a).buffer)) }; continue; }
    const rows = t.shape[0], per = t.n / rows, q = new Int8Array(t.n), scale = [];
    for (let k = 0; k < rows; k++) {
      let mx = 0;
      for (let i = 0; i < per; i++) mx = Math.max(mx, Math.abs(a[k * per + i]));
      const s = mx / 127 || 1e-8;
      scale.push(+s.toPrecision(7));
      for (let i = 0; i < per; i++) q[k * per + i] = Math.max(-127, Math.min(127, Math.round(a[k * per + i] / scale[k])));
    }
    tensors[t.name] = { shape: t.shape, scale, i8: b64enc(new Uint8Array(q.buffer)) };
  }
  return { arch, tensors };
}

export function unpackParams(packed) {
  const arch = packed.arch || ARCH, L = layout(arch), P = new Float32Array(L.total);
  for (const t of L.tensors) {
    const e = packed.tensors[t.name];
    if (!e) throw new Error(`模型缺少 ${t.name}`);
    const bytes = b64dec(e.f32 || e.i8);
    if (e.f32) { P.set(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), t.off); continue; }
    const q = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), per = t.n / t.shape[0];
    for (let i = 0; i < t.n; i++) P[t.off + i] = q[i] * e.scale[Math.floor(i / per)];
  }
  return { arch, P };
}
