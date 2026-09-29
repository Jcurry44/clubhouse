// Clubhouse — dates: week math and formatting (SPEC §0). Pure; safe to import in Node tests.
// Calendar dates are always LOCAL 'YYYY-MM-DD' strings — never toISOString().slice(0, 10).

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date of a Date → 'YYYY-MM-DD'. */
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' → Date at local midnight. Accepts a Date (returns a copy at local midnight). */
export function parseYmd(s) {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseYmd(s).getTime());
}

/** Add n calendar days (DST-safe: works on calendar fields, not milliseconds). */
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Whole calendar days from a to b (b − a). */
export function daysBetween(a, b) {
  const A = parseYmd(a), B = parseYmd(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 864e5);
}

/** Monday = 0 … Sunday = 6. */
export function dowIndex(s) {
  return (parseYmd(s).getDay() + 6) % 7;
}

/** The Monday of the week containing s (Date or ymd) → ymd. */
export function mondayOf(s) {
  const d = parseYmd(s);
  return addDays(ymd(d), -((d.getDay() + 6) % 7));
}

/** ISO-8601 week number. */
export function isoWeek(s) {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
}

/** Weeks (Monday ymd) from `from` back `n` weeks, oldest first, including `from`'s week. */
export function lastWeeks(from, n) {
  const w0 = mondayOf(from);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(w0, -7 * i));
  return out;
}

/** The shared render context (SPEC §2). */
export function makeCtx(now = new Date()) {
  const today = ymd(now);
  const weekStart = mondayOf(today);
  const dayIndex = dowIndex(today);
  return {
    now,
    today,
    hour: now.getHours(),
    weekStart,
    weekEnd: addDays(weekStart, 6),
    prevWeekStart: addDays(weekStart, -7),
    weekNo: isoWeek(today),
    dayIndex,
    daysLeft: 7 - dayIndex - 1,
    season: now.getFullYear(),
  };
}

export function inRange(s, from, to) {
  return typeof s === 'string' && s >= from && s <= to;
}

/** 'Sep 27' */
export function monD(s) {
  const d = parseYmd(s);
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** 'Sun Sep 20' */
export function dowMonD(s) {
  return `${DOW[dowIndex(s)]} ${monD(s)}`;
}

/** Eyebrow: 'Thursday · Sep 25 · Week 39' (uppercased by CSS). */
export function eyebrow(ctx) {
  return `${DOW_LONG[ctx.dayIndex]} · ${monD(ctx.today)} · Week ${ctx.weekNo}`;
}

/**
 * Day word (SPEC §0): today → 'today'; tomorrow → 'tomorrow'; yesterday → 'yesterday';
 * within 6 days either side → weekday ('Sunday', or 'Sun' with short); else 'Sep 27'.
 */
export function dayWord(s, ctx, { short = false } = {}) {
  const diff = daysBetween(ctx.today, s);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (Math.abs(diff) <= 6) return short ? DOW[dowIndex(s)] : DOW_LONG[dowIndex(s)];
  return monD(s);
}

/** 12-hour clock. '1:00' (ampm false) or '7:00 pm'. Accepts Date or ISO string. */
export function time12(t, { ampm = false } = {}) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours(), m = d.getMinutes();
  const s = `${h % 12 || 12}:${pad(m)}`;
  return ampm ? `${s} ${h < 12 ? 'am' : 'pm'}` : s;
}

/** 'Sep 20, 9:14 pm' for timestamps. */
export function stamp(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time12(d, { ampm: true })}`;
}

/** 'YYYY-MM-DD-HHmm' in local time (backup filenames). */
export function fileStamp(d = new Date()) {
  return `${ymd(d)}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Relative age of a timestamp: 'just now', '5 min ago', '3 h ago', 'yesterday', '4 days ago', 'Sep 2'. */
export function ago(t, now = new Date()) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.max(0, (now - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const days = daysBetween(ymd(d), ymd(now));
  if (days === 0) return `${Math.floor(s / 3600)} h ago`;
  if (days === 1) return 'yesterday';
  if (days <= 13) return `${days} days ago`;
  return monD(ymd(d));
}
