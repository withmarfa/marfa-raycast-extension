import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../src/display';
import {
  bodyFieldsToRender,
  buildItemMarkdown,
  classifyProperty,
  groupRelations,
  imageSource,
  relatedIds,
  sidebarEntries,
  summarizeComplex,
} from '../src/item-view';
import type { Edge, Item } from '../src/marfa';
import { schema } from './fixtures';

function item(properties: Record<string, unknown>, type = 'core.note'): Item {
  return {
    id: 'i1',
    type,
    state: 'active',
    tier: 'library',
    properties,
    created_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
    occurred_at: '2026-09-05T10:00:00.000Z',
    version: 1,
    schema_version: 1,
    source: 'test',
  } as Item;
}

function edge(source: string, target: string, type: string): Edge {
  return {
    id: `${source}-${target}`,
    source_id: source,
    target_id: target,
    edge_type: type,
    properties: {},
    created_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
    version: 1,
  };
}

describe('the detail page', () => {
  it('renders the body once when the type names the conventional field', () => {
    const markdown = buildItemMarkdown({
      item: item({ body: 'Hello' }),
      title: 'Hi',
      bodyField: 'body',
    });
    expect(markdown.match(/Hello/g)).toHaveLength(1);
  });

  it('leads with the type’s own body field, then keeps the others', () => {
    const markdown = buildItemMarkdown({
      item: item({ method: 'Bake it.', notes: 'Use rye.' }, 'user.recipe'),
      title: 'Loaf',
      bodyField: 'method',
    });
    expect(markdown).toBe('# Loaf\n\nBake it.\n\nUse rye.');
  });

  it('shows a note without a heading, since its first line is its name', () => {
    expect(
      buildItemMarkdown({
        item: item({ body: '# Plan\n\nGo' }),
        title: 'Plan',
        bodyField: 'body',
        titleIsBody: true,
      }),
    ).toBe('# Plan\n\nGo');
  });

  it('puts the image above everything and the link below, once', () => {
    const markdown = buildItemMarkdown({
      item: item({ url: 'https://example.org' }, 'core.bookmark'),
      title: 'Example [site]',
      imageUrl: 'data:image/png;base64,AAAA',
    });
    expect(markdown).toBe(
      '![Example site](data:image/png;base64,AAAA)\n\n# Example [site]\n\n[https://example.org](https://example.org)',
    );
    expect(
      buildItemMarkdown({ item: item({ url: 'https://x.org' }), title: 'x', bodyField: 'url' }),
    ).not.toContain('](https://x.org)');
  });

  it('is never blank', () => {
    expect(buildItemMarkdown({ item: item({}), title: 'Empty', titleIsBody: true })).toBe(
      '_Empty_',
    );
  });

  it('orders body fields with the type’s own first', () => {
    expect(bodyFieldsToRender('description')).toEqual(['description', 'body', 'text', 'notes']);
    expect(bodyFieldsToRender(undefined)).toEqual(['body', 'description', 'text', 'notes']);
  });
});

describe('the sidebar', () => {
  it('drops what has nothing to show and keeps false and zero', () => {
    expect(classifyProperty('a', '')).toBeNull();
    expect(classifyProperty('a', [])).toBeNull();
    expect(classifyProperty('a', {})).toBeNull();
    expect(classifyProperty('a', false)).toEqual({ kind: 'boolean', key: 'a', value: false });
    expect(classifyProperty('a', 0)).toEqual({ kind: 'number', key: 'a', value: 0 });
  });

  it('tells a timestamp and a link from text, and a bare date is text', () => {
    expect(classifyProperty('due', '2026-10-01T09:00:00Z')?.kind).toBe('datetime');
    expect(classifyProperty('link', 'https://example.org')?.kind).toBe('url');
    expect(classifyProperty('day', '2026-10-01')?.kind).toBe('string');
  });

  it('joins a list of scalars and summarises a structure', () => {
    expect(classifyProperty('tags', ['a', 1, true])).toEqual({
      kind: 'list',
      key: 'tags',
      value: 'a, 1, true',
    });
    expect(classifyProperty('rows', [{ a: 1 }])?.kind).toBe('complex');
    expect(summarizeComplex([{ a: 1 }])).toBe('1 entry');
    expect(summarizeComplex({ a: 1, b: 2 })).toBe('2 keys');
  });

  it('leaves out what the page shows, the blob’s fields, item fields and image data', () => {
    const entries = sidebarEntries(
      item({
        title: 't',
        body: 'b',
        method: 'm',
        blob_ref: 'abc',
        mime_type: 'image/png',
        source: 'shadow',
        cover: 'data:image/png;base64,AAAA',
        serves: 4,
      }),
      ['method'],
    );
    expect(entries.map((entry) => entry.key)).toEqual(['serves']);
  });
});

describe('the picture', () => {
  const registry = buildRegistry([
    schema('user.card', { fields: { cover: { type: 'thumbnail' }, image_url: { type: 'url' } } }),
  ]);

  it('prefers a stored image, by its media type rather than its type name', () => {
    expect(
      imageSource(item({ blob_ref: 'h1', mime_type: 'image/jpeg' }, 'user.scan'), registry),
    ).toEqual({
      kind: 'blob',
      hash: 'h1',
      mimeType: 'image/jpeg',
    });
    expect(
      imageSource(item({ blob_ref: 'h1', mime_type: 'application/pdf' }, 'core.file'), registry),
    ).toBeNull();
  });

  it('then the thumbnail the type declares, then a cover it links to', () => {
    const both = item(
      { cover: 'data:image/png;base64,AAAA', image_url: 'https://example.org/a.png' },
      'user.card',
    );
    expect(imageSource(both, registry)).toEqual({
      kind: 'data',
      url: 'data:image/png;base64,AAAA',
    });
    expect(
      imageSource(item({ image_url: 'https://example.org/a.png' }, 'user.card'), registry),
    ).toEqual({
      kind: 'url',
      url: 'https://example.org/a.png',
    });
  });
});

describe('related items', () => {
  it('groups both directions by edge type, naming the item at the other end', () => {
    const groups = groupRelations({
      outbound: [edge('me', 'a', 'in-thread'), edge('me', 'b', 'references')],
      inbound: [edge('c', 'me', 'references'), edge('a', 'me', 'references')],
    });
    expect(groups.map((group) => [group.title, group.relations.map((r) => r.otherId)])).toEqual([
      ['in-thread: links to', ['a']],
      ['references: links to', ['b']],
      ['references: linked from', ['c', 'a']],
    ]);
    expect(relatedIds(groups)).toEqual(['a', 'b', 'c']);
  });
});
