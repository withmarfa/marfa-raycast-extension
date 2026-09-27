import { describe, expect, it } from 'vitest';
import {
  BULK_MAX_ITEMS,
  countTrashBody,
  editRequest,
  emptyTrashBody,
  sameIds,
} from '../src/requests';

describe('counting the Trash', () => {
  it('is a dry run over the Trash alone, up to the server’s ceiling', () => {
    expect(countTrashBody()).toEqual({
      action: 'purge',
      confirm: 'PURGE',
      filter: { state: 'trashed' },
      dry_run: true,
      max_items: BULK_MAX_ITEMS,
    });
  });
});

describe('emptying the Trash', () => {
  it('purges the Trash alone, refusing more than the count confirmed, and is no dry run', () => {
    expect(emptyTrashBody(3)).toEqual({
      action: 'purge',
      confirm: 'PURGE',
      filter: { state: 'trashed' },
      max_items: 3,
    });
  });

  it('starts only on the very items counted', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIds(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sameIds(['a'], ['a', 'a', 'b'])).toBe(false);
  });
});

describe('an edit', () => {
  const properties = { title: 'x' };

  it('settles a collision only when asked, for a note', () => {
    expect(editRequest({ version: 2, properties, mode: 'merge', settle: true })).toEqual({
      query: { conflict: 'auto' },
      body: { version: 2, properties, properties_mode: 'merge' },
    });
  });

  it('otherwise leaves a collision to be refused, and replaces when told to', () => {
    expect(editRequest({ version: 2, properties, mode: 'replace', settle: false })).toEqual({
      query: {},
      body: { version: 2, properties, properties_mode: 'replace' },
    });
  });
});
