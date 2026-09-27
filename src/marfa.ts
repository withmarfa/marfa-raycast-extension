import { getPreferenceValues } from '@raycast/api';
import { createClient, type components, type MarfaClient } from '@withmarfa/client';
import { MarfaRequestError, SetupError } from './failure';

/**
 * The one door to the server: the generated client, and the calls this
 * extension makes through it. Every call either returns what the server
 * answered or throws, so a view never reads an error out of a successful
 * value. Nothing here retries, merges or resolves a conflict; the server does
 * that.
 */

export type Item = components['schemas']['Item'];
export type Metadata = components['schemas']['Metadata'];
export type TypeDefinition = components['schemas']['TypeDefinition'];
export type ConflictResolution = {
  fields: string[];
  conflicted_copy_id?: string;
};

/** An item with its tags. The list, search and write doors all answer in this shape. */
export interface Entry {
  item: Item;
  metadata: Metadata;
}

export interface Page {
  entries: Entry[];
  cursor: string | null;
}

/** `any` is the server's own word for every state at once. */
export type StateFilter = 'active' | 'archived' | 'trashed' | 'any';
export type TierFilter = 'all' | 'library' | 'feed';

let cached: { url: string; key: string; client: MarfaClient } | undefined;

export function marfa(): MarfaClient {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();
  const url = apiUrl.trim();
  const key = apiKey.trim();
  if (cached?.url !== url || cached.key !== key) {
    // Checked here rather than left to the request: a key no header can carry
    // fails inside fetch with a message that quotes the header, key and all.
    if (!/^[\x21-\x7E]+$/.test(key)) {
      throw new SetupError(
        'The API Key holds a character no key has. Copy it again and paste it into the extension preferences.',
      );
    }
    let client: MarfaClient;
    try {
      client = createClient({ baseUrl: url, credential: key });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SetupError(`The Server URL is not usable: ${reason}.`);
    }
    cached = { url, key, client };
  }
  return cached.client;
}

async function answer<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (error !== undefined || data === undefined)
    throw new MarfaRequestError(response.status, error);
  return data;
}

function unexpected(what: string): MarfaRequestError {
  return new MarfaRequestError(200, {
    error: { code: 'unexpected_shape', message: `The server answered without ${what}.` },
  });
}

function rows<T>(page: { data?: T[] }): T[] {
  if (!Array.isArray(page.data)) throw unexpected('a list of items');
  return page.data;
}

/**
 * The list door answers a bare item unless metadata is asked for, and this
 * extension always asks, so a bare row here means the server changed shape.
 */
function asEntry(row: Item | Entry): Entry {
  if (typeof row === 'object' && row !== null && 'item' in row && 'metadata' in row) return row;
  throw unexpected("an item's tags");
}

export async function listItems(options: {
  type?: string;
  state: StateFilter;
  tier?: TierFilter;
  cursor?: string;
  limit?: number;
}): Promise<Page> {
  const page = await answer(
    marfa().GET('/items', {
      params: {
        query: {
          type: options.type,
          state: options.state,
          tier: options.tier ?? 'all',
          sort: 'updated_at',
          direction: 'desc',
          include: 'metadata',
          limit: options.limit ?? 50,
          cursor: options.cursor,
        },
      },
    }),
  );
  return { entries: rows(page).map(asEntry), cursor: page.next_cursor ?? null };
}

export async function searchItems(options: {
  query: string;
  type?: string;
  state: StateFilter;
  tier?: TierFilter;
  limit?: number;
}): Promise<Entry[]> {
  const page = await answer(
    marfa().GET('/search', {
      params: {
        query: {
          q: options.query,
          type: options.type,
          state: options.state,
          tier: options.tier ?? 'all',
          limit: options.limit ?? 50,
        },
      },
    }),
  );
  return rows(page).map(asEntry);
}

export async function getItem(id: string): Promise<Entry> {
  return asEntry(await answer(marfa().GET('/items/{id}', { params: { path: { id } } })));
}

export type Tier = components['schemas']['Tier'];

/** The tier a capture lands in when the caller names none, from the preferences. */
export function captureTier(): Tier {
  return getPreferenceValues<Preferences>().defaultTier === 'feed' ? 'feed' : 'library';
}

export async function createItem(input: {
  type: string;
  properties: Record<string, unknown>;
  tags: string[];
  tier?: Tier;
  /** Edges the new item draws, by edge type, to the ids named: a reply's thread, an annotation's reference. */
  edges?: Record<string, string[]>;
}): Promise<Entry> {
  const created = await answer(
    marfa().POST('/items', {
      body: {
        type: input.type,
        properties: input.properties,
        tags: input.tags,
        tier: input.tier ?? captureTier(),
        edges: input.edges,
      },
    }),
  );
  return asEntry(created);
}

/**
 * Sends only the properties the person changed, against the version they
 * read. `conflict=auto` lets the server merge a stale edit that collides on
 * nothing, and settle a collision by the type's merge policy where it has one;
 * a note's body keeps both copies, so the other side's text stays and this one
 * lands as a conflicted copy the answer names. A collision no policy settles
 * is still refused.
 */
export async function updateItem(input: {
  id: string;
  version: number;
  properties: Record<string, unknown>;
  /**
   * `replace` sends the item's whole properties, which is the only way to
   * clear an optional field: a null under a merge is dropped. The server still
   * merges a stale replace field by field against the version read.
   */
  mode?: 'merge' | 'replace';
}): Promise<Entry & { resolution?: ConflictResolution }> {
  const updated = await answer(
    marfa().PATCH('/items/{id}', {
      params: { path: { id: input.id }, query: { conflict: 'auto' } },
      body: {
        version: input.version,
        properties: input.properties,
        properties_mode: input.mode ?? 'merge',
      },
    }),
  );
  return { ...asEntry(updated), resolution: updated.conflict_resolution };
}

export async function trashItem(id: string): Promise<void> {
  await answer(marfa().DELETE('/items/{id}', { params: { path: { id } } }));
}

export async function restoreItem(id: string): Promise<void> {
  await answer(marfa().POST('/items/{id}/restore', { params: { path: { id } } }));
}

/** Between active and archived; the Trash has its own doors. */
export async function transitionItem(id: string, state: 'active' | 'archived'): Promise<void> {
  await answer(
    marfa().POST('/items/{id}/transition', { params: { path: { id } }, body: { state } }),
  );
}

/** Deletes a trashed item for good. Needs `items.purge`. */
export async function purgeItem(id: string): Promise<void> {
  await answer(marfa().DELETE('/items/{id}/purge', { params: { path: { id } } }));
}

const EMPTY_TRASH = { action: 'purge', confirm: 'PURGE', filter: { state: 'trashed' } } as const;

/** How many items emptying the Trash would delete, from a dry run that deletes nothing. */
export async function countTrash(): Promise<number> {
  const result = await answer(
    marfa().POST('/items/bulk-actions', { body: { ...EMPTY_TRASH, dry_run: true } }),
  );
  if (!('matched' in result) || typeof result.matched !== 'number') {
    throw unexpected('a count of the Trash');
  }
  return result.matched;
}

export type BulkJob = components['schemas']['BulkActionJob'];

/** Starts emptying the Trash. The server answers a job, which `bulkJob` follows. */
export async function emptyTrash(): Promise<BulkJob> {
  const job = await answer(marfa().POST('/items/bulk-actions', { body: EMPTY_TRASH }));
  if (!('status' in job)) throw unexpected('a job for emptying the Trash');
  return job;
}

export async function bulkJob(id: string): Promise<BulkJob> {
  return answer(marfa().GET('/items/bulk-actions/jobs/{id}', { params: { path: { id } } }));
}

export type Edge = components['schemas']['Edge'];

/** An item's outbound edges, and its inbound ones: one page each, the most a view shows. */
export async function listEdges(id: string): Promise<{ outbound: Edge[]; inbound: Edge[] }> {
  const [outbound, inbound] = await Promise.all([
    answer(marfa().GET('/items/{id}/edges', { params: { path: { id }, query: { limit: 100 } } })),
    answer(
      marfa().GET('/items/{id}/backrefs', { params: { path: { id }, query: { limit: 100 } } }),
    ),
  ]);
  return { outbound: rows(outbound), inbound: rows(inbound) };
}

/**
 * Items by id, in batches of the door's hundred. An id that does not resolve,
 * a trashed one included, is left out rather than refused.
 */
export async function getMany(ids: readonly string[]): Promise<Item[]> {
  const items: Item[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = await answer(
      marfa().POST('/items/bulk-get', { body: { ids: ids.slice(start, start + 100) } }),
    );
    if (!Array.isArray(batch.items)) throw unexpected('a list of items');
    items.push(...batch.items.map((row) => ('item' in row ? row.item : row) as Item));
  }
  return items;
}

export type ItemVersion = {
  id: string;
  version: number;
  properties: Record<string, unknown>;
  created_at: string;
};

/** The versions the server keeps of an item, before its current one. */
export async function listVersions(id: string): Promise<ItemVersion[]> {
  const page = await answer(marfa().GET('/items/{id}/versions', { params: { path: { id } } }));
  return rows(page as { data?: ItemVersion[] });
}

/** A blob's bytes. */
export async function downloadBlob(hash: string): Promise<ArrayBuffer> {
  return answer(
    marfa().GET('/blobs/{hash}', { params: { path: { hash } }, parseAs: 'arrayBuffer' }),
  ) as Promise<ArrayBuffer>;
}

export async function addTags(id: string, tags: string[]): Promise<void> {
  await answer(marfa().POST('/items/{id}/tags', { params: { path: { id } }, body: { tags } }));
}

export async function removeTag(id: string, tag: string): Promise<void> {
  await answer(marfa().DELETE('/items/{id}/tags/{tag}', { params: { path: { id, tag } } }));
}

/** The whole registry: the door answers every type at once, its cursor always null. */
export async function listTypes(): Promise<TypeDefinition[]> {
  return rows(await answer(marfa().GET('/types')));
}

/** The Server URL as the preferences hold it, for showing, not for sending. */
export function serverUrl(): string {
  return getPreferenceValues<Preferences>().apiUrl.trim();
}

/** The server's own description, which needs no key. */
export async function getInstance() {
  return answer(marfa().GET('/'));
}

export type ApiKey = components['schemas']['ApiKey'];

/** The key the preferences hold, as the server holds it: what it may read and write. */
export async function currentKey(): Promise<ApiKey> {
  return answer(marfa().GET('/keys/current'));
}

/** Stores bytes and answers the reference an item carries them by. */
export async function uploadBlob(bytes: Blob): Promise<{ hash: string; mime_type: string }> {
  return answer(marfa().POST('/blobs', { body: bytes, headers: { 'Content-Type': bytes.type } }));
}
