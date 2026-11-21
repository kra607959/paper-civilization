// 本机存取（localStorage 可能不可用：隐私窗口、禁用站点数据），读写都包 try/catch。
import { Recognizer } from '../recog/recognizer.js';

export function load(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// 存笔画时把坐标和时间压成整数数组，省地方：[[x, y, t], ...]
export const packStrokes = strokes => strokes.map(s => s.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.t || 0)]));
export const unpackStrokes = strokes => strokes.map(s => s.map(p => (Array.isArray(p) ? { x: p[0], y: p[1], t: p[2] } : p)));
// 旧笔迹用对象，浏览器存储用数组；两种都读，坏记录不交给识别器。
export function readStrokes(strokes) {
  if (!Array.isArray(strokes) || !strokes.length || !strokes.every(s => Array.isArray(s) && s.length)) return null;
  const decoded = unpackStrokes(strokes);
  return decoded.every(s => s.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.t == null || Number.isFinite(p.t)))) ? decoded : null;
}

export const PERSONAL_KEY = 'danqing.personal.v1';

// 载入模型，并把本机存的个人原型（示范三遍、日常生效的符）加进去
export async function loadRecognizer(url = 'model/glyph.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`模型载入失败：${res.status}`);
  const model = await res.json();
  const rec = new Recognizer(model);
  const saved = load(PERSONAL_KEY, null);
  if (Array.isArray(saved?.items)) {
    for (const it of saved.items) {
      const strokes = readStrokes(it?.strokes);
      if (strokes) rec.addPersonal(it.id, strokes);
    }
  }
  return { rec, model };
}

export function savePersonal(rec) {
  const data = rec.exportPersonal();
  data.items = data.items.map(it => ({ ...it, strokes: packStrokes(it.strokes) }));
  return save(PERSONAL_KEY, data);
}

// 让浏览器把一段文本存成文件（本地页面用；在受限的沙盒里可能被拦）
export function downloadText(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
