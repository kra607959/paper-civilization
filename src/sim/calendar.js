// 日历：时间都用「游戏分钟」。一天 1440 分钟，一季 7 天，一年 28 天。
import { DAY, SEASON_DAYS, YEAR_DAYS, SEASONS } from './config.js';

export const dayOf = t => Math.floor(t / DAY);
export const hourOf = t => (((t % DAY) + DAY) % DAY) / 60;
export const seasonOf = t => Math.floor((dayOf(t) % YEAR_DAYS) / SEASON_DAYS);
export const yearOf = t => Math.floor(dayOf(t) / YEAR_DAYS) + 1;
export const dayInSeason = t => (dayOf(t) % SEASON_DAYS) + 1;
export const yearDay = t => dayOf(t) % YEAR_DAYS;

// 日出日落（春夏秋冬）
export const RISE = [6, 5, 6, 7], SET = [18, 19, 18, 17];
export const sunrise = t => RISE[seasonOf(t)];
export const sunset = t => SET[seasonOf(t)];
export const isDark = t => { const h = hourOf(t); return h < sunrise(t) || h >= sunset(t); };
export const bedtime = t => sunset(t) + 2.5;
export const isBedtime = t => { const h = hourOf(t); return h >= bedtime(t) || h < sunrise(t); };
// 白天还剩几小时（天黑后为 0）
export const daylightLeft = t => Math.max(0, sunset(t) - hourOf(t));

// 天光：白天 1，夜里 0.3，早晚一小时过渡
export function light(t) {
  const h = hourOf(t), a = sunrise(t), b = sunset(t);
  if (h >= a + 0.5 && h <= b - 0.5) return 1;
  if (h < a - 0.5 || h > b + 0.5) return 0.3;
  const k = h < 12 ? (h - (a - 0.5)) : ((b + 0.5) - h);
  return 0.3 + 0.7 * Math.max(0, Math.min(1, k));
}

// 气温：一年一个周期（仲夏约 25°，仲冬约 −1°），一天一个周期（午后 +4°，后半夜 −4°）
export function airTemp(t) {
  const yd = (t / DAY) % YEAR_DAYS;
  return 12 + 13 * Math.cos(2 * Math.PI * (yd - 10.5) / YEAR_DAYS) + 4 * Math.cos(2 * Math.PI * (hourOf(t) - 14) / 24);
}

const SHI = '子丑寅卯辰巳午未申酉戌亥';
export const shichen = t => SHI[Math.floor(((hourOf(t) + 1) % 24) / 2)] + '时';
export const dateText = t => `第${yearOf(t)}年 ${SEASONS[seasonOf(t)]} 第${dayInSeason(t)}天`;
export const shortDate = t => `${yearOf(t)}年${SEASONS[seasonOf(t)]}${dayInSeason(t)}日`;
export const clockText = t => {
  const m = Math.floor(((t % DAY) + DAY) % DAY);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
