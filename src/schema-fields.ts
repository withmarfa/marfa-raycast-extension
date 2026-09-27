import type { TypeDefinition } from './marfa';

/**
 * A type's fields as the server declares them, read out of the registry and
 * resolved through `parent`.
 *
 * `GET /types` answers each type's own declaration, not what it inherits, so
 * the walk is done here: root first, so a subtype's declaration of a field
 * replaces its ancestor's whole. That is what lets a subtype make an inherited
 * field optional by declaring it again without the flag, as the server does.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'url'
  | 'email'
  | 'datetime'
  | 'date'
  | 'enum'
  | 'array'
  | 'object'
  | 'thumbnail';

export interface FieldDefinition {
  /** One of `FieldType` from a current server; kept as a string, since the wire can send any. */
  type: string;
  description?: string;
  required?: boolean;
  enum_values?: string[];
  items_type?: string;
  /** `bcp47` or `iso3166` on a string. */
  format?: string;
  searchable?: boolean;
  maxLength?: number;
  maxItems?: number;
}

/** The server refuses a type field under any of these names: each is a first-class item field. */
export const RESERVED_ITEM_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'state',
  'tier',
  'properties',
  'created_at',
  'updated_at',
  'occurred_at',
  'source',
  'source_id',
  'version',
  'schema_version',
  'capture_latitude',
  'capture_longitude',
]);

/** The server's own bound on a `parent` chain. */
const MAX_RESOLUTION_DEPTH = 100;

function readField(raw: unknown): FieldDefinition | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const field = raw as Record<string, unknown>;
  if (typeof field.type !== 'string') return undefined;
  const strings = (value: unknown) =>
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      ? (value as string[])
      : undefined;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const count = (value: unknown) => (typeof value === 'number' ? value : undefined);
  return {
    type: field.type,
    description: text(field.description),
    required: field.required === true,
    enum_values: strings(field.enum_values),
    items_type: text(field.items_type),
    format: text(field.format),
    searchable: typeof field.searchable === 'boolean' ? field.searchable : undefined,
    maxLength: count(field.maxLength),
    maxItems: count(field.maxItems),
  };
}

/** One type's own fields, each read into a definition; a field the wire garbled is left out. */
export function declaredFields(type: TypeDefinition): Record<string, FieldDefinition> {
  const fields: Record<string, FieldDefinition> = {};
  for (const [name, raw] of Object.entries(type.fields ?? {})) {
    const field = readField(raw);
    if (field) fields[name] = field;
  }
  return fields;
}

/** The chain root first. A repeat ends a cycle; the server's own bound ends a pathological chain. */
export function ancestry(types: readonly TypeDefinition[], typeId: string): TypeDefinition[] {
  const byId = new Map(types.map((type) => [type.id, type]));
  const chain: TypeDefinition[] = [];
  const seen = new Set<string>();
  let current = byId.get(typeId);
  while (current && !seen.has(current.id) && chain.length < MAX_RESOLUTION_DEPTH) {
    seen.add(current.id);
    chain.push(current);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return chain.reverse();
}

/** Every field a type carries, inherited ones included. */
export function resolveSchemaFields(
  types: readonly TypeDefinition[] | undefined,
  typeId: string,
): Record<string, FieldDefinition> {
  if (!types) return {};
  return Object.assign({}, ...ancestry(types, typeId).map(declaredFields)) as Record<
    string,
    FieldDefinition
  >;
}

/**
 * The fields a type will not accept a write without, read off the resolved
 * definitions so a subtype that lifts an inherited requirement is believed.
 */
export function requiredFieldNames(
  types: readonly TypeDefinition[] | undefined,
  typeId: string,
): Set<string> {
  return new Set(
    Object.entries(resolveSchemaFields(types, typeId))
      .filter(([, field]) => field.required)
      .map(([name]) => name),
  );
}

/** Which namespace a type identifier sits in, by the server's namespace grammar. */
export type Namespace = 'core' | 'system' | 'app' | 'user' | 'marfa' | 'publisher';

export function namespaceOf(typeId: string): Namespace {
  const root = typeId.split('.')[0];
  switch (root) {
    case 'core':
    case 'system':
    case 'app':
    case 'user':
    case 'marfa':
      return root;
    default:
      return 'publisher';
  }
}

/** An IANA zone the runtime recognizes, rather than an offset spelled like one. */
export function isValidTimeZone(value: string): boolean {
  if (value === 'UTC') return true;
  if (!/^[A-Z][A-Za-z_-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/.test(value)) return false;
  if (value.startsWith('Etc/GMT')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The server's own URL check: anything the WHATWG parser reads. */
export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** A shape check for an email address, looser than the server's own: it refuses what this cannot read, and the server refuses the rest. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Initialisms that read wrongly lowercased: `playlist_id` is "Playlist ID", not "Playlist id". */
const INITIALISMS = new Set([
  'api',
  'css',
  'guid',
  'html',
  'http',
  'https',
  'id',
  'isbn',
  'isrc',
  'json',
  'md5',
  'mime',
  'rss',
  'sha256',
  'sku',
  'sql',
  'uri',
  'url',
  'utc',
  'uuid',
  'xml',
]);

/** A field name as a label: first word capitalized, the rest lowercase, initialisms in capitals. */
export function toTitleCase(key: string): string {
  const words = key.split('_').filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (INITIALISMS.has(lower)) return lower.toUpperCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}
