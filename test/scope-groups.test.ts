import { describe, expect, it } from 'vitest';
import { flattenScopes, groupScopes } from '../src/scope-groups';

/**
 * A slice of what an instance actually advertises, taken from a live discovery
 * document rather than invented. The shapes that matter are all here: paired
 * read and write halves, wildcards at two depths, and the OpenID scopes that
 * carry no access at all.
 */
const SAMPLE = [
  'core.bookmark:write',
  'core.bookmark:read',
  'core.entity.person:read',
  'core.*:read',
  'edge.about:read',
  'edge.about:write',
  'openid',
  'profile',
  'offline_access',
  'profile:read',
  'profile.name:read',
  '*:read',
];

const familyNames = (scopes: string[]) => groupScopes(scopes).map((family) => family.name);
const family = (scopes: string[], name: string) =>
  groupScopes(scopes).find((entry) => entry.name === name);

describe('groupScopes', () => {
  it('pairs the read and write halves of one resource onto one row', () => {
    // The whole reason this exists. Sixty-odd scopes are around thirty
    // resources, and the flat list rendered every half separately.
    const groups = family(SAMPLE, 'core')?.groups ?? [];
    const bookmark = groups.find((group) => group.resource === 'core.bookmark');
    expect(bookmark?.accesses).toEqual(['read', 'write']);
    expect(bookmark?.scopes).toEqual(['core.bookmark:read', 'core.bookmark:write']);
  });

  it('orders read before write however the server advertised them', () => {
    // The fixture lists write first on purpose. A row whose tags reorder
    // because the server changed its mind is a row that reads as a change.
    expect(family(['x:write', 'x:read'], 'x')?.groups[0].accesses).toEqual(['read', 'write']);
  });

  it('groups by the leading segment, so a subtype sits with its namespace', () => {
    const core = family(SAMPLE, 'core');
    expect(core?.groups.map((group) => group.resource)).toEqual([
      'core.*',
      'core.bookmark',
      'core.entity.person',
    ]);
  });

  it('keeps a bare scope apart from the resource that shares its name', () => {
    // `profile` is an OpenID scope and `profile:read` is a permission over the
    // profile resource. Keying on the name alone merges two unrelated things,
    // and this is the only pair in the advertisement where that can happen.
    expect(family(SAMPLE, 'sign-in')?.groups.map((group) => group.resource)).toEqual([
      'offline_access',
      'openid',
      'profile',
    ]);
    expect(family(SAMPLE, 'profile')?.groups.map((group) => group.resource)).toEqual([
      'profile',
      'profile.name',
    ]);
    expect(family(SAMPLE, 'sign-in')?.groups[2].accesses).toEqual([]);
    expect(family(SAMPLE, 'profile')?.groups[0].accesses).toEqual(['read']);
  });

  it('splits at the last colon, so a resource carrying one still parses', () => {
    // Nothing advertises this today. The function chose `lastIndexOf` on
    // purpose, and without a case holding two colons that choice is untested
    // and `indexOf` would pass every other assertion here.
    const groups = groupScopes(['urn:core.note:read']);
    expect(groups[0].groups[0].resource).toBe('urn:core.note');
    expect(groups[0].groups[0].accesses).toEqual(['read']);
  });

  it('gives the two families a person would not recognize a readable title', () => {
    const labels = new Map(groupScopes(SAMPLE).map((entry) => [entry.name, entry.label]));
    expect(labels.get('*')).toBe('Everything');
    expect(labels.get('sign-in')).toBe('Sign-in');
    // Everything else is already the word an operator uses for it.
    expect(labels.get('core')).toBe('core');
  });

  it('labels a family named after something on Object.prototype', () => {
    // The family name comes from a remote document. An object literal would
    // answer `constructor` with an inherited function, which reaches the
    // section title as a React child rather than as text.
    expect(family(['constructor:read'], 'constructor')?.label).toBe('constructor');
    expect(family(['toString:read'], 'toString')?.label).toBe('toString');
  });

  it('counts scopes rather than rows, because scopes are what is missing', () => {
    // `core` holds three rows and four scopes. `sign-in` is the family that
    // separates counting scopes from counting accesses: three rows, three
    // scopes, and no accesses at all between them.
    expect(family(SAMPLE, 'core')?.groups).toHaveLength(3);
    expect(family(SAMPLE, 'core')?.scopeCount).toBe(4);
    expect(family(SAMPLE, 'sign-in')?.groups).toHaveLength(3);
    expect(family(SAMPLE, 'sign-in')?.scopeCount).toBe(3);
  });

  it('sorts families alphabetically, which puts the widest scope first', () => {
    expect(familyNames(SAMPLE)).toEqual(['*', 'core', 'edge', 'profile', 'sign-in']);
  });

  it('treats a malformed scope as a name rather than inventing an empty half', () => {
    // Nothing advertises these. A colon at either end would otherwise produce a
    // row with no title or a tag with no text, which reads as a rendering bug
    // rather than as the server having sent something odd.
    const groups = groupScopes([':read', 'trailing:']);
    expect(groups.map((entry) => entry.name)).toEqual(['sign-in']);
    expect(groups[0].groups.map((group) => group.resource)).toEqual([':read', 'trailing:']);
    expect(groups[0].groups.every((group) => group.accesses.length === 0)).toBe(true);
  });

  it('drops a scope that is empty, which has no row to be', () => {
    expect(groupScopes(['', '   ', 'core.note:read'])).toHaveLength(1);
    expect(groupScopes(['', '   '])).toEqual([]);
  });

  it('says nothing when there is nothing missing', () => {
    expect(groupScopes([])).toEqual([]);
  });
});

describe('flattenScopes', () => {
  it('reproduces every scope exactly once, in the order the list shows them', () => {
    // What the copy action puts on the clipboard. A grouping that dropped or
    // duplicated an entry would disagree with the count beside it, and an order
    // that disagreed with the screen would make the paste hard to check.
    const flat = flattenScopes(groupScopes(SAMPLE));
    expect(flat.slice().sort()).toEqual(SAMPLE.slice().sort());
    expect(flat.slice(0, 5)).toEqual([
      '*:read',
      'core.*:read',
      'core.bookmark:read',
      'core.bookmark:write',
      'core.entity.person:read',
    ]);
  });
});
