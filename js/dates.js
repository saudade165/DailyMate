// Date helpers. Dates are stored as local "YYYY-MM-DD" strings so a task never
// shifts to another day because of time zones.

const LOCALE = 'en-US';

const pad = (n) => String(n).padStart(2, '0');

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function isValidISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISO(parseISO(iso)) === iso;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** Same day-of-month `months` later; clamps to the last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(y, m - 1 + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return toISO(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}

export function dayOfWeek(iso) {
  return parseISO(iso).getDay(); // 0 = Sunday
}

/** Weeks start on Sunday, as on most North American calendars. */
export function startOfWeek(iso) {
  return addDays(iso, -dayOfWeek(iso));
}

export function startOfMonth(iso) {
  return `${iso.slice(0, 8)}01`;
}

export function isValidTime(time) {
  return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/** "Tuesday, October 20, 2026" */
export function formatLong(iso) {
  return parseISO(iso).toLocaleDateString(LOCALE, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/** "Tue, Oct 20" */
export function formatShort(iso) {
  return parseISO(iso).toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "October 2026" */
export function formatMonth(iso) {
  return parseISO(iso).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

/** "Oct 18 – 24, 2026" or "Oct 25 – Nov 1, 2026" */
export function formatRange(fromISO, toISO_) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
    .formatRange(parseISO(fromISO), parseISO(toISO_));
}

export function weekdayShort(iso) {
  return parseISO(iso).toLocaleDateString(LOCALE, { weekday: 'short' });
}

export function weekdayLong(iso) {
  return parseISO(iso).toLocaleDateString(LOCALE, { weekday: 'long' });
}

/** "Tuesday" -> used for "Every Tuesday" */
export function dayNumber(iso) {
  return Number(iso.slice(8, 10));
}

/** "Today", "Tomorrow", "Yesterday" or "Tue, Oct 20". */
export function relativeDay(iso, today = todayISO()) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return formatShort(iso);
}

/** "14:30" -> "2:30 PM" */
export function formatTime(time) {
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ---- Time zones --------------------------------------------------------------
// Reminders remember the time zone they were set in, so "9:00 AM" keeps meaning
// 9:00 AM where the person was, even if the device's zone changes later.

export function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat(LOCALE, { timeZone: tz }); return true; } catch { return false; }
}

const partsCache = new Map();
function zoneParts(instant, tz) {
  let fmt = partsCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}

/** The instant (ms since epoch) when it is `date` `time` on the wall clock in `tz`. */
export function zonedToInstant(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset, including around daylight-saving changes.
  let guess = wall;
  for (let i = 0; i < 2; i += 1) guess = wall - (zoneParts(new Date(guess), tz) - guess);
  // A time skipped by "spring forward" (e.g. 2:30 AM) doesn't exist: use the same
  // distance after the jump (3:30 AM), as most calendars do, rather than an hour early.
  const shown = zoneParts(new Date(guess), tz);
  return shown < wall ? guess + (wall - shown) : guess;
}

/** Local wall-clock date and time for an instant, in this device's zone. */
export function instantToLocal(ms) {
  const d = new Date(ms);
  return { date: toISO(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** "in 25 minutes", "2 hours ago" */
export function fromNow(ms, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 60_000) return diff >= 0 ? 'in under a minute' : 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
