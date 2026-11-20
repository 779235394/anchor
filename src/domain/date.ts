export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayStr(now: Date = new Date()): string {
  return formatDate(now);
}

export function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

export function shiftDate(baseYmd: string, days: number): string {
  const d = parseLocalDate(baseYmd);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function dayDiff(fromYmd: string, toYmd: string): number {
  const a = parseLocalDate(fromYmd).getTime();
  const b = parseLocalDate(toYmd).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Returns Monday (YYYY-MM-DD) of the week containing `baseYmd`, offset by `weekOffset` weeks. */
export function weekStart(baseYmd: string, weekOffset = 0): string {
  const d = parseLocalDate(baseYmd);
  const offsetFromMon = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offsetFromMon + weekOffset * 7);
  return formatDate(d);
}

export function weekEnd(baseYmd: string, weekOffset = 0): string {
  return shiftDate(weekStart(baseYmd, weekOffset), 6);
}

export function monthEnd(baseYmd: string): string {
  const d = parseLocalDate(baseYmd);
  return formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function isWeekend(ymd: string): boolean {
  const day = parseLocalDate(ymd).getDay();
  return day === 0 || day === 6;
}

/** ISO-8601 week key like `2026-W47` (Monday-based). */
export function isoWeekKey(ymd: string): string {
  const d = parseLocalDate(ymd);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function defaultDueDateTime(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return toDateTimeLocalValue(d);
}

export function toDateTimeLocalValue(input: Date | number | string): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatShortDateTime(isoLocal: string): string {
  if (!isoLocal) return '—';
  const d = new Date(isoLocal);
  if (Number.isNaN(d.getTime())) return isoLocal;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${hh}:${mm}`;
}

export function formatClock(ts: number, lang: 'zh' | 'en', todayYmd: string = todayStr()): string {
  const d = new Date(ts);
  const ymd = formatDate(d);
  const diff = dayDiff(ymd, todayYmd);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 0) return lang === 'zh' ? `今天 ${hm}` : `Today ${hm}`;
  if (diff === 1) return lang === 'zh' ? `昨天 ${hm}` : `Yesterday ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

const WD_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayLabel(ymd: string, lang: 'zh' | 'en'): string {
  const idx = parseLocalDate(ymd).getDay();
  return lang === 'zh' ? WD_ZH[idx] : WD_EN[idx];
}

export function humanDate(ymd: string, lang: 'zh' | 'en', todayYmd: string = todayStr()): string {
  if (!ymd) return lang === 'zh' ? '无期限' : 'No due date';
  const n = dayDiff(todayYmd, ymd);
  if (n === 0) return lang === 'zh' ? '今天' : 'Today';
  if (n === 1) return lang === 'zh' ? '明天' : 'Tomorrow';
  if (n === -1) return lang === 'zh' ? '昨天' : 'Yesterday';
  if (n < 0) {
    const abs = -n;
    return lang === 'zh' ? `逾期 ${abs} 天` : `${abs}d overdue`;
  }
  if (n <= 6) {
    const wd = weekdayLabel(ymd, lang);
    return lang === 'zh' ? `${wd}（${n}天后）` : `${wd} (in ${n}d)`;
  }
  return ymd.slice(5).replace('-', '/');
}
