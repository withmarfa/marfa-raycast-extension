import { describe, expect, it } from 'vitest';
import {
  namespaceOf,
  requiredFieldNames,
  resolveSchemaFields,
  toTitleCase,
} from '../src/schema-fields';
import { schema } from './fixtures';

const field = (over: Record<string, unknown> = {}) => ({ type: 'string', ...over }) as never;

describe('requiredFieldNames', () => {
  it('reads the per-field flag, which is what a current server sends', () => {
    const registry = [
      schema('core.event', {
        fields: { title: field({ required: true }), description: field() },
      }),
    ];
    expect([...requiredFieldNames(registry, 'core.event')]).toEqual(['title']);
  });

  it('inherits a required field from a parent', () => {
    // A third party registering a subtype with two new fields is the ordinary
    // case, and reading its own declaration alone would miss what it inherits.
    const registry = [
      schema('acme.deal', { fields: { deal_name: field({ required: true }) } }),
      schema('acme.deal.enterprise', {
        parent: 'acme.deal',
        fields: { seats: field({ type: 'number', required: true }) },
      }),
    ];
    expect([...requiredFieldNames(registry, 'acme.deal.enterprise')].sort()).toEqual([
      'deal_name',
      'seats',
    ]);
  });

  it('says nothing about a type it has never heard of', () => {
    expect([...requiredFieldNames([], 'acme.unknown')]).toEqual([]);
    expect([...requiredFieldNames(undefined, 'acme.unknown')]).toEqual([]);
  });
});

describe('resolveSchemaFields', () => {
  it('merges a parent chain, nearest declaration winning', () => {
    const registry = [
      schema('a.parent', {
        fields: { shared: field({ description: 'from parent' }), only_parent: field() },
      }),
      schema('a.child', {
        parent: 'a.parent',
        fields: { shared: field({ description: 'from child' }), only_child: field() },
      }),
    ];
    const fields = resolveSchemaFields(registry, 'a.child');
    expect(Object.keys(fields).sort()).toEqual(['only_child', 'only_parent', 'shared']);
    expect(fields.shared.description).toBe('from child');
  });

  it('resolves what exists when an ancestor is absent from the registry', () => {
    // A server can return a subtype whose parent is filtered out of the list,
    // and a form with no controls is worse than one with the fields it knows.
    const registry = [schema('a.child', { parent: 'a.missing', fields: { own: field() } })];
    expect(Object.keys(resolveSchemaFields(registry, 'a.child'))).toEqual(['own']);
  });

  it('terminates on a parent chain that loops', () => {
    // Asserting the resolved keys rather than the absence of a throw: removing
    // the depth guard makes the walk loop forever rather than raise, and a
    // synchronous loop is not something a test timeout can interrupt. This says
    // what the answer should be when it does return, not that it will.
    const registry = [
      schema('a.one', { parent: 'a.two', fields: { one: field() } }),
      schema('a.two', { parent: 'a.one', fields: { two: field() } }),
    ];
    expect(Object.keys(resolveSchemaFields(registry, 'a.one')).sort()).toEqual(['one', 'two']);
  });
});

describe('toTitleCase', () => {
  it('splits on underscores and capitalizes only the first word', () => {
    expect(toTitleCase('published_at')).toBe('Published at');
    expect(toTitleCase('title')).toBe('Title');
  });

  it('shouts an initialism rather than lowercasing it', () => {
    // Every one of these was rendered as a word in the sidebar, which reads as
    // a typo on a screen whose whole job is showing a record accurately.
    expect(toTitleCase('source_id')).toBe('Source ID');
    expect(toTitleCase('playlist_id')).toBe('Playlist ID');
    expect(toTitleCase('html_link')).toBe('HTML link');
    expect(toTitleCase('url')).toBe('URL');
    expect(toTitleCase('mime_type')).toBe('MIME type');
    expect(toTitleCase('sha256')).toBe('SHA256');
  });

  it('leaves a word it does not know exactly as it was', () => {
    // The set is small on purpose, so a miss degrades to the old behavior
    // rather than to something wrong.
    expect(toTitleCase('etag')).toBe('Etag');
    expect(toTitleCase('privacy_status')).toBe('Privacy status');
  });

  it('returns a key it cannot split rather than an empty string', () => {
    expect(toTitleCase('')).toBe('');
    expect(toTitleCase('___')).toBe('___');
  });
});

describe('namespaceOf', () => {
  it('reads the namespace from the first segment, and anything else as a publisher', () => {
    expect(namespaceOf('core.note')).toBe('core');
    expect(namespaceOf('system.device')).toBe('system');
    expect(namespaceOf('user.recipe')).toBe('user');
    expect(namespaceOf('app.cursor.session')).toBe('app');
    expect(namespaceOf('marfa.internal')).toBe('marfa');
    expect(namespaceOf('readwise.highlight')).toBe('publisher');
  });
});
