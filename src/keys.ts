import { MarfaRequestError } from './failure';
import type { ApiKey } from './marfa';

/**
 * Keys as Manage Keys reads and writes them. Pure, so every preset's body,
 * every summary and every refusal is tested without a server.
 *
 * A key's reach is five maps and seven permissions. A create naming none of
 * the maps, the permissions or claimed sources copies the creator's whole
 * set; naming any of them takes only what it names. The server refuses a key
 * reaching past its creator, so nothing here second-guesses it.
 */

export type Permission = NonNullable<ApiKey['permissions']>[number];

export const PERMISSIONS: readonly { name: Permission; says: string }[] = [
  { name: 'keys.mint', says: 'Mint, change and revoke keys' },
  { name: 'items.purge', says: 'Delete items for good, and empty the Trash' },
  { name: 'schema.write', says: 'Register and change types' },
  { name: 'webhooks.manage', says: 'Manage webhooks' },
  { name: 'config.manage', says: 'Change the server’s configuration' },
  { name: 'audit.read', says: 'Read the audit log' },
  { name: 'grants.manage', says: 'Manage what signed-in apps are granted' },
];

export type MapField =
  | 'type_permissions'
  | 'metadata_permissions'
  | 'edge_permissions'
  | 'extension_permissions'
  | 'profile_permissions';

export const MAPS: readonly {
  field: MapField;
  title: string;
  levels: readonly string[];
  example: string;
}[] = [
  {
    field: 'type_permissions',
    title: 'Types',
    levels: ['read', 'write', 'none'],
    example: 'core.note=write',
  },
  {
    field: 'metadata_permissions',
    title: 'Tags and metadata',
    levels: ['read', 'write'],
    example: 'tags=write',
  },
  {
    field: 'edge_permissions',
    title: 'Edges',
    levels: ['read', 'write'],
    example: 'references=write',
  },
  {
    field: 'extension_permissions',
    title: 'Extensions',
    levels: ['read', 'write'],
    example: 'app.cursor=read',
  },
  {
    field: 'profile_permissions',
    title: 'Profile',
    levels: ['read', 'write'],
    example: 'email=read',
  },
];

/** The maps that reach items: their types, their tags and their edges. */
const CONTENT_MAPS: readonly MapField[] = [
  'type_permissions',
  'metadata_permissions',
  'edge_permissions',
];

type Map = Record<string, string>;

/** Whether the key in the preferences may manage keys: the operator key, or one holding `keys.mint`. */
export function canManageKeys(key: ApiKey): boolean {
  return key.is_operator || (key.permissions ?? []).includes('keys.mint');
}

export type PresetId = 'everything' | 'content-write' | 'content-read';

export const PRESETS: readonly { id: PresetId; title: string; says: string }[] = [
  {
    id: 'everything',
    title: 'Everything this key holds',
    says: 'The new key copies this key’s maps, permissions and claimed sources.',
  },
  {
    id: 'content-write',
    title: 'Content, read and write',
    says: 'Items, their tags and their edges, as far as this key reaches them. No permissions.',
  },
  {
    id: 'content-read',
    title: 'Content, read only',
    says: 'Items, their tags and their edges, read only, as far as this key reaches them. No permissions.',
  },
];

/** A map with every write narrowed to read; a type denied stays denied. */
export function narrowToRead(map: Map): Map {
  return Object.fromEntries(
    Object.entries(map).map(([key, level]) => [key, level === 'write' ? 'read' : level]),
  );
}

export type KeyReach = Partial<Record<MapField, Map>> & {
  permissions?: Permission[];
  sources?: string[];
};

/**
 * The reach a preset asks for, from the key minting it. The operator key holds
 * nothing itself and may grant anything, so its content reaches everything.
 */
export function presetReach(id: PresetId, creator: ApiKey): KeyReach {
  if (id === 'everything') return {};
  const reach: KeyReach = { permissions: [], sources: [] };
  for (const field of CONTENT_MAPS) {
    const held: Map = creator.is_operator
      ? { '*': 'write' }
      : ((creator[field] as Map | undefined) ?? {});
    reach[field] = id === 'content-read' ? narrowToRead(held) : { ...held };
  }
  return reach;
}

/** A map as the lines the form edits, one `pattern=level` a line, as the CLI writes them. */
export function formatMap(map: Map | undefined): string {
  return Object.entries(map ?? {})
    .map(([key, level]) => `${key}=${level}`)
    .join('\n');
}

/** Lines back into a map, or which line is wrong and why. */
export function parseMap(
  text: string,
  levels: readonly string[],
): { map: Map } | { error: string } {
  const map: Map = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const where = `Line ${String(index + 1)}`;
    const at = line.lastIndexOf('=');
    if (at <= 0) return { error: `${where}: expected pattern=level` };
    const key = line.slice(0, at).trim();
    const level = line.slice(at + 1).trim();
    if (!levels.includes(level))
      return { error: `${where}: the level is one of ${levels.join(', ')}` };
    if (key in map) return { error: `${where}: ${key} is given twice` };
    map[key] = level;
  }
  return { map };
}

/** Sources as typed: comma-separated, each once. */
export function parseSources(text: string): { sources: string[] } | { error: string } {
  const sources = [
    ...new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const reserved = sources.find(isReservedSource);
  if (reserved) return { error: `${reserved} is reserved to the server` };
  const long = sources.find((source) => source.length > SOURCE_MAX_LENGTH);
  if (long) return { error: `A source is at most ${String(SOURCE_MAX_LENGTH)} characters` };
  return { sources };
}

/** The server's bound on a source's length. */
export const SOURCE_MAX_LENGTH = 200;

/** The prefixes the server keeps for its own sources, whatever their case. */
export function isReservedSource(source: string): boolean {
  return /^(oauth|connector):/i.test(source);
}

/**
 * Whether the form can show a map as lines and read back exactly the map
 * stored. One that cannot, such as a pattern with surrounding spaces, is shown
 * read-only and never sent, so an edit cannot rewrite it unasked.
 */
export function mapIsEditable(map: Map | undefined, levels: readonly string[]): boolean {
  const read = parseMap(formatMap(map), levels);
  return (
    'map' in read &&
    sameMap(read.map, map ?? {}) &&
    Object.keys(map ?? {}).every((key) => key !== '' && !/\n/.test(key))
  );
}

/**
 * The reach a create or edit form holds, or what is wrong with it. A map
 * whose text is as the form started it is left out, so an edit sends only
 * what the person changed; so is a map the form showed read-only.
 */
export function reachFromForm(
  values: Record<string, unknown>,
  started: Partial<Record<MapField, string>> = {},
): { reach: KeyReach } | { errors: Partial<Record<string, string>> } {
  const errors: Partial<Record<string, string>> = {};
  const reach: KeyReach = {};
  for (const map of MAPS) {
    const text = values[map.field];
    if (typeof text !== 'string' || text === started[map.field]) continue;
    const parsed = parseMap(text, map.levels);
    if ('error' in parsed) errors[map.field] = parsed.error;
    else reach[map.field] = parsed.map;
  }
  const sources = parseSources(String(values.sources ?? ''));
  if ('error' in sources) errors.sources = sources.error;
  else reach.sources = sources.sources;
  reach.permissions = (Array.isArray(values.permissions) ? values.permissions : []) as Permission[];
  return Object.keys(errors).length > 0 ? { errors } : { reach };
}

function sameSet(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMap(a: Map | undefined, b: Map | undefined): boolean {
  const left = Object.entries(a ?? {});
  return (
    left.length === Object.keys(b ?? {}).length && left.every(([key, level]) => b?.[key] === level)
  );
}

/**
 * Only what an edit changed. Sending a field unchanged is not harmless: a key
 * editing another may not hold a permission that key already has, and the
 * server refuses a write naming a reach the writer lacks.
 */
export function changedKeyFields(
  original: ApiKey,
  next: KeyReach & { label: string; default_tier: 'library' | 'feed' },
): Partial<KeyReach & { label: string; default_tier: 'library' | 'feed' }> {
  const changes: Partial<KeyReach & { label: string; default_tier: 'library' | 'feed' }> = {};
  if (next.label !== original.label) changes.label = next.label;
  if (next.default_tier !== original.default_tier) changes.default_tier = next.default_tier;
  for (const map of MAPS) {
    if (next[map.field] && !sameMap(original[map.field] as Map | undefined, next[map.field])) {
      changes[map.field] = next[map.field];
    }
  }
  if (next.permissions && !sameSet(original.permissions, next.permissions)) {
    changes.permissions = next.permissions;
  }
  if (next.sources && !sameSet(original.sources, next.sources)) changes.sources = next.sources;
  return changes;
}

/** What a key reaches, in the fewest words a list row can spare. */
export function keySummary(key: ApiKey): string {
  if (key.is_operator) return 'Operator';
  const permissions = key.permissions ?? [];
  const content = CONTENT_MAPS.map((field) => (key[field] as Map | undefined) ?? {});
  const granted = content.flatMap((map) => Object.values(map)).filter((level) => level !== 'none');
  const denies = content.some((map) => Object.values(map).includes('none'));
  if (
    permissions.length === PERMISSIONS.length &&
    !denies &&
    content.every((map) => map['*'] === 'write')
  ) {
    return 'Everything';
  }
  const reach = granted.length === 0 ? '' : granted.includes('write') ? 'Content' : 'Read only';
  if (permissions.length === 0) return reach || 'Nothing';
  const held =
    permissions.length === 1 ? permissions[0] : `${String(permissions.length)} permissions`;
  return reach ? `${reach} and ${held}` : held;
}

/** Which map a reach refusal is about, from its scope: `*:write` names a type, `edge.x:write` an edge. */
function mapOfScope(scope: string): MapField | undefined {
  if (!scope.includes(':')) return undefined;
  if (scope.startsWith('edge')) return 'edge_permissions';
  if (scope.startsWith('metadata')) return 'metadata_permissions';
  if (scope.startsWith('profile')) return 'profile_permissions';
  if (scope.startsWith('extension')) return 'extension_permissions';
  return 'type_permissions';
}

export type KeyRefusalField = 'source' | 'sources' | 'permissions' | MapField;

/**
 * A refused key write in the server's own words, and the form field it is
 * about where there is one: a source taken or claimed elsewhere, a claim or a
 * permission or a reach the writing key cannot grant, or a value the server's
 * validation refused.
 */
export function keyRefusal(
  error: unknown,
  submittedSource?: string,
): { field?: KeyRefusalField; message: string } | undefined {
  if (!(error instanceof MarfaRequestError)) return undefined;
  const details =
    (error.body as { error?: { details?: Record<string, unknown> } } | undefined)?.error?.details ??
    {};
  if (error.status === 409 && typeof details.source === 'string') {
    return {
      field: 'source',
      message: `${details.source} is already another key’s source; choose another`,
    };
  }
  if (error.status === 403) {
    if (details.required_scope === 'keys.mint') {
      return { message: 'The API Key does not hold keys.mint, so it cannot manage keys' };
    }
    if (typeof details.required_scope === 'string') {
      const scope = details.required_scope;
      const field = PERMISSIONS.some((permission) => permission.name === scope)
        ? 'permissions'
        : mapOfScope(scope);
      return { field, message: error.message };
    }
    if (typeof details.source === 'string') {
      return {
        field: details.source === submittedSource ? 'source' : 'sources',
        message: error.message,
      };
    }
    return { message: error.message };
  }
  if (error.status === 400 && Array.isArray(details.errors)) {
    for (const entry of details.errors as {
      path?: unknown;
      field?: unknown;
      message?: unknown;
    }[]) {
      const at = String(entry.path ?? entry.field ?? '');
      const message = typeof entry.message === 'string' ? entry.message : error.message;
      if (at === 'source') return { field: 'source', message };
      if (at.startsWith('sources')) return { field: 'sources', message };
    }
  }
  if (error.status === 400 && /source/i.test(error.message))
    return { field: 'source', message: error.message };
  return undefined;
}
