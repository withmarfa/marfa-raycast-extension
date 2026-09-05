import { Icon } from '@raycast/api';
import { describe, expect, it } from 'vitest';
import { buildTypeRegistry } from '../src/type-display';
import { item, schema } from './fixtures';

/**
 * This file is also what proves the module boundary in `vitest.config.mts`.
 * `type-display.ts` imports `Icon` and `Color` from `@raycast/api` as values,
 * and that package ships no runtime, so a passing suite here means the alias is
 * doing its job. If it stops, everything below fails at import rather than
 * quietly asserting nothing.
 */

describe('label', () => {
  it('takes the registry label when there is one', () => {
    // The label has to differ from the humanized leaf, or the assertion passes
    // just as well against a resolver that never reads the registry at all.
    const registry = buildTypeRegistry([schema('core.note', { label: 'Quick Note' })]);
    expect(registry.label('core.note')).toBe('Quick Note');
  });

  it('humanizes the leaf segment for a type the registry does not hold', () => {
    // A self-hosted instance or a third-party publisher will carry types this
    // build has never seen, and a raw dotted identifier in a list is worse than
    // a guess made from its own last segment.
    const registry = buildTypeRegistry([]);
    expect(registry.label('core.media.book')).toBe('Book');
    expect(registry.label('acme.deal_stage')).toBe('Deal stage');
  });

  it('ignores a blank label rather than rendering one', () => {
    const registry = buildTypeRegistry([schema('core.note', { label: '   ' })]);
    expect(registry.label('core.note')).toBe('Note');
  });
});

describe('appearance', () => {
  it('takes a curated glyph for a type that has one', () => {
    const registry = buildTypeRegistry([schema('core.note')]);
    expect(registry.appearance('core.note').icon).toBe(Icon.Document);
  });

  it('inherits a family glyph through the parent chain', () => {
    // A core subtype the platform adds later should land on its family's glyph
    // rather than falling all the way out to the tier default.
    const registry = buildTypeRegistry([
      schema('core.media'),
      schema('core.media.podcast', { parent: 'core.media' }),
    ]);
    expect(registry.appearance('core.media.podcast').icon).toBe(Icon.Video);
  });

  it('falls back to the namespace tier for a type with no curated ancestor', () => {
    const registry = buildTypeRegistry([schema('user.recipe')]);
    expect(registry.appearance('user.recipe').icon).toBe(Icon.Tag);

    const publisher = buildTypeRegistry([schema('readwise.book')]);
    expect(publisher.appearance('readwise.book').icon).toBe(Icon.Plug);
  });

  it('terminates on a registry whose parent chain loops', () => {
    // Nothing stops a server returning this. Asserting the resolved value
    // rather than the absence of a throw is deliberate: removing the depth
    // guard makes the walk loop forever rather than raise, and a synchronous
    // loop is not something a test timeout can interrupt. So this cannot fail
    // fast, and the assertion is here to say what the answer should be when it
    // does return, not to catch the hang.
    const registry = buildTypeRegistry([
      schema('a.one', { parent: 'a.two' }),
      schema('a.two', { parent: 'a.one' }),
    ]);
    expect(registry.appearance('a.one').icon).toBe(Icon.Plug);
  });
});

describe('titleOf', () => {
  const registry = buildTypeRegistry([
    schema('marfa.captured_email', {
      label: 'Captured Email',
      display_hints: { title_field: 'subject', body_field: 'text_body' },
    }),
  ]);

  it('reads the field the registry named', () => {
    expect(
      registry.titleOf(item({ type: 'marfa.captured_email', properties: { subject: 'Hello' } })),
    ).toBe('Hello');
  });

  it('falls through when the item does not carry the named field', () => {
    // The hint describes the type, not this row. An older item written before
    // the field existed still has to render as something.
    expect(
      registry.titleOf(item({ type: 'marfa.captured_email', properties: { title: 'Fallback' } })),
    ).toBe('Fallback');
  });

  it('falls all the way to the type label rather than an identifier', () => {
    expect(registry.titleOf(item({ type: 'marfa.captured_email', properties: {} }))).toBe(
      'Captured Email',
    );
  });

  it('inherits a display hint from an ancestor', () => {
    const inherited = buildTypeRegistry([
      schema('acme.deal', { display_hints: { title_field: 'deal_name' } }),
      schema('acme.deal.enterprise', { parent: 'acme.deal' }),
    ]);
    expect(
      inherited.titleOf(
        item({ type: 'acme.deal.enterprise', properties: { deal_name: 'Big one' } }),
      ),
    ).toBe('Big one');
  });
});

describe('subtitleOf', () => {
  it('truncates a long body so one row cannot swallow the list', () => {
    const registry = buildTypeRegistry([
      schema('core.note', { display_hints: { body_field: 'body' } }),
    ]);
    const subtitle = registry.subtitleOf(item({ properties: { body: 'x'.repeat(300) } }));
    expect(subtitle).toHaveLength(100);
  });
});

describe('selectableTypes', () => {
  it('excludes system types and orders by label rather than by identifier', () => {
    // The labels sort against the identifiers on purpose. With labels that
    // happen to agree, sorting by id passes this too and the claim is untested.
    const registry = buildTypeRegistry([
      schema('core.bookmark', { label: 'Zettel' }),
      schema('system.connection', { label: 'Connection' }),
      schema('core.task', { label: 'Assignment' }),
    ]);
    expect(registry.selectableTypes().map((s) => s.id)).toEqual(['core.task', 'core.bookmark']);
  });
});
