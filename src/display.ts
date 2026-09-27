import type { Item, TypeDefinition } from './marfa';
import { noteExcerpt, noteTitle } from './notes';

/**
 * How an item reads, resolved against the registry the server returned.
 *
 * Marfa instances register their own types, so nothing here names a type
 * beyond the note: a type's label and the fields that name it come from the
 * registry, walked through `parent` so a subtype inherits its parent's hints.
 */

export const NOTE_TYPE = 'core.note';
export const BOOKMARK_TYPE = 'core.bookmark';

export interface Registry {
  label(typeId: string): string;
  /** A note or a type declared beneath one, which the other apps list as notes too. */
  isNote(typeId: string): boolean;
  titleOf(item: Item): string;
  subtitleOf(item: Item): string;
  /** The markdown a detail pane shows for the item. */
  bodyOf(item: Item): string;
  /** Types a person would filter by, ordered by label. */
  filterable(): TypeDefinition[];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildRegistry(types: readonly TypeDefinition[] | undefined): Registry {
  const byId = new Map((types ?? []).map((type) => [type.id, type]));

  function* lineage(typeId: string): Generator<TypeDefinition> {
    const seen = new Set<string>();
    for (
      let type = byId.get(typeId);
      type && !seen.has(type.id);
      type = type.parent ? byId.get(type.parent) : undefined
    ) {
      seen.add(type.id);
      yield type;
    }
  }

  function hint(typeId: string, key: 'title_field' | 'body_field'): string | undefined {
    for (const type of lineage(typeId)) {
      const field = text(type.display_hints?.[key]);
      if (field) return field;
    }
    return undefined;
  }

  function label(typeId: string): string {
    const own = text(byId.get(typeId)?.label);
    if (own) return own;
    const leaf = typeId.split('.').pop() ?? typeId;
    return leaf.charAt(0).toUpperCase() + leaf.slice(1);
  }

  function isNote(typeId: string): boolean {
    if (typeId === NOTE_TYPE) return true;
    for (const type of lineage(typeId)) if (type.id === NOTE_TYPE) return true;
    return false;
  }

  function bodyOf(item: Item): string {
    const field = hint(item.type, 'body_field') ?? 'body';
    return text(item.properties[field]) ?? text(item.properties.description) ?? '';
  }

  function titleOf(item: Item): string {
    if (isNote(item.type)) return noteTitle(bodyOf(item));
    const field = hint(item.type, 'title_field');
    const p = item.properties;
    return (
      (field ? text(p[field]) : undefined) ??
      text(p.title) ??
      text(p.name) ??
      text(p.url) ??
      label(item.type)
    );
  }

  function subtitleOf(item: Item): string {
    if (isNote(item.type)) return noteExcerpt(bodyOf(item));
    const body = bodyOf(item);
    return body ? noteTitle(body) : '';
  }

  return {
    label,
    isNote,
    titleOf,
    subtitleOf,
    bodyOf,
    filterable: () =>
      (types ?? [])
        .filter((type) => !type.id.startsWith('system.'))
        .sort((a, b) => label(a.id).localeCompare(label(b.id))),
  };
}

/**
 * The properties an edit changed, and only those. Sending the whole form
 * would overwrite a field someone else changed meanwhile with the value this
 * form happened to load.
 */
export function changedProperties(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => before[key] !== value));
}

/** Tags as typed: comma-separated, trimmed, each once, in the order first given. */
export function parseTags(input: string | undefined): string[] {
  const tags = (input ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

export function isWebUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** What a clipboard's text becomes: a lone web address a bookmark, anything else a note. */
export function captureFromText(
  raw: string,
): { type: string; properties: Record<string, unknown>; noun: string } | null {
  const value = raw.trim();
  if (!value) return null;
  if (isWebUrl(value)) return { type: BOOKMARK_TYPE, properties: { url: value }, noun: 'Bookmark' };
  return { type: NOTE_TYPE, properties: { body: value }, noun: 'Note' };
}
