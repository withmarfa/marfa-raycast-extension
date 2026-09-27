import { MarfaRequestError } from './failure';
import type { ApiKey } from './marfa';

/**
 * Keys as Manage Keys reads and writes them. Pure, so every preset's body,
 * every summary and every refusal is tested without a server.
 *
 * A key's reach is five maps and seven permissions. A create naming no map
 * copies the creator's maps, permissions and claimed sources; naming any map
 * takes only what it names, with no permission unless listed. The server
 * refuses a key reaching past its creator, so nothing here second-guesses it.
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
  const reserved = sources.find((source) => /^(oauth|connector):/.test(source));
  if (reserved) return { error: `${reserved} is reserved to the server` };
  return { sources };
}

function isEvery(map: Map | undefined, level: string): boolean {
  const entries = Object.entries(map ?? {});
  return entries.length > 0 && entries.every(([, held]) => held === level);
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
  const content = CONTENT_MAPS.map((field) => key[field] as Map | undefined);
  const others = ['extension_permissions', 'profile_permissions'].some(
    (field) => Object.keys((key[field as MapField] as Map | undefined) ?? {}).length > 0,
  );
  if (permissions.length === PERMISSIONS.length && content.every((map) => map?.['*'] === 'write')) {
    return 'Everything';
  }
  if (permissions.length > 0) {
    return permissions.length === 1
      ? `Content and ${permissions[0]}`
      : `Content and ${String(permissions.length)} permissions`;
  }
  if (!others && content.every((map) => isEvery(map, 'read'))) return 'Read only';
  if (content.every((map) => Object.keys(map ?? {}).length === 0) && !others) return 'Nothing';
  return 'Content';
}

/**
 * A refused key write in the person's terms, and the form field it is about
 * where there is one: a source another key owns, or a reach this key lacks.
 */
export function keyRefusal(
  error: unknown,
): { field?: 'source' | 'permissions'; message: string } | undefined {
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
  if (error.status === 403 && typeof details.required_scope === 'string') {
    const scope = details.required_scope;
    if (scope === 'keys.mint')
      return { message: 'The API Key does not hold keys.mint, so it cannot manage keys' };
    if (PERMISSIONS.some((permission) => permission.name === scope)) {
      return {
        field: 'permissions',
        message: `This key does not hold ${scope}, so it cannot give it to another`,
      };
    }
    // A reach such as `*:write`, which the server's own message explains.
    return { message: error.message };
  }
  return undefined;
}
