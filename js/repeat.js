// Repeat rules shared by tasks and reminders. A repeating item is a single
// record: when it is done, the next occurrence is created (tasks) or the
// reminder moves to its next date. Future occurrences are only *previewed*.

import { addDays, addMonths, dayNumber, dayOfWeek, weekdayLong } from './dates.js';

export const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

export const isRepeat = (value) => REPEATS.includes(value);

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** "Every Tuesday", "Every month on the 20th"… */
export function describeRepeat(repeat, date) {
  switch (repeat) {
    case 'daily': return 'Every day';
    case 'weekdays': return 'Every weekday';
    case 'weekly': return date ? `Every ${weekdayLong(date)}` : 'Every week';
    case 'monthly': return date ? `Every month on the ${ordinal(dayNumber(date))}` : 'Every month';
    case 'yearly': return 'Every year';
    default: return '';
  }
}

/** The occurrence right after `date`. Monthly/yearly keep the original day where possible. */
export function nextDate(date, repeat, anchorDay = dayNumber(date)) {
  switch (repeat) {
    case 'daily': return addDays(date, 1);
    case 'weekdays': {
      let d = addDays(date, 1);
      while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, 1);
      return d;
    }
    case 'weekly': return addDays(date, 7);
    case 'monthly': return withDay(addMonths(date, 1), anchorDay);
    case 'yearly': return withDay(addMonths(date, 12), anchorDay);
    default: return null;
  }
}

function withDay(iso, day) {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${iso.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** First occurrence after `date` that is on or after `notBefore` (skips missed ones). */
export function nextDateFrom(date, repeat, notBefore) {
  const anchor = dayNumber(date);
  let d = nextDate(date, repeat, anchor);
  for (let i = 0; d && d < notBefore && i < 2000; i += 1) d = nextDate(d, repeat, anchor);
  return d;
}

/** Previewed future dates of a repeating item within [from, to], excluding its own date. */
export function occurrencesBetween(date, repeat, from, to) {
  const out = [];
  if (!isRepeat(repeat)) return out;
  const anchor = dayNumber(date);
  let d = nextDate(date, repeat, anchor);
  for (let i = 0; d && d <= to && i < 400; i += 1) {
    if (d >= from) out.push(d);
    d = nextDate(d, repeat, anchor);
  }
  return out;
}
