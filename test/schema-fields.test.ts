import { describe, expect, it } from 'vitest';
import { requiredFieldNames, resolveSchemaFields } from '../src/schema-fields';
import { schema } from './fixtures';
import type { TypeSchema } from '@withmarfa/sdk';

const field = (over: Record<string, unknown> = {}) => ({ type: 'string', ...over }) as never;

/** A schema carrying the top-level form a server that does not normalize may
 *  still emit. The published type has no such property, which is why the
 *  extension previously read one that was never there. */
const withLegacyRequired = (id: string, required: string[], fields: string[]): TypeSchema =>
  ({
    ...schema(id, { fields: Object.fromEntries(fields.map((f) => [f, field()])) }),
    required,
  }) as TypeSchema;

describe('requiredFieldNames', () => {
  it('reads the per-field flag, which is what a current server sends', () => {
    const registry = [
      schema('core.event', {
        fields: { title: field({ required: true }), description: field() },
      }),
    ];
    expect([...requiredFieldNames(registry, 'core.event')]).toEqual(['title']);
  });

  it('reads the top-level array too, which is the half that was missing', () => {
    // The platform's schema validator accepts both forms and says so in its own
    // rejection hint. Reading only the array found nothing on a normalized
    // server, so every type reported requiring nothing and no capture was ever
    // refused before it reached the network.
    const registry = [withLegacyRequired('acme.thing', ['sku'], ['sku', 'note'])];
    expect([...requiredFieldNames(registry, 'acme.thing')]).toEqual(['sku']);
  });

  it('unions the two rather than preferring either', () => {
    const registry = [
      {
        ...schema('acme.thing', {
          fields: { sku: field(), title: field({ required: true }) },
        }),
        required: ['sku'],
      } as TypeSchema,
    ];
    expect([...requiredFieldNames(registry, 'acme.thing')].sort()).toEqual(['sku', 'title']);
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

  it('drops a name whose field the type does not have', () => {
    // A stale entry in a top-level array would otherwise make a form
    // unsubmittable with no control that could ever satisfy it.
    const registry = [withLegacyRequired('acme.thing', ['sku', 'removed_field'], ['sku'])];
    expect([...requiredFieldNames(registry, 'acme.thing')]).toEqual(['sku']);
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
