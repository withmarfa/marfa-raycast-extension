import { describe, expect, it } from 'vitest';
import {
  buildRegistry,
  captureFromText,
  changedProperties,
  isWebUrl,
  parseTags,
} from '../src/display';
import type { Item, TypeDefinition } from '../src/marfa';

function type(id: string, extra: Partial<TypeDefinition> = {}): TypeDefinition {
  return { id, fields: {}, version: 1, ...extra };
}

function item(typeId: string, properties: Record<string, unknown>): Item {
  return {
    id: 'i1',
    type: typeId,
    properties,
    state: 'active',
    version: 1,
    schema_version: 1,
    source: 'raycast',
    occurred_at: '2026-09-27T10:00:00.000Z',
    created_at: '2026-09-27T10:00:00.000Z',
    updated_at: '2026-09-27T10:00:00.000Z',
  };
}

const registry = buildRegistry([
  type('core.note', { label: 'Note', display_hints: { title_field: 'title', body_field: 'body' } }),
  type('app.journal', { label: 'Journal', parent: 'core.note' }),
  type('core.bookmark', { label: 'Bookmark', display_hints: { title_field: 'title' } }),
  type('core.email', {
    label: 'Email',
    display_hints: { title_field: 'subject', body_field: 'text' },
  }),
  type('system.key', { label: 'Key' }),
]);

describe('the registry names an item', () => {
  it('names a note by its body, never by its stored title', () => {
    const note = item('core.note', { title: '27 September 2026', body: '## Groceries\neggs' });
    expect(registry.titleOf(note)).toBe('Groceries');
    expect(registry.subtitleOf(note)).toBe('eggs');
  });

  it('treats a type declared beneath the note as a note', () => {
    expect(registry.isNote('app.journal')).toBe(true);
    expect(registry.titleOf(item('app.journal', { body: 'Dear diary' }))).toBe('Dear diary');
    expect(registry.isNote('core.bookmark')).toBe(false);
  });

  it('follows the registry hints for other types, then the usual fields, then the label', () => {
    expect(registry.titleOf(item('core.email', { subject: 'Invoice', text: 'Attached' }))).toBe(
      'Invoice',
    );
    expect(registry.bodyOf(item('core.email', { subject: 'Invoice', text: 'Attached' }))).toBe(
      'Attached',
    );
    expect(registry.titleOf(item('core.bookmark', { url: 'https://example.com' }))).toBe(
      'https://example.com',
    );
    expect(registry.titleOf(item('core.bookmark', {}))).toBe('Bookmark');
    expect(registry.label('vendor.thing')).toBe('Thing');
  });

  it('survives a parent chain that loops', () => {
    const looped = buildRegistry([type('a.x', { parent: 'a.y' }), type('a.y', { parent: 'a.x' })]);
    expect(looped.isNote('a.x')).toBe(false);
  });

  it('offers every type but the system ones as a filter, by label', () => {
    expect(registry.filterable().map((t) => t.id)).toEqual([
      'core.bookmark',
      'core.email',
      'app.journal',
      'core.note',
    ]);
  });
});

describe('an edit sends only what changed', () => {
  it('drops unchanged properties', () => {
    expect(changedProperties({ body: 'a', title: 't' }, { body: 'a' })).toEqual({});
    expect(changedProperties({ body: 'a', title: 't' }, { body: 'b' })).toEqual({ body: 'b' });
    expect(changedProperties({}, { body: '' })).toEqual({ body: '' });
  });
});

describe('tags as typed', () => {
  it('are trimmed, deduplicated and kept in order', () => {
    expect(parseTags(' reading, later ,reading,, ')).toEqual(['reading', 'later']);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe('what the clipboard becomes', () => {
  it('a lone web address is a bookmark', () => {
    expect(captureFromText('  https://example.com/a?b=1 \n')).toEqual({
      type: 'core.bookmark',
      properties: { url: 'https://example.com/a?b=1' },
      noun: 'Bookmark',
    });
  });

  it('anything else is a note, including text that holds a link', () => {
    expect(captureFromText('Read https://example.com later')?.type).toBe('core.note');
    expect(captureFromText('mailto:someone@example.com')?.type).toBe('core.note');
    expect(captureFromText('line one\nline two')?.properties).toEqual({
      body: 'line one\nline two',
    });
  });

  it('nothing but space is nothing', () => {
    expect(captureFromText(' \n\t')).toBeNull();
    expect(isWebUrl('ftp://example.com')).toBe(false);
  });
});
