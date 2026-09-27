import { describe, expect, it } from 'vitest';
import { MarfaRequestError } from '../src/failure';
import {
  canManageKeys,
  changedKeyFields,
  formatMap,
  keyRefusal,
  keySummary,
  narrowToRead,
  parseMap,
  parseSources,
  presetReach,
} from '../src/keys';
import type { ApiKey } from '../src/marfa';

function key(over: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'k1',
    label: 'raycast',
    source: 'raycast',
    sources: [],
    default_tier: 'library',
    is_operator: false,
    permissions: [],
    type_permissions: {},
    extension_permissions: {},
    edge_permissions: {},
    metadata_permissions: {},
    profile_permissions: {},
    created_at: '2026-09-27T10:00:00.000Z',
    last_used_at: null,
    ...over,
  };
}

const FULL = key({
  permissions: [
    'schema.write',
    'keys.mint',
    'items.purge',
    'webhooks.manage',
    'config.manage',
    'audit.read',
    'grants.manage',
  ],
  type_permissions: { '*': 'write' },
  metadata_permissions: { '*': 'write' },
  edge_permissions: { '*': 'write' },
  extension_permissions: { '*': 'write' },
  profile_permissions: { '*': 'write' },
});

describe('who may manage keys', () => {
  it('a key holding keys.mint, and the operator key, which holds nothing', () => {
    expect(canManageKeys(FULL)).toBe(true);
    expect(canManageKeys(key({ is_operator: true }))).toBe(true);
    expect(canManageKeys(key({ type_permissions: { '*': 'write' } }))).toBe(false);
    expect(canManageKeys(key({ permissions: undefined }))).toBe(false);
  });
});

describe('the presets', () => {
  it('everything names no map, so the new key copies its creator', () => {
    expect(presetReach('everything', FULL)).toEqual({});
  });

  it('content copies the creator’s item, tag and edge maps, with no permission and no claim', () => {
    const narrow = key({
      type_permissions: { 'core.note': 'write', 'core.task': 'read', 'app.secret': 'none' },
      metadata_permissions: { tags: 'write' },
      edge_permissions: {},
      profile_permissions: { email: 'read' },
      permissions: ['keys.mint'],
    });
    expect(presetReach('content-write', narrow)).toEqual({
      permissions: [],
      sources: [],
      type_permissions: { 'core.note': 'write', 'core.task': 'read', 'app.secret': 'none' },
      metadata_permissions: { tags: 'write' },
      edge_permissions: {},
    });
  });

  it('read only narrows every write to read and keeps a denial', () => {
    expect(presetReach('content-read', FULL)).toEqual({
      permissions: [],
      sources: [],
      type_permissions: { '*': 'read' },
      metadata_permissions: { '*': 'read' },
      edge_permissions: { '*': 'read' },
    });
    expect(narrowToRead({ a: 'write', b: 'read', c: 'none' })).toEqual({
      a: 'read',
      b: 'read',
      c: 'none',
    });
  });

  it('from the operator key, which holds nothing but may grant anything, content reaches everything', () => {
    expect(presetReach('content-write', key({ is_operator: true })).type_permissions).toEqual({
      '*': 'write',
    });
    expect(presetReach('content-read', key({ is_operator: true })).edge_permissions).toEqual({
      '*': 'read',
    });
  });
});

describe('a map as lines', () => {
  it('round-trips pattern=level lines', () => {
    const map = { '*': 'read', 'core.note': 'write' };
    expect(parseMap(formatMap(map), ['read', 'write'])).toEqual({ map });
    expect(parseMap('\n  core.note = write \n', ['read', 'write'])).toEqual({
      map: { 'core.note': 'write' },
    });
  });

  it('refuses a level the map does not take, a missing level and a repeat, by line', () => {
    expect(parseMap('tags=none', ['read', 'write'])).toEqual({
      error: 'Line 1: the level is one of read, write',
    });
    expect(parseMap('a=read\ncore.note', ['read', 'write'])).toEqual({
      error: 'Line 2: expected pattern=level',
    });
    expect(parseMap('a=read\na=write', ['read', 'write'])).toEqual({
      error: 'Line 2: a is given twice',
    });
  });

  it('reads claimed sources and refuses the server’s own prefixes', () => {
    expect(parseSources(' a, b ,a,')).toEqual({ sources: ['a', 'b'] });
    expect(parseSources('oauth:x')).toEqual({ error: 'oauth:x is reserved to the server' });
  });
});

describe('an edit', () => {
  it('sends only what changed, so a permission the editor lacks is not named again', () => {
    const next = {
      label: 'raycast',
      default_tier: 'library' as const,
      permissions: [...(FULL.permissions ?? [])].reverse(),
      sources: [],
      type_permissions: { '*': 'write' },
      metadata_permissions: { '*': 'write' },
      edge_permissions: { '*': 'read' },
      extension_permissions: { '*': 'write' },
      profile_permissions: { '*': 'write' },
    };
    expect(changedKeyFields(FULL, next)).toEqual({ edge_permissions: { '*': 'read' } });
    expect(
      changedKeyFields(FULL, { ...next, edge_permissions: { '*': 'write' }, label: 'laptop' }),
    ).toEqual({
      label: 'laptop',
    });
  });
});

describe('a key in a row', () => {
  it('is summed up by what it reaches', () => {
    expect(keySummary(FULL)).toBe('Everything');
    expect(keySummary(key({ is_operator: true }))).toBe('Operator');
    expect(
      keySummary(
        key({
          type_permissions: { '*': 'read' },
          metadata_permissions: { '*': 'read' },
          edge_permissions: { '*': 'read' },
        }),
      ),
    ).toBe('Read only');
    expect(
      keySummary(key({ type_permissions: { '*': 'write' }, permissions: ['items.purge'] })),
    ).toBe('Content and items.purge');
    expect(keySummary(key({ type_permissions: { '*': 'write' } }))).toBe('Content');
    expect(keySummary(key())).toBe('Nothing');
  });
});

describe('a refused key write', () => {
  const refusal = (status: number, message: string, details: object) =>
    new MarfaRequestError(status, {
      error: { code: status === 409 ? 'conflict' : 'forbidden', message, details },
    });

  it('names a taken source on the source field', () => {
    expect(
      keyRefusal(
        refusal(409, 'Source "raycast" is already another key\'s own', { source: 'raycast' }),
      ),
    ).toEqual({
      field: 'source',
      message: 'raycast is already another key’s source; choose another',
    });
  });

  it('names a permission the minting key lacks on the permissions field', () => {
    expect(keyRefusal(refusal(403, 'x', { required_scope: 'items.purge' }))).toEqual({
      field: 'permissions',
      message: 'This key does not hold items.purge, so it cannot give it to another',
    });
    expect(keyRefusal(refusal(403, 'x', { required_scope: 'keys.mint' }))).toEqual({
      message: 'The API Key does not hold keys.mint, so it cannot manage keys',
    });
  });

  it('leaves a reach the server explains in its own words', () => {
    const reach = refusal(
      403,
      'This credential does not hold *:write, so it cannot give a key reach it does not hold itself.',
      { required_scope: '*:write' },
    );
    expect(keyRefusal(reach)).toEqual({ message: reach.message });
    expect(keyRefusal(new Error('x'))).toBeUndefined();
  });
});
