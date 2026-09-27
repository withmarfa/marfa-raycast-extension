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

export type StateFilter = 'active' | 'archived' | 'trashed';

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
  cursor?: string;
}): Promise<Page> {
  const page = await answer(
    marfa().GET('/items', {
      params: {
        query: {
          type: options.type,
          state: options.state,
          tier: 'all',
          sort: 'updated_at',
          direction: 'desc',
          include: 'metadata',
          limit: 50,
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
  limit?: number;
}): Promise<Entry[]> {
  const page = await answer(
    marfa().GET('/search', {
      params: {
        query: {
          q: options.query,
          type: options.type,
          state: options.state,
          tier: 'all',
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
  /** Edges this item draws, by edge type, to the ids named. */
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
}): Promise<Entry & { resolution?: ConflictResolution }> {
  const updated = await answer(
    marfa().PATCH('/items/{id}', {
      params: { path: { id: input.id }, query: { conflict: 'auto' } },
      body: { version: input.version, properties: input.properties },
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
