import { getPreferenceValues } from '@raycast/api';
import { createClient, type components, type MarfaClient } from '@withmarfa/client';
import { MarfaRequestError, SetupError } from './failure';
import { countTrashBody, editRequest, emptyTrashBody } from './requests';

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
  filter?: string;
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
          filter: options.filter,
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
  filter?: string;
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
          filter: options.filter,
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
 * Sends properties against the version the caller read: the ones changed
 * under `merge`, the whole set under `replace`, the only way to clear a field,
 * since a null under a merge is dropped. A stale edit that collides on nothing
 * merges either way. `settle` decides a collision: settled by the type's merge
 * policy (a note's body keeps both copies, the other side's text staying and
 * this one landing as a conflicted copy the answer names), or refused with the
 * server's current copy.
 */
export async function updateItem(input: {
  id: string;
  version: number;
  properties: Record<string, unknown>;
  mode?: 'merge' | 'replace';
  settle: boolean;
}): Promise<Entry & { resolution?: ConflictResolution }> {
  const request = editRequest({
    version: input.version,
    properties: input.properties,
    mode: input.mode ?? 'merge',
    settle: input.settle,
  });
  const updated = await answer(
    marfa().PATCH('/items/{id}', {
      params: { path: { id: input.id }, query: request.query },
      body: request.body,
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
  await answer(marfa().POST('/items/{id}/purge', { params: { path: { id } } }));
}

/**
 * What emptying the Trash would delete, from a dry run that deletes nothing:
 * the items this key may purge, which a narrower key sees fewer of.
 */
export async function countTrash(): Promise<{ count: number; ids: string[] }> {
  const result = await answer(marfa().POST('/items/bulk-actions', { body: countTrashBody() }));
  if (!('matched' in result) || typeof result.matched !== 'number' || 'status' in result) {
    throw unexpected('a count of the Trash');
  }
  return { count: result.matched, ids: result.ids ?? [] };
}

export type BulkJob = components['schemas']['BulkActionJob'];

/**
 * Starts emptying the Trash, refusing if it matches more than the count the
 * person confirmed. The job matches again when it starts, and the door takes
 * no list of ids, so the caller counts again just before and starts it only
 * when the same items are there.
 */
export async function emptyTrash(confirmed: number): Promise<BulkJob> {
  const job = await answer(
    marfa().POST('/items/bulk-actions', { body: emptyTrashBody(confirmed) }),
  );
  if (!('status' in job)) throw unexpected('a job for emptying the Trash');
  return job;
}

/**
 * A trashed item as the server holds it now, found in the Trash listing since
 * a trashed item answers no read by id; undefined when it is no longer there.
 */
export async function trashedNow(id: string, since: string): Promise<Item | undefined> {
  const page = await answer(
    marfa().GET('/items', {
      params: { query: { state: 'trashed', updated_after: since, limit: 100 } },
    }),
  );
  return rows(page as { data?: Item[] }).find((row) => row.id === id);
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

/** Draws one edge, with properties an item's inline edges cannot carry. */
export async function createEdge(edge: {
  source_id: string;
  target_id: string;
  edge_type: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  await answer(marfa().POST('/edges', { body: edge }));
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
    items.push(...(batch.items as Item[]));
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

/** The keys the caller reaches: every key with `keys.manage`, those within its reach with `keys.mint`. */
export async function listKeys(): Promise<ApiKey[]> {
  return rows(await answer(marfa().GET('/keys')));
}

/** What a key write may set: its label and source, its reach and its tier. */
export type KeyBody = Omit<
  ApiKey,
  'id' | 'created_at' | 'last_used_at' | 'expires_at' | 'oauth_client_id'
>;

/** Mints a key. The answer carries the key itself, which the server never shows again. */
export async function createKey(
  body: Partial<KeyBody> & { label: string; source: string },
): Promise<ApiKey & { key: string }> {
  return answer(marfa().POST('/keys', { body })) as Promise<ApiKey & { key: string }>;
}

/** Changes a key in place. Its source cannot change. */
export async function updateKey(
  id: string,
  body: Partial<Omit<KeyBody, 'source'>>,
): Promise<ApiKey> {
  return answer(marfa().PATCH('/keys/{id}', { params: { path: { id } }, body }));
}

/** Revokes a key at once: its next request is refused. */
export async function revokeKey(id: string): Promise<void> {
  await answer(marfa().DELETE('/keys/{id}', { params: { path: { id } } }));
}

/** Stores bytes and answers the reference an item carries them by. */
export async function uploadBlob(bytes: Blob): Promise<{ hash: string; mime_type: string }> {
  return answer(marfa().POST('/blobs', { body: bytes, headers: { 'Content-Type': bytes.type } }));
}
