/**
 * Dates as a person at this machine would write them, in its own locale and
 * zone. `05/09` is a different day in each of two locales, so nothing here
 * names one.
 */

/** A day as a list heading: Today, Yesterday, a weekday within the week, or the date. */
export function formatDay(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Rounded, not floored: two local midnights are 23 or 25 hours apart across
  // a clock change, and the quantity is always a whole number of days.
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  // Only the week just gone; a date ahead of today is never a weekday name.
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return formatDay(iso, new Date(now));
}

/** Rows grouped under the day each falls on, keeping their order. */
export function groupByDay<T>(
  rows: T[],
  at: (row: T) => string,
  now = new Date(),
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = formatDay(at(row), now);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()];
}
