import type { Item, TypeSchema } from '@withmarfa/sdk';

/**
 * Builders for the two shapes every test here needs.
 *
 * The defaults exist so a test states only the field it is about. A test for
 * the title fallback that also has to invent a `schema_version` is a test whose
 * point is buried, and one that copies a whole item per case drifts field by
 * field until two cases disagree about what an ordinary item looks like.
 */

export function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm_1',
    type: 'core.note',
    state: 'active',
    tier: 'library',
    properties: {},
    created_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
    timestamp: '2026-09-05T10:00:00.000Z',
    source: 'test',
    version: 1,
    schema_version: 1,
    ...overrides,
  };
}

export function schema(id: string, overrides: Partial<TypeSchema> = {}): TypeSchema {
  return { id, version: 1, fields: {}, ...overrides };
}
