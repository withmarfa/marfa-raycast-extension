import { describe, expect, it } from 'vitest';
import { groupByDate, mergeEntries, type Entry } from '../src/result-merge';
import { item } from './fixtures';

const meta = { tags: [] } as unknown as Entry['metadata'];
const entry = (id: string, timestamp: string, snippet?: string): Entry => ({
  item: item({ id, timestamp }),
  metadata: meta,
  ...(snippet === undefined ? {} : { snippet_html: snippet }),
});

const ids = (entries: Entry[]) => entries.map((e) => e.item.id);

describe('mergeEntries', () => {
  it('interleaves the walked pages and the search hits by date', () => {
    // The point of merging rather than appending. A hit from last year at the
    // bottom of the list is where a reader looks for last year.
    const loaded = [entry('a', '2026-09-05T10:00:00.000Z'), entry('b', '2026-09-03T10:00:00.000Z')];
    const hits = [entry('c', '2026-09-04T10:00:00.000Z'), entry('d', '2025-01-01T10:00:00.000Z')];
    expect(ids(mergeEntries(loaded, hits))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('keeps the hit when both halves hold the same item, for its snippet', () => {
    // Both sources return an item that is loaded and also matches. The walked
    // copy carries no snippet, so taking it would drop the one thing that says
    // why the row is there.
    const merged = mergeEntries(
      [entry('a', '2026-09-05T10:00:00.000Z')],
      [entry('a', '2026-09-05T10:00:00.000Z', '<em>match</em>')],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].snippet_html).toBe('<em>match</em>');
  });

  it('sinks an item whose timestamp will not parse rather than scrambling the rest', () => {
    // `NaN` makes every comparison false, so one bad value does not misplace
    // one row, it makes the whole order arbitrary.
    const merged = mergeEntries(
      [entry('good', '2026-09-05T10:00:00.000Z'), entry('bad', 'not a date')],
      [entry('older', '2020-01-01T10:00:00.000Z')],
    );
    expect(ids(merged)).toEqual(['good', 'older', 'bad']);
  });

  it('sorts the walked pages even with nothing typed', () => {
    // The list is date-grouped whether or not a query is running, so the
    // no-query path cannot rely on the server having sorted for it.
    const loaded = [entry('old', '2020-01-01T10:00:00.000Z'), entry('new', '2026-09-05T10:00:00.000Z')];
    expect(ids(mergeEntries(loaded, []))).toEqual(['new', 'old']);
  });

  it('holds nothing when neither half has anything', () => {
    expect(mergeEntries([], [])).toEqual([]);
  });
});

describe('groupByDate', () => {
  it('keeps sections and rows in the order it was handed', () => {
    // The caller sorts. Sorting again here would be a second opinion, and the
    // two would eventually disagree about which one the screen obeys.
    const entries = [
      entry('a', '2026-09-05T10:00:00.000Z'),
      entry('b', '2026-09-05T09:00:00.000Z'),
      entry('c', '2026-09-03T10:00:00.000Z'),
    ];
    const groups = groupByDate(entries, (timestamp) => timestamp.slice(0, 10));
    expect([...groups.keys()]).toEqual(['2026-09-05', '2026-09-03']);
    expect(ids(groups.get('2026-09-05') ?? [])).toEqual(['a', 'b']);
  });

  it('reunites entries that share a heading but were not adjacent', () => {
    const groups = groupByDate(
      [
        entry('a', '2026-09-05T10:00:00.000Z'),
        entry('b', '2026-09-03T10:00:00.000Z'),
        entry('c', '2026-09-05T08:00:00.000Z'),
      ],
      (timestamp) => timestamp.slice(0, 10),
    );
    expect(ids(groups.get('2026-09-05') ?? [])).toEqual(['a', 'c']);
    expect(groups.size).toBe(2);
  });
});
