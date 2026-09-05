import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fallbackItemSubtitle,
  fallbackItemTitle,
  formatDate,
  formatRelativeTime,
  formatTime,
  getImageSource,
  getItemUrl,
  stripHtmlTags,
  toTitleCase,
} from '../src/helpers';
import { item } from './fixtures';

const NOW = '2026-09-05T12:00:00.000Z';

/** What the runtime itself would render, which is what the code should defer to. */
const asDate = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString(undefined, options);

describe('formatDate', () => {
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
    expect(formatDate('2026-09-05T12:00:00.000Z')).toBe('Today');
    expect(formatDate('2026-09-04T12:00:00.000Z')).toBe('Yesterday');
  });

  it('uses a weekday for the rest of the week just gone', () => {
    // Not a locale assertion, despite the shape. The pinned locale and the one
    // this code used to hardcode spell every weekday identically, so only the
    // branches below can catch a literal coming back. This proves the branch.
    expect(formatDate('2026-09-02T12:00:00.000Z')).toBe(
      asDate('2026-09-02T12:00:00.000Z', { weekday: 'long' }),
    );
  });

  it('holds both edges of the weekday window', () => {
    // Six days back is the last day a weekday name is unambiguous; seven is the
    // same weekday as today and has to be a date instead. Without both, moving
    // the bound either way leaves the suite green.
    expect(formatDate('2026-08-30T12:00:00.000Z')).toBe(
      asDate('2026-08-30T12:00:00.000Z', { weekday: 'long' }),
    );
    expect(formatDate('2026-08-29T12:00:00.000Z')).toBe(
      asDate('2026-08-29T12:00:00.000Z', { month: 'short', day: 'numeric' }),
    );
  });

  it('counts calendar days across a daylight-saving change', () => {
    // Two local midnights are 23 or 25 hours apart across a transition, and
    // flooring that gave the wrong day: viewing on 10 March, items from the 8th
    // and the 9th both said "Yesterday" and Browse merged them into one
    // section. The pinned zone is what makes this reachable at all.
    vi.setSystemTime(new Date('2026-03-09T17:00:00.000Z'));
    expect(formatDate('2026-03-08T17:00:00.000Z')).toBe('Yesterday');

    vi.setSystemTime(new Date('2026-03-10T17:00:00.000Z'));
    expect(formatDate('2026-03-09T17:00:00.000Z')).toBe('Yesterday');
    expect(formatDate('2026-03-08T17:00:00.000Z')).not.toBe('Yesterday');
  });

  it('drops to a date once the weekday stops being unambiguous', () => {
    expect(formatDate('2026-08-20T12:00:00.000Z')).toBe(
      asDate('2026-08-20T12:00:00.000Z', { month: 'short', day: 'numeric' }),
    );
  });

  it('carries the year only when it is not this one', () => {
    const older = '2025-08-20T12:00:00.000Z';
    expect(formatDate(older)).toBe(
      asDate(older, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
    expect(formatDate(older)).toContain('2025');
  });

  it('never labels a future date with a weekday', () => {
    // A future date subtracts to a negative, which an unbounded `< 7` admitted:
    // an item dated next September rendered as "Sunday" and Browse grouped it
    // under the same heading as items from the Sunday just gone.
    expect(formatDate('2026-09-06T12:00:00.000Z')).toBe(
      asDate('2026-09-06T12:00:00.000Z', { month: 'short', day: 'numeric' }),
    );
    expect(formatDate('2027-09-05T12:00:00.000Z')).toContain('2027');
  });
});

describe('formatTime', () => {
  it('renders in the runtime locale rather than a fixed one', () => {
    const iso = '2026-09-05T15:47:00.000Z';
    expect(formatTime(iso)).toBe(
      new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    );
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (iso: string) => formatRelativeTime(iso);

  it('reads an absent timestamp as never, not as now', () => {
    // The argument is nullable because `ApiKey.last_used_at` is, and a key that
    // has never been used is the case this exists for. Zero would read as "just
    // now", which is the opposite of true.
    expect(formatRelativeTime(null)).toBe('Never');
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

describe('toTitleCase', () => {
  it('splits on underscores and capitalizes only the first word', () => {
    expect(toTitleCase('source_id')).toBe('Source id');
    expect(toTitleCase('title')).toBe('Title');
  });

  it('returns a key it cannot split rather than an empty string', () => {
    expect(toTitleCase('')).toBe('');
    expect(toTitleCase('___')).toBe('___');
  });
});

describe('getItemUrl', () => {
  it('answers only for a non-empty string', () => {
    expect(getItemUrl(item({ properties: { url: 'https://example.com' } }))).toBe(
      'https://example.com',
    );
    expect(getItemUrl(item({ properties: { url: '' } }))).toBeUndefined();
    expect(getItemUrl(item({ properties: { url: 42 } }))).toBeUndefined();
    expect(getItemUrl(item())).toBeUndefined();
  });
});

describe('fallbackItemTitle', () => {
  it('prefers title, then name, then url, then a slice of the body', () => {
    expect(fallbackItemTitle(item({ properties: { title: 'T', name: 'N' } }))).toBe('T');
    expect(fallbackItemTitle(item({ properties: { name: 'N', url: 'https://e.com' } }))).toBe('N');
    expect(fallbackItemTitle(item({ properties: { url: 'https://e.com', body: 'B' } }))).toBe(
      'https://e.com',
    );
    expect(fallbackItemTitle(item({ properties: { body: 'B' } }))).toBe('B');
  });

  it('skips a present but empty field rather than returning it', () => {
    // An empty title is not a title. Returning it would render a blank row,
    // where returning undefined lets the caller fall through to the type label.
    expect(fallbackItemTitle(item({ properties: { title: '', name: 'N' } }))).toBe('N');
  });

  it('returns undefined when nothing conventional is present', () => {
    expect(fallbackItemTitle(item({ properties: { playlist_id: 'PL1' } }))).toBeUndefined();
  });

  it('truncates a long body rather than returning the whole thing', () => {
    const long = 'x'.repeat(200);
    expect(fallbackItemTitle(item({ properties: { body: long } }))).toHaveLength(80);
  });
});

describe('fallbackItemSubtitle', () => {
  it('prefers a description', () => {
    expect(fallbackItemSubtitle(item({ properties: { description: 'D', body: 'B' } }))).toBe('D');
  });

  it('uses the body only when a title is carrying the heading', () => {
    // With no title at all the body is already the title, so returning it here
    // too would render the same text twice on one row.
    expect(fallbackItemSubtitle(item({ properties: { title: 'T', body: 'B' } }))).toBe('B');
    expect(fallbackItemSubtitle(item({ properties: { body: 'B' } }))).toBeUndefined();
  });

});

describe('the title and subtitle fallbacks, on an empty title', () => {
  it('both return the body, so the row renders it twice', () => {
    // Pinned as it behaves, not as it should, and filed against the pair rather
    // than either one because neither is wrong alone. The subtitle guard tests
    // the title's type where the title resolver tests its content, so the two
    // disagree about what an empty title means. Whoever makes them agree should
    // change this expectation.
    expect(fallbackItemTitle(item({ properties: { title: '', body: 'B' } }))).toBe('B');
    expect(fallbackItemSubtitle(item({ properties: { title: '', body: 'B' } }))).toBe('B');
  });
});

describe('stripHtmlTags', () => {
  it('removes tags and keeps their text', () => {
    expect(stripHtmlTags('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
  });
});

describe('getImageSource', () => {
  it('takes the cover keys in priority order', () => {
    const source = getImageSource(
      item({
        properties: {
          thumbnail_url: 'https://e.com/thumb.jpg',
          cover_url: 'https://e.com/cover.jpg',
        },
      }),
    );
    expect(source).toEqual({ kind: 'url', url: 'https://e.com/cover.jpg' });
  });

  it('refuses a cover value that is not an http url', () => {
    // A relative path or a data: value would render as a broken image in the
    // markdown, and a file: one would read off the machine.
    expect(getImageSource(item({ properties: { cover_url: '/local/path.jpg' } }))).toBeNull();
    expect(getImageSource(item({ properties: { cover_url: 42 } }))).toBeNull();
  });

  it('reads a blob only for an image file, and defaults its mime type', () => {
    expect(
      getImageSource(item({ type: 'core.file.image', properties: { blob_ref: 'sha256:abc' } })),
    ).toEqual({ kind: 'blob', blobRef: 'sha256:abc', mimeType: 'image/jpeg' });

    expect(
      getImageSource(
        item({ type: 'core.file.image', properties: { blob_ref: 'sha256:abc', mime_type: '' } }),
      ),
    ).toEqual({ kind: 'blob', blobRef: 'sha256:abc', mimeType: 'image/jpeg' });

    // A video's blob is not an image and must not be rendered as one.
    expect(
      getImageSource(item({ type: 'core.file.video', properties: { blob_ref: 'sha256:abc' } })),
    ).toBeNull();
  });

  it('returns null when there is nothing to show', () => {
    expect(getImageSource(item())).toBeNull();
  });
});
