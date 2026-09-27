import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDay, formatRelative, groupByDay } from '../src/dates';

const NOW = '2026-09-05T12:00:00.000Z';

/** What the runtime itself would render, which is what the code should defer to. */
const asDate = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString(undefined, options);

describe('formatDay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the two days a person would name', () => {
    // Midday fixtures throughout, because these compare calendar days in the
    // reader's zone: an instant late on one UTC day is already the next day
    // east of Greenwich, and a fixture near a boundary would be asserting the
    // runner's offset rather than the branch.
    expect(formatDay('2026-09-05T12:00:00.000Z')).toBe('Today');
    expect(formatDay('2026-09-04T12:00:00.000Z')).toBe('Yesterday');
  });

  it('uses a weekday for the rest of the week just gone', () => {
    // Not a locale assertion, despite the shape. The pinned locale and the one
    // this code used to hardcode spell every weekday identically, so only the
    // branches below can catch a literal coming back. This proves the branch.
    expect(formatDay('2026-09-02T12:00:00.000Z')).toBe(
      asDate('2026-09-02T12:00:00.000Z', { weekday: 'long' }),
    );
  });

  it('holds both edges of the weekday window', () => {
    // Six days back is the last day a weekday name is unambiguous; seven is the
    // same weekday as today and has to be a date instead. Without both, moving
    // the bound either way leaves the suite green.
    expect(formatDay('2026-08-30T12:00:00.000Z')).toBe(
      asDate('2026-08-30T12:00:00.000Z', { weekday: 'long' }),
    );
    expect(formatDay('2026-08-29T12:00:00.000Z')).toBe(
      asDate('2026-08-29T12:00:00.000Z', { month: 'short', day: 'numeric' }),
    );
  });

  it('counts calendar days across a daylight-saving change', () => {
    // Two local midnights are 23 or 25 hours apart across a transition, and
    // flooring that gave the wrong day: viewing on 10 March, items from the 8th
    // and the 9th both said "Yesterday" and Browse merged them into one
    // section. The pinned zone is what makes this reachable at all.
    vi.setSystemTime(new Date('2026-03-09T17:00:00.000Z'));
    expect(formatDay('2026-03-08T17:00:00.000Z')).toBe('Yesterday');

    vi.setSystemTime(new Date('2026-03-10T17:00:00.000Z'));
    expect(formatDay('2026-03-09T17:00:00.000Z')).toBe('Yesterday');
    expect(formatDay('2026-03-08T17:00:00.000Z')).not.toBe('Yesterday');
  });

  it('drops to a date once the weekday stops being unambiguous', () => {
    expect(formatDay('2026-08-20T12:00:00.000Z')).toBe(
      asDate('2026-08-20T12:00:00.000Z', { month: 'short', day: 'numeric' }),
    );
  });

  it('carries the year only when it is not this one', () => {
    const older = '2025-08-20T12:00:00.000Z';
    expect(formatDay(older)).toBe(
      asDate(older, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
    expect(formatDay(older)).toContain('2025');
  });

  it('never labels a future date with a weekday', () => {
    // A future date subtracts to a negative, which an unbounded `< 7` admitted:
    // an item dated next September rendered as "Sunday" and Browse grouped it
    // under the same heading as items from the Sunday just gone.
    expect(formatDay('2026-09-06T12:00:00.000Z')).toBe(
      asDate('2026-09-06T12:00:00.000Z', { month: 'short', day: 'numeric' }),
    );
    expect(formatDay('2027-09-05T12:00:00.000Z')).toContain('2027');
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (iso: string) => formatRelative(iso);

  it('reads an absent timestamp as never, not as now', () => {
    // The argument is nullable because `ApiKey.last_used_at` is, and a key that
    // has never been used is the case this exists for. Zero would read as "just
    // now", which is the opposite of true.
    expect(formatRelative(null)).toBe('Never');
  });

  it('holds each boundary against the unit below it', () => {
    expect(at('2026-09-05T11:59:31.000Z')).toBe('just now');
    expect(at('2026-09-05T11:59:00.000Z')).toBe('1m ago');
    expect(at('2026-09-05T11:01:00.000Z')).toBe('59m ago');
    expect(at('2026-09-05T11:00:00.000Z')).toBe('1h ago');
    expect(at('2026-09-04T13:00:00.000Z')).toBe('23h ago');
    expect(at('2026-09-04T12:00:00.000Z')).toBe('1d ago');
    expect(at('2026-08-07T12:00:00.000Z')).toBe('29d ago');
  });

  it('hands anything older than a month to the date formatter', () => {
    // Past 30 days it stops being relative and renders a date, so the only
    // assertion that means anything here is that it is no longer a "d ago".
    expect(at('2026-06-05T12:00:00.000Z')).not.toMatch(/ago$/);
  });
});

describe('groupByDay', () => {
  it('keeps the rows in order under the day each falls on', () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    const rows = [
      '2026-09-05T11:00:00.000Z',
      '2026-09-05T09:00:00.000Z',
      '2026-09-04T16:00:00.000Z',
    ];
    expect(groupByDay(rows, (row) => row, now)).toEqual([
      ['Today', rows.slice(0, 2)],
      ['Yesterday', rows.slice(2)],
    ]);
  });
});
