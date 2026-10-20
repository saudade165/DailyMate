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
