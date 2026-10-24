import type { Item, TypeDefinition } from './marfa';
import { noteExcerpt, noteTitle } from './notes';
import {
  ancestry,
  type FieldDefinition,
  type Namespace,
  namespaceOf,
  requiredFieldNames,
  resolveSchemaFields,
} from './schema-fields';

/**
 * How an item reads, resolved against the registry the server returned.
 *
 * Marfa instances register their own types, so nothing here reads a type by
 * name beyond the note: a type's label, fields and the fields that name it come
 * from the registry, walked through `parent` so a subtype inherits its parent's.
 * The other identifiers below are the types the clipboard writes.
 */

export const NOTE_TYPE = 'core.note';
export const BOOKMARK_TYPE = 'core.bookmark';
export const FILE_TYPE = 'core.file';
export const IMAGE_TYPE = 'core.file.image';

export interface Registry {
  /** Every type the server answered, system ones included. */
  types: readonly TypeDefinition[];
  type(typeId: string): TypeDefinition | undefined;
  /** The type and its ancestors, nearest first. */
  lineage(typeId: string): TypeDefinition[];
  label(typeId: string): string;
  namespace(typeId: string): Namespace;
  titleField(typeId: string): string | undefined;
  bodyField(typeId: string): string | undefined;
  /** Every field the type carries, inherited ones included. */
  fields(typeId: string): Record<string, FieldDefinition>;
  required(typeId: string): Set<string>;
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

export function buildRegistry(answered: readonly TypeDefinition[] | undefined): Registry {
  const types = answered ?? [];
  const byId = new Map(types.map((type) => [type.id, type]));

  function lineage(typeId: string): TypeDefinition[] {
    return ancestry(types, typeId).reverse();
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
    if (item.type === NOTE_TYPE) return noteTitle(bodyOf(item));
    const field = hint(item.type, 'title_field');
    const p = item.properties;
    return (
      (field ? text(p[field]) : undefined) ??
      (isNote(item.type) ? noteTitle(bodyOf(item)) : undefined) ??
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
    types,
    type: (typeId) => byId.get(typeId),
    lineage,
    label,
    namespace: namespaceOf,
    titleField: (typeId) => hint(typeId, 'title_field'),
    bodyField: (typeId) => hint(typeId, 'body_field'),
    fields: (typeId) => resolveSchemaFields(types, typeId),
    required: (typeId) => requiredFieldNames(types, typeId),
    isNote,
    titleOf,
    subtitleOf,
    bodyOf,
    filterable: () =>
      types
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
