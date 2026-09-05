import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fallbackItemSubtitle,
  fallbackItemTitle,
  formatRelativeTime,
  getImageSource,
  getItemUrl,
  stripHtmlTags,
  toTitleCase,
} from '../src/helpers';
import { item } from './fixtures';

/**
 * `formatDate` and `formatTime` are deliberately absent. Both render through
 * the locale, which is what the next change to this module is about, so
 * asserting today's output would pin the defect rather than the behaviour. The
 * relative branches below are locale-independent and are the part that has real
 * logic in it.
 */

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
