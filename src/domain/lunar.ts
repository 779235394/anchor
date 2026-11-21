import { parseLocalDate } from './date';

export interface LunarDateInfo {
  month: string;
  dayNum: number;
  dayLabel: string;
  /** Compact cell label: lunar month on day 1 (e.g. "十月" / "闰六月"), otherwise "初二".."三十". */
  shortLabel: string;
  fullLabel: string;
  isFirstDay: boolean;
}

const LUNAR_DAYS: readonly string[] = [
  '',
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
];

let formatter: Intl.DateTimeFormat | null | undefined;
const cache = new Map<string, LunarDateInfo | null>();

function getFormatter(): Intl.DateTimeFormat | null {
  if (formatter !== undefined) return formatter;
  try {
    formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'long',
      day: 'numeric',
    });
  } catch {
    formatter = null;
  }
  return formatter;
}

/**
 * Computes Chinese lunar calendar label for a local `YYYY-MM-DD` date string
 * using zero-dependency native `Intl.DateTimeFormat('zh-CN-u-ca-chinese')`.
 */
export function getLunarDate(ymd: string): LunarDateInfo | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (cache.has(ymd)) return cache.get(ymd) ?? null;

  const fmt = getFormatter();
  if (!fmt) {
    cache.set(ymd, null);
    return null;
  }

  try {
    const d = parseLocalDate(ymd);
    d.setHours(12, 0, 0, 0);
    const parts = fmt.formatToParts(d);
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const dayRaw = parts.find((p) => p.type === 'day')?.value || '';
    const dayNum = Number.parseInt(dayRaw, 10);
    if (!month || !Number.isFinite(dayNum) || dayNum < 1 || dayNum > 30) {
      cache.set(ymd, null);
      return null;
    }
    const dayLabel = LUNAR_DAYS[dayNum] || `${dayNum}`;
    const isFirstDay = dayNum === 1;
    const info: LunarDateInfo = {
      month,
      dayNum,
      dayLabel,
      shortLabel: isFirstDay ? month : dayLabel,
      fullLabel: `${month}${dayLabel}`,
      isFirstDay,
    };
    cache.set(ymd, info);
    return info;
  } catch {
    cache.set(ymd, null);
    return null;
  }
}
