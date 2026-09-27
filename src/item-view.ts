import { BLOB_SUPPLIED_FIELDS } from './capture-blob';
import type { Registry } from './display';
import type { Edge, Item } from './marfa';
import { RESERVED_ITEM_FIELDS } from './schema-fields';

/**
 * How one item reads in the detail view. Pure, so what the view shows is
 * tested without Raycast.
 */

/** Fields a body is read from after the type's own, in the order the view shows them. */
const CONVENTIONAL_BODY_FIELDS = ['body', 'description', 'text', 'notes'];

export function bodyFieldsToRender(bodyField: string | undefined): string[] {
  const conventional = CONVENTIONAL_BODY_FIELDS.filter((field) => field !== bodyField);
  return bodyField ? [bodyField, ...conventional] : conventional;
}

function readable(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** The detail's markdown: the image, the name, every body field that holds text, and the link. */
export function buildItemMarkdown(options: {
  item: Item;
  title: string;
  bodyField?: string;
  /** Hidden from the page because the title already says it, as a note's first line does. */
  titleIsBody?: boolean;
  imageUrl?: string | null;
}): string {
  const { item, title, bodyField, imageUrl } = options;
  const lines: string[] = [];
  if (imageUrl) lines.push(`![${title.replace(/[[\]]/g, '')}](${imageUrl})`, '');
  if (!options.titleIsBody) lines.push(`# ${title}`, '');
  for (const field of bodyFieldsToRender(bodyField)) {
    const value = readable(item.properties[field]);
    if (value) lines.push(value, '');
  }
  const url = readable(item.properties.url);
  if (url && bodyField !== 'url') lines.push(`[${url}](${url})`, '');
  return lines.join('\n').trimEnd() || `_${title}_`;
}

/** Properties the page itself shows, so the sidebar leaves them out. */
const RENDERED_KEYS = new Set(['title', 'name', 'url', ...CONVENTIONAL_BODY_FIELDS]);

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;

export type SidebarEntry =
  | { kind: 'datetime'; key: string; value: string }
  | { kind: 'url'; key: string; value: string }
  | { kind: 'boolean'; key: string; value: boolean }
  | { kind: 'number'; key: string; value: number }
  | { kind: 'string'; key: string; value: string }
  | { kind: 'list'; key: string; value: string }
  | { kind: 'complex'; key: string; value: unknown };

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function classifyProperty(key: string, value: unknown): SidebarEntry | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return null;
    if (ISO_DATETIME.test(value)) return { kind: 'datetime', key, value };
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return { kind: 'url', key, value };
    }
    return { kind: 'string', key, value };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', key, value };
  if (typeof value === 'number') return { kind: 'number', key, value };
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every(isScalar)) return { kind: 'list', key, value: value.map(String).join(', ') };
    return { kind: 'complex', key, value };
  }
  if (typeof value === 'object' && Object.keys(value).length > 0) {
    return { kind: 'complex', key, value };
  }
  return null;
}

/**
 * The properties the sidebar lists: everything the page does not already
 * show, in the item's own order. An image's data and a blob's reference are
 * left to the page and the copy actions.
 */
export function sidebarEntries(
  item: Item,
  alsoRendered: Iterable<string | undefined> = [],
): SidebarEntry[] {
  const skip = new Set<string>([...RENDERED_KEYS, ...BLOB_SUPPLIED_FIELDS]);
  for (const key of alsoRendered) if (key) skip.add(key);
  const entries: SidebarEntry[] = [];
  for (const [key, value] of Object.entries(item.properties)) {
    if (skip.has(key) || RESERVED_ITEM_FIELDS.has(key)) continue;
    const entry = classifyProperty(key, value);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** What a nested value is, in the width of a sidebar row; the value itself is a copy away. */
export function summarizeComplex(value: unknown): string {
  if (Array.isArray(value))
    return value.length === 1 ? '1 entry' : `${String(value.length)} entries`;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).length;
    return keys === 1 ? '1 key' : `${String(keys)} keys`;
  }
  return String(value);
}

export type ImageSource =
  | { kind: 'url'; url: string }
  | { kind: 'blob'; hash: string; mimeType: string }
  | { kind: 'data'; url: string };

const COVER_URL_KEYS = ['cover_url', 'image_url', 'thumbnail_url', 'poster_url', 'artwork_url'];

/**
 * The picture an item carries, best first: its own stored image, its
 * thumbnail, then a cover it links to. A stored file is an image by its media
 * type, whatever its type is called.
 */
export function imageSource(item: Item, registry: Registry): ImageSource | null {
  const p = item.properties;
  if (typeof p.blob_ref === 'string' && typeof p.mime_type === 'string') {
    if (p.mime_type.startsWith('image/') && p.mime_type !== 'image/svg+xml') {
      return { kind: 'blob', hash: p.blob_ref, mimeType: p.mime_type };
    }
  }
  for (const [name, field] of Object.entries(registry.fields(item.type))) {
    const value = p[name];
    if (
      field.type === 'thumbnail' &&
      typeof value === 'string' &&
      value.startsWith('data:image/')
    ) {
      return { kind: 'data', url: value };
    }
  }
  for (const key of COVER_URL_KEYS) {
    const value = p[key];
    if (typeof value === 'string' && /^https?:\/\//.test(value)) return { kind: 'url', url: value };
  }
  return null;
}

/** The largest stored image the view draws inline; past it, a data URI stalls the page. */
export const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export interface Relation {
  edge: Edge;
  /** The item at the other end: the target of an outbound edge, the source of an inbound one. */
  otherId: string;
  direction: 'outbound' | 'inbound';
}

/** An item's edges both ways, grouped by direction and then by edge type, in the order met. */
export function groupRelations(edges: {
  outbound: Edge[];
  inbound: Edge[];
}): { title: string; relations: Relation[] }[] {
  const groups = new Map<string, Relation[]>();
  const add = (title: string, relation: Relation) => {
    const group = groups.get(title);
    if (group) group.push(relation);
    else groups.set(title, [relation]);
  };
  for (const edge of edges.outbound) {
    add(`${edge.edge_type}: links to`, { edge, otherId: edge.target_id, direction: 'outbound' });
  }
  for (const edge of edges.inbound) {
    add(`${edge.edge_type}: linked from`, { edge, otherId: edge.source_id, direction: 'inbound' });
  }
  return [...groups.entries()].map(([title, relations]) => ({ title, relations }));
}

/** Every item at the other end of the relations, each once. */
export function relatedIds(groups: { relations: Relation[] }[]): string[] {
  return [...new Set(groups.flatMap((group) => group.relations.map((r) => r.otherId)))];
}
