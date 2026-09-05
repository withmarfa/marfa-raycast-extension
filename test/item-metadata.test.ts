import { describe, expect, it } from 'vitest';
import { classifyProperty, splitItemProperties } from '../src/item-metadata';
import { item } from './fixtures';

describe('classifyProperty', () => {
  it('drops what has nothing to render', () => {
    // A row reading "Notes:" with nothing after it is worse than no row.
    expect(classifyProperty('k', null)).toBeNull();
    expect(classifyProperty('k', undefined)).toBeNull();
    expect(classifyProperty('k', '')).toBeNull();
    expect(classifyProperty('k', [])).toBeNull();
  });

  it('separates a datetime and a url from an ordinary string', () => {
    expect(classifyProperty('published_at', '2026-09-05T10:00:00.000Z')).toEqual({
      kind: 'datetime',
      key: 'published_at',
      value: '2026-09-05T10:00:00.000Z',
    });
    expect(classifyProperty('html_link', 'https://e.com')).toEqual({
      kind: 'url',
      key: 'html_link',
      value: 'https://e.com',
    });
    expect(classifyProperty('etag', 'W/"abc"')).toEqual({
      kind: 'string',
      key: 'etag',
      value: 'W/"abc"',
    });
  });

  it('reads a bare date as a string, since only a full timestamp renders as one', () => {
    // The detection is anchored on the `T`, so `2026-09-05` stays a string and
    // is shown verbatim rather than being put through a time formatter that
    // would invent a midnight for it.
    expect(classifyProperty('due', '2026-09-05')).toMatchObject({ kind: 'string' });
  });

  it('keeps false and zero, which are values rather than absences', () => {
    expect(classifyProperty('all_day', false)).toEqual({
      kind: 'boolean',
      key: 'all_day',
      value: false,
    });
    expect(classifyProperty('item_count', 0)).toEqual({
      kind: 'number',
      key: 'item_count',
      value: 0,
    });
  });

  it('joins an array of scalars and defers an array of anything else', () => {
    expect(classifyProperty('recurrence', ['RRULE:FREQ=WEEKLY', 'EXDATE:20260101'])).toEqual({
      kind: 'array',
      key: 'recurrence',
      value: 'RRULE:FREQ=WEEKLY, EXDATE:20260101',
    });
    expect(classifyProperty('authors', [{ name: 'A' }])).toMatchObject({ kind: 'complex' });
  });

  it('defers a nested object to the JSON block', () => {
    expect(classifyProperty('raw', { a: 1 })).toMatchObject({ kind: 'complex' });
  });
});

describe('splitItemProperties', () => {
  it('omits the conventional body keys, which the caller has already rendered', () => {
    const { scalar } = splitItemProperties(
      item({ properties: { title: 'T', body: 'B', url: 'https://e.com', etag: 'W/"abc"' } }),
    );
    expect(scalar.map((entry) => entry.key)).toEqual(['etag']);
  });

  it('omits a property shadowing a first-class Item field', () => {
    // A custom type declaring `properties.source` would otherwise render a
    // second "Source" row disagreeing with the one above it.
    const { scalar } = splitItemProperties(
      item({ properties: { source: 'somewhere else', place: 'Berlin' } }),
    );
    expect(scalar.map((entry) => entry.key)).toEqual(['place']);
  });

  it('omits the fields the registry named through display hints', () => {
    // A captured email titles by `subject` and bodies by `text_body`. Both are
    // rendered as the heading and the body, so repeating them as rows shows the
    // same text twice.
    const { scalar } = splitItemProperties(
      item({ properties: { subject: 'S', text_body: 'B', from: 'a@b.com' } }),
      ['subject', 'text_body'],
    );
    expect(scalar.map((entry) => entry.key)).toEqual(['from']);
  });

  it('routes complex values away from the sidebar', () => {
    const { scalar, complex } = splitItemProperties(
      item({ properties: { place: 'Berlin', raw: { a: 1 } } }),
    );
    expect(scalar.map((entry) => entry.key)).toEqual(['place']);
    expect(complex.map((entry) => entry.key)).toEqual(['raw']);
  });
});
