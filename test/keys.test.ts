import { describe, expect, it } from 'vitest';
import { MarfaRequestError } from '../src/failure';
import {
  canManageKeys,
  changedKeyFields,
  formatMap,
  isReservedSource,
  keyRefusal,
  mapIsEditable,
  reachFromForm,
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
    expires_at: null,
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
    // A narrow read-only key, a denial, and permissions with no map.
    expect(keySummary(key({ type_permissions: { 'core.note': 'read' } }))).toBe('Read only');
    expect(keySummary(key({ type_permissions: { '*': 'read', 'app.x': 'none' } }))).toBe(
      'Read only',
    );
    expect(keySummary(key({ permissions: ['audit.read'] }))).toBe('audit.read');
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
    const purge = refusal(
      403,
      'This credential does not hold items.purge, so it cannot give a key a permission it does not hold itself.',
      { required_scope: 'items.purge' },
    );
    expect(keyRefusal(purge)).toEqual({ field: 'permissions', message: purge.message });
    expect(keyRefusal(refusal(403, 'x', { required_scope: 'keys.mint' }))).toEqual({
      message: 'The API Key does not hold keys.mint, so it cannot manage keys',
    });
  });

  it('names a source it cannot grant, or one another key claims, on the field that holds it', () => {
    const claimed = refusal(403, 'Source "shared" is claimed by another key', { source: 'shared' });
    expect(keyRefusal(claimed, 'shared')).toEqual({ field: 'source', message: claimed.message });
    expect(keyRefusal(claimed, 'mine')).toEqual({ field: 'sources', message: claimed.message });
  });

  it('leaves a reach the server explains in its own words', () => {
    const reach = refusal(
      403,
      'This credential does not hold *:write, so it cannot give a key reach it does not hold itself.',
      { required_scope: '*:write' },
    );
    expect(keyRefusal(reach)).toEqual({ field: 'type_permissions', message: reach.message });
    const edge = refusal(403, 'no edges', { required_scope: 'edge.references:write' });
    expect(keyRefusal(edge)?.field).toBe('edge_permissions');
    expect(keyRefusal(refusal(403, 'no namespace', {}))).toEqual({ message: 'no namespace' });
    expect(keyRefusal(new Error('x'))).toBeUndefined();
  });
});

describe('what the form reads', () => {
  it('leaves out a map whose text is as the form started it', () => {
    const started = { type_permissions: 'core.note=write', edge_permissions: '' };
    const read = reachFromForm(
      {
        type_permissions: 'core.note=write',
        edge_permissions: 'references=write',
        sources: '',
        permissions: [],
      },
      started,
    );
    expect(read).toEqual({
      reach: { edge_permissions: { references: 'write' }, sources: [], permissions: [] },
    });
  });

  it('sends a map it could not show, never', () => {
    // A pattern with a trailing space is trimmed by the lines, so a label-only edit would narrow or widen it.
    expect(mapIsEditable({ 'core.note ': 'read', '*': 'none' }, ['read', 'write', 'none'])).toBe(
      false,
    );
    expect(mapIsEditable({ 'core.note': 'read' }, ['read', 'write', 'none'])).toBe(true);
    expect(mapIsEditable(undefined, ['read', 'write'])).toBe(true);
  });

  it('reads lines split either way, trimmed, with the level after the last =', () => {
    expect(parseMap('a=read\r\n  b = write  ', ['read', 'write'])).toEqual({
      map: { a: 'read', b: 'write' },
    });
    expect(parseMap('a=b=write', ['read', 'write'])).toEqual({ map: { 'a=b': 'write' } });
    expect(parseMap('=write', ['read', 'write'])).toEqual({
      error: 'Line 1: expected pattern=level',
    });
  });

  it('refuses the server’s prefixes in any case, and an overlong source', () => {
    expect(parseSources('connector:x')).toEqual({ error: 'connector:x is reserved to the server' });
    expect(isReservedSource('OAuth:x')).toBe(true);
    expect(parseSources('x'.repeat(201))).toEqual({ error: 'A source is at most 200 characters' });
  });
});

describe('an edit’s changes', () => {
  const base = {
    label: 'raycast',
    default_tier: 'library' as const,
  };

  it('sends a tier, a claimed source or a permission changed, and one added on the end', () => {
    expect(changedKeyFields(FULL, { ...base, default_tier: 'feed' })).toEqual({
      default_tier: 'feed',
    });
    expect(changedKeyFields(FULL, { ...base, sources: ['other'] })).toEqual({ sources: ['other'] });
    expect(
      changedKeyFields(key({ permissions: ['audit.read'] }), {
        ...base,
        permissions: ['audit.read', 'items.purge'],
      }),
    ).toEqual({
      permissions: ['audit.read', 'items.purge'],
    });
    expect(
      changedKeyFields(key({ type_permissions: { a: 'read' } }), {
        ...base,
        type_permissions: { a: 'read', b: 'read' },
      }),
    ).toEqual({
      type_permissions: { a: 'read', b: 'read' },
    });
    expect(
      changedKeyFields(key({ type_permissions: { a: 'read', b: 'read' } }), {
        ...base,
        type_permissions: { a: 'read' },
      }),
    ).toEqual({
      type_permissions: { a: 'read' },
    });
  });
});

describe('a key in a row, at the edges', () => {
  it('is Everything only with all seven permissions, every content map at *=write and no denial', () => {
    expect(keySummary({ ...FULL, permissions: FULL.permissions?.slice(1) })).toBe(
      'Content and 6 permissions',
    );
    expect(
      keySummary({ ...FULL, type_permissions: { '*': 'write', 'core.secret': 'none' } }),
    ).not.toBe('Everything');
    expect(keySummary({ ...FULL, metadata_permissions: { tags: 'write' } })).not.toBe('Everything');
  });

  it('reads a denial as nothing granted, and only the content maps for its reach', () => {
    expect(keySummary(key({ type_permissions: { '*': 'none' } }))).toBe('Nothing');
    expect(keySummary(key({ profile_permissions: { '*': 'write' } }))).toBe('Nothing');
  });
});

describe('a refused key write, at the edges', () => {
  const body = (status: number, details: object) =>
    new MarfaRequestError(status, { error: { code: 'x', message: 'refused', details } });

  it('reads the field a validation refusal names by its path', () => {
    expect(keyRefusal(body(400, { errors: [{ path: 'sources.0', message: 'Too long' }] }))).toEqual(
      {
        field: 'sources',
        message: 'Too long',
      },
    );
    expect(
      keyRefusal(body(400, { errors: [{ path: 'source', message: 'Too long' }] }))?.field,
    ).toBe('source');
  });

  it('answers nothing for what it does not know, and reads a scope only on a 403', () => {
    expect(keyRefusal(body(409, {}))).toBeUndefined();
    expect(keyRefusal(body(400, { required_scope: 'items.purge' }))).toBeUndefined();
    expect(keyRefusal(body(403, { required_scope: 'items.purge', source: 'x' }))?.field).toBe(
      'permissions',
    );
  });
});
