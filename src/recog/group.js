// 符圈：墨笔落下，周围浮出一个淡淡的圈，圈里的笔画算同一个符。
//   - 停笔约 0.45 秒就收笔去认；会按你自己的落笔节奏放宽，最多 0.9 秒。
//   - 鼠标（或悬停的笔）在圈里挪动，是在找下一笔的起点：倒计时从最后一次挪动重新算，
//     最多等到抬笔后 holdMax（2.4 秒）。不挪了、或挪出圈，照常倒计时。
//     （用鼠标写多笔的符，笔画之间挪鼠标要 0.25–0.9 秒；只按 0.45 秒算，65% 的多笔符会被切成两半。）
//   - 收好的符没认出来（或在等你选），resumeMs（1.5 秒）内在它的圈里接着落笔：算接着写，
//     和前面的笔画拼成一个符。要调用方 park() 告诉它「这个没认出来」。
//   - 在圈上或圈外点一下：立刻收笔（这一点不算笔画）。圈里点一下是「点」（比如日中间那一点）。
//   - 在圈外起笔：旧圈立刻收笔，新笔开一个新圈。
//   - 圈按已写笔画外接框的半对角线放大 grow 倍（默认 2）再加 pad：先写树干、紧接着写树冠时，
//     树冠的起笔还在圈里（按 1 倍算，快写时 280 像素大的符有 23% 被切成两半；2 倍约 1%）。
// 只管分组和计时，不画、不认；时间 t 由调用方给（毫秒），测试里可以用假时钟。

export class InkGrouper {
  constructor({ pause = 450, maxPause = 900, pad = 26, minRadius = 42, tapLen = 7, tapMs = 260, grow = 2, holdMax = 2400, hoverMin = 3, resumeMs = 1500 } = {}) {
    Object.assign(this, { basePause: pause, maxPause, pad, minRadius, tapLen, tapMs, grow, holdMax, hoverMin, resumeMs });
    this.gaps = [];
    this.group = null;
    this.cur = null;
    this.parked = null;
  }

  // 停笔多久算写完：0.45 秒起，若你下笔前常停得久，放宽到你中位间隔的 2.2 倍（不超过 0.9 秒）。
  // 间隔从「抬笔或鼠标最后一次在圈里挪动」算到下一笔落下：鼠标挪过去的那段不算停。
  get pause() {
    if (this.gaps.length < 4) return this.basePause;
    const g = [...this.gaps].sort((a, b) => a - b), med = g[g.length >> 1];
    return Math.max(this.basePause, Math.min(this.maxPause, med * 2.2));
  }

  get drawing() { return !!this.cur; }

  ring(strokes = this.group?.strokes) {
    if (!strokes?.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) for (const p of s) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    if (x0 === Infinity) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { cx, cy, r: Math.max(this.minRadius, Math.hypot(x1 - x0, y1 - y0) / 2 * this.grow + this.pad) };
  }

  inside(p, rg = this.ring()) {
    return !!rg && Math.hypot(p.x - rg.cx, p.y - rg.cy) <= rg.r - 6;
  }

  // 倒计时从哪一刻算起：抬笔，或之后鼠标在圈里最后一次挪动；最晚拖到抬笔后 holdMax 收笔
  idleFrom() {
    const g = this.group;
    return Math.min(Math.max(g.lastUp, g.lastMove || 0), g.lastUp + Math.max(0, this.holdMax - this.pause));
  }

  // 落笔。在圈外（含圈线上）落笔，旧圈立刻收笔并返回。
  // 没有圈、但刚收的那个没认出来（park 过）且落在它的圈里：接着写（新圈的 resumed 指向旧的那组）
  down(p, t) {
    let closed = null;
    if (this.group) {
      if (this.inside(p)) {
        this.gaps.push(t - this.idleFrom());
        if (this.gaps.length > 20) this.gaps.shift();
      } else closed = this.close();
    }
    const k = this.parked;
    this.parked = null;
    if (!this.group) {
      const resumed = !closed && k && t - k.t <= this.resumeMs && this.inside(p, k.ring) ? k.group : null;
      this.group = resumed
        ? { strokes: [...resumed.strokes], t0: resumed.t0, lastUp: t, opener: false, resumed }
        : { strokes: [], t0: t, lastUp: t, opener: !!closed };
    }
    this.cur = [{ x: p.x, y: p.y, t }];
    this.group.strokes.push(this.cur);
    this.downAt = t;
    return closed;
  }

  move(p, t) {
    if (this.cur) this.cur.push({ x: p.x, y: p.y, t });
  }

  // 没按着时鼠标的位置（悬停）：在圈里挪了 hoverMin 以上，倒计时重新算
  hover(p, t) {
    const g = this.group;
    if (!g || this.cur || !this.holdMax || !this.inside(p)) return;
    const a = g.hoverAt;
    if (a && Math.hypot(p.x - a.x, p.y - a.y) < this.hoverMin) return;
    g.hoverAt = { x: p.x, y: p.y };
    if (a) g.lastMove = t;
  }

  // 抬笔。圈外点一下只为收笔：这一点丢掉，返回 { tapped: true }
  up(t) {
    const g = this.group, s = this.cur;
    this.cur = null;
    if (!g || !s) return {};
    g.lastUp = t;
    g.lastMove = 0;
    g.hoverAt = s.length ? { x: s[s.length - 1].x, y: s[s.length - 1].y } : null;
    let len = 0;
    for (let i = 1; i < s.length; i++) len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
    const isTap = len < this.tapLen && t - this.downAt < this.tapMs;
    if (isTap && g.strokes.length === 1 && g.opener) {
      this.group = null;
      return { tapped: true };
    }
    return {};
  }

  // 每帧调用：停笔够久就收笔，返回收好的圈
  tick(t) {
    if (!this.group || this.cur) return null;
    return t - this.idleFrom() >= this.pause ? this.close() : null;
  }

  // 收笔进度 0..1（给符圈画倒计时用；鼠标在圈里挪动时回到 0）
  progress(t) {
    if (!this.group || this.cur) return 0;
    return Math.max(0, Math.min(1, (t - this.idleFrom()) / this.pause));
  }

  close() {
    const g = this.group;
    this.group = null;
    this.cur = null;
    this.parked = null;
    if (!g) return null;
    const strokes = g.strokes.filter(s => s.length);
    return strokes.length ? { strokes, t0: g.t0, t1: g.lastUp, resumed: g.resumed || null } : null;
  }

  // 刚收的这组没认出来（或在等你选）：resumeMs 内在它的圈里落笔，就接着写
  park(group, t) {
    if (!group || !this.resumeMs || this.group) return;
    this.parked = { group, t, ring: this.ring(group.strokes) };
  }

  cancel() { this.group = null; this.cur = null; this.parked = null; }
}
