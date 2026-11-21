// 青铜新符独立用点云，不改变第一代 CNN 类别或旧个人原型。
import { poly, arc, bbox } from './geom.js';
import { cloud, match } from './pcloud.js';

const P = (...pts) => poly(pts);
export const BRONZE_GLYPHS = {
  recruit: { name: '征召', ink: 3, hint: '一面尖旗，脚下加一横', strokes: [P([.15,.8],[.15,.18],[.8,.36],[.15,.52]), P([.15,.8],[.35,.8])] },
  patrol: { name: '巡逻', ink: 2, hint: '绕一圈，在缺口画一个箭头', strokes: [arc(.48,.52,.33,.29,-.7,5.31), P([.61,.15],[.81,.29],[.65,.42])] },
  guard: { name: '守城', ink: 3, hint: '一面盾形，盾里面画一横', strokes: [P([.16,.2],[.83,.2],[.78,.63],[.5,.87],[.22,.63],[.16,.2]), P([.28,.49],[.72,.49])] },
  trade: { name: '贸易', ink: 2, hint: '两道反向的横箭头', strokes: [P([.18,.37],[.8,.37],[.67,.23]), P([.82,.62],[.17,.62],[.31,.76])] },
  ritual: { name: '祭祀', ink: 4, hint: '一只托盘，上面三道香', strokes: [P([.16,.56],[.34,.74],[.66,.74],[.84,.56]), P([.32,.42],[.32,.29]), P([.5,.42],[.5,.16]), P([.68,.42],[.68,.29])] },
};

const normalizedPart = (strokes, x) => {
  const b = bbox(strokes), scale = .42 / Math.max(b.w, b.h);
  return strokes.map(s => s.map(p => ({ x: x + (p.x - b.cx) * scale, y: .5 + (p.y - b.cy) * scale })));
};
BRONZE_GLYPHS.peace = {
  name: '安', ink: 4, hint: '同一个圈里，左边画盾，右边画香盘（守城＋祭祀）',
  strokes: [...normalizedPart(BRONZE_GLYPHS.guard.strokes, .27), ...normalizedPart(BRONZE_GLYPHS.ritual.strokes, .73)],
};
const prototypes = Object.entries(BRONZE_GLYPHS).map(([id, g]) => [id, cloud(g.strokes)]);
export const bronzeIds = ctx => ctx === 'city' ? ['recruit', 'patrol', 'guard', 'ritual', 'peace'] : ctx === 'polis' ? ['trade'] : null;

export function recognizeBronze(strokes, ids) {
  const c = cloud(strokes);
  if (!c) return { decision: 'reject', choices: [] };
  const all = prototypes.map(([id, p]) => ({ id, d: match(p, c) })).sort((a, b) => a.d - b.d);
  const [first, second] = all;
  const out = { top: first.id, global: first.id, pGlobal: 0, choices: [] };
  if (first.d > .115) return { ...out, decision: 'reject' };
  if (!ids.includes(first.id)) return { ...out, pGlobal: 1, decision: 'elsewhere' };
  if (first.d <= .082 && second.d - first.d >= .024) return { ...out, decision: 'accept', choices: [first.id] };
  return { ...out, decision: 'pick', choices: all.filter(x => ids.includes(x.id) && x.d <= first.d + .035).slice(0, 3).map(x => x.id) };
}
