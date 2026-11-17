/**
 * Runs `src/marfa.ts`, the AI tools and the failure sorting against a real
 * server. Not part of `npm test`: it needs a throwaway server and writes to it.
 *
 *   MARFA_LIVE_URL=... MARFA_LIVE_KEY=... MARFA_LIVE_ADMIN_KEY=... npm run test:live
 *
 * The key is Raycast's own shape (source `raycast`, write on every map,
 * `items.purge`). The admin key holds `keys.mint` and `keys.manage`.
 */
import { createClient } from '@withmarfa/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

const url = process.env.MARFA_LIVE_URL ?? '';
const key = process.env.MARFA_LIVE_KEY ?? '';
const admin = process.env.MARFA_LIVE_ADMIN_KEY ?? '';
const prefs = { apiUrl: url, apiKey: key, defaultTier: 'library' };

vi.mock('@raycast/api', () => ({ getPreferenceValues: () => prefs }));

const marfa = await import('../src/marfa');
const failure = await import('../src/failure');
const { followJob, describeJob } = await import('../src/bulk-job');
const { exactTypeFilter } = await import('../src/type-filter');
const { threadPlacement, groupRelations } = await import('../src/item-view');
const { buildRegistry } = await import('../src/display');
const { conflictCurrent, describeFailure, refusedFields } = failure;

const stamp = Date.now().toString(36);
const made: string[] = [];
async function note(body: string, tags: string[] = []) {
  const entry = await marfa.createItem({ type: 'core.note', properties: { body }, tags });
  made.push(entry.item.id);
  return entry;
}
async function refusal(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('the call was not refused');
}

afterAll(async () => {
  for (const id of made) await marfa.trashItem(id).catch(() => undefined);
});

describe('the server and the key', () => {
  it('reads the server version, instance ID, and contract', async () => {
    const instance = await marfa.getInstance();
    expect(instance.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof instance.instance_id).toBe('string');
    expect(typeof instance.contract).toBe('number');
  });

  it('reads its own key', async () => {
    const current = await marfa.currentKey();
    expect(current.source).toBe('raycast');
    expect(current.permissions).toContain('items.purge');
  });

  it('lists the registry whole', async () => {
    const types = await marfa.listTypes();
    const registry = buildRegistry(types);
    expect(registry.type('core.note')).toBeDefined();
    expect(types.length).toBeGreaterThan(10);
  });
});

describe('capture and read', () => {
  it('creates a note with tags and reads it back by id', async () => {
    const created = await note(`First line ${stamp}\n\nSecond`, ['raycast-live', 'a']);
    expect(created.item.source).toBe('raycast');
    expect(created.item.tier).toBe('library');
    expect(created.metadata.tags.sort()).toEqual(['a', 'raycast-live']);
    expect(created.item.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    const read = await marfa.getItem(created.item.id);
    expect(read.item.version).toBe(1);
    expect(read.metadata.tags.sort()).toEqual(['a', 'raycast-live']);
  });

  it('lands a capture in the feed tier when asked', async () => {
    const entry = await marfa.createItem({
      type: 'core.note',
      properties: { body: `feed ${stamp}` },
      tags: [],
      tier: 'feed',
    });
    made.push(entry.item.id);
    expect(entry.item.tier).toBe('feed');
    const page = await marfa.listItems({ state: 'active', tier: 'feed' });
    expect(page.entries.some((e) => e.item.id === entry.item.id)).toBe(true);
    const library = await marfa.listItems({ state: 'active', tier: 'library', limit: 200 });
    expect(library.entries.some((e) => e.item.id === entry.item.id)).toBe(false);
  });

  it('lists as a page of entries, pages by cursor, and filters by exact type', async () => {
    for (let n = 0; n < 3; n++) await note(`paging ${stamp} ${String(n)}`);
    const first = await marfa.listItems({ state: 'active', limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0].metadata.tags).toBeInstanceOf(Array);
    expect(first.cursor).toBeTruthy();
    const second = await marfa.listItems({
      state: 'active',
      limit: 2,
      cursor: first.cursor ?? undefined,
    });
    expect(second.entries.length).toBeGreaterThan(0);
    expect(second.entries[0].item.id).not.toBe(first.entries[0].item.id);
    const filtered = await marfa.listItems({
      state: 'active',
      filter: exactTypeFilter('core.note'),
      type: undefined,
    });
    expect(filtered.entries.every((e) => e.item.type === 'core.note')).toBe(true);
    const typed = await marfa.listItems({ state: 'active', type: 'core.task' });
    expect(typed.entries.every((e) => e.item.type === 'core.task')).toBe(true);
  });

  it('rejects an unknown item-list parameter', async () => {
    const response = await fetch(`${url}/items?state=active&bogus=1`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(response.status).toBe(400);
  });

  it('finds a note by its text and returns its tags', async () => {
    const unique = `zebrafinch${stamp}`;
    const created = await note(`A note about ${unique}`, [`tag${stamp}`]);
    const found = await marfa.searchItems({ query: unique, state: 'active' });
    expect(found.map((e) => e.item.id)).toContain(created.item.id);
    expect(found[0].metadata.tags).toContain(`tag${stamp}`);
    const none = await marfa.searchItems({ query: `nomatchever${stamp}`, state: 'active' });
    expect(none).toEqual([]);
  });

  it('keeps a trashed item out of an active search and lists it in the Trash with its tags', async () => {
    const unique = `quokka${stamp}`;
    const created = await note(`About ${unique}`);
    await marfa.trashItem(created.item.id);
    expect(await marfa.searchItems({ query: unique, state: 'active' })).toEqual([]);
    const trashed = await marfa.listItems({ state: 'trashed', limit: 200 });
    const row = trashed.entries.find((e) => e.item.id === created.item.id);
    expect(row?.item.state).toBe('trashed');
    expect(row?.metadata.tags).toEqual([]);
  });
});

describe('edits', () => {
  it('merges a changed property against the version read', async () => {
    const created = await marfa.createItem({
      type: 'core.task',
      properties: { title: `task ${stamp}`, description: 'd' },
      tags: [],
    });
    made.push(created.item.id);
    const saved = await marfa.updateItem({
      id: created.item.id,
      version: created.item.version,
      properties: { title: 'renamed' },
      settle: false,
    });
    expect(saved.item.version).toBe(2);
    expect(saved.item.properties.title).toBe('renamed');
    expect(saved.item.properties.description).toBe('d');
  });

  it('replaces the whole properties to clear a field', async () => {
    const created = await marfa.createItem({
      type: 'core.task',
      properties: { title: `clear ${stamp}`, description: 'to be cleared' },
      tags: [],
    });
    made.push(created.item.id);
    const saved = await marfa.updateItem({
      id: created.item.id,
      version: created.item.version,
      properties: { title: `clear ${stamp}` },
      mode: 'replace',
      settle: false,
    });
    expect('description' in saved.item.properties).toBe(false);
  });

  it('refuses a colliding edit of a non-note with the server copy', async () => {
    const created = await marfa.createItem({
      type: 'core.task',
      properties: { title: `collide ${stamp}` },
      tags: [],
    });
    made.push(created.item.id);
    await marfa.updateItem({
      id: created.item.id,
      version: 1,
      properties: { title: 'theirs' },
      settle: false,
    });
    const error = await refusal(
      marfa.updateItem({
        id: created.item.id,
        version: 1,
        properties: { title: 'mine' },
        settle: false,
      }),
    );
    expect(error).toBeInstanceOf(failure.MarfaRequestError);
    expect((error as InstanceType<typeof failure.MarfaRequestError>).status).toBe(409);
    expect((error as InstanceType<typeof failure.MarfaRequestError>).code).toBe('version_conflict');
    expect(describeFailure(error).kind).toBe('conflict');
    const current = conflictCurrent(error);
    expect(current?.version).toBe(2);
    expect(current?.properties.title).toBe('theirs');
  });

  it('settles a colliding note edit and names the conflicted copy', async () => {
    const created = await note(`original ${stamp}`);
    await marfa.updateItem({
      id: created.item.id,
      version: 1,
      properties: { body: `theirs ${stamp}` },
      settle: true,
    });
    const mine = await marfa.updateItem({
      id: created.item.id,
      version: 1,
      properties: { body: `mine ${stamp}` },
      settle: true,
    });
    expect(mine.resolution?.conflicted_copy_id).toBeTruthy();
    if (mine.resolution?.conflicted_copy_id) made.push(mine.resolution.conflicted_copy_id);
  });

  it('lists the versions an edit leaves', async () => {
    const created = await note(`versions ${stamp}`);
    await marfa.updateItem({
      id: created.item.id,
      version: 1,
      properties: { body: `versions ${stamp} v2` },
      settle: false,
    });
    const versions = await marfa.listVersions(created.item.id);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0].properties).toBeTypeOf('object');
    expect(typeof versions[0].version).toBe('number');
  });

  it('marks the field a refused write names', async () => {
    const error = await refusal(
      marfa.createItem({ type: 'core.task', properties: { description: 'no title' }, tags: [] }),
    );
    const described = describeFailure(error);
    expect(described.kind).toBe('refused');
    expect(refusedFields(error)).toBeDefined();
  });
});

describe('tags', () => {
  it('adds and removes a tag', async () => {
    const created = await note(`tagging ${stamp}`, ['one']);
    await marfa.addTags(created.item.id, ['two', 'three']);
    expect((await marfa.getItem(created.item.id)).metadata.tags.sort()).toEqual([
      'one',
      'three',
      'two',
    ]);
    await marfa.removeTag(created.item.id, 'two');
    await marfa.removeTag(created.item.id, 'a tag/with spaces');
    expect((await marfa.getItem(created.item.id)).metadata.tags.sort()).toEqual(['one', 'three']);
  });
});

describe('trash, restore, archive and purge', () => {
  it('archives and unarchives', async () => {
    const created = await note(`archive ${stamp}`);
    await marfa.transitionItem(created.item.id, 'archived');
    expect((await marfa.getItem(created.item.id)).item.state).toBe('archived');
    await marfa.transitionItem(created.item.id, 'active');
    expect((await marfa.getItem(created.item.id)).item.state).toBe('active');
  });

  it('trashes, reads it by id with state=trashed, restores', async () => {
    const created = await note(`trash ${stamp}`);
    await marfa.trashItem(created.item.id);
    const err = await refusal(marfa.getItem(created.item.id));
    expect(failure.describeFailure(err).kind).toBe('gone');
    const now = await marfa.trashedNow(created.item.id);
    expect(now?.state).toBe('trashed');
    expect(now?.version).toBe(created.item.version);
    await marfa.restoreItem(created.item.id);
    expect((await marfa.getItem(created.item.id)).item.state).toBe('active');
  });

  it('purges a trashed item only at the version the person saw', async () => {
    const created = await note(`purge ${stamp}`);
    await marfa.trashItem(created.item.id);
    const wrong = await refusal(marfa.purgeItem(created.item.id, created.item.version + 1));
    expect((wrong as InstanceType<typeof failure.MarfaRequestError>).status).toBeGreaterThanOrEqual(
      400,
    );
    await marfa.purgeItem(created.item.id, created.item.version);
    expect(await marfa.trashedNow(created.item.id)).toBeUndefined();
    const again = await refusal(marfa.purgeItem(created.item.id, created.item.version));
    expect(describeFailure(again).kind).toBe('gone');
  });

  it('counts the Trash with a dry run, then empties exactly that count', async () => {
    // Clear what earlier tests trashed, so the count is this test's own.
    const before = await marfa.countTrash();
    if (before.count > 0) {
      const job = await followJob(
        await marfa.emptyTrash(before.count),
        marfa.bulkJob,
        (ms) => new Promise((r) => setTimeout(r, ms)),
      );
      expect(job.status).toBe('completed');
    }
    const ids: string[] = [];
    for (let n = 0; n < 3; n++) {
      const entry = await note(`empty ${stamp} ${String(n)}`);
      await marfa.trashItem(entry.item.id);
      ids.push(entry.item.id);
    }
    const counted = await marfa.countTrash();
    expect(counted.count).toBe(3);
    expect(counted.ids.sort()).toEqual([...ids].sort());
    const tooFew = await refusal(marfa.emptyTrash(2));
    expect(tooFew).toBeInstanceOf(failure.MarfaRequestError);
    expect((tooFew as InstanceType<typeof failure.MarfaRequestError>).code).toBe(
      'bulk_cap_exceeded',
    );
    expect((await marfa.countTrash()).count, 'a refused empty must delete nothing').toBe(3);
    const job = await followJob(
      await marfa.emptyTrash(3),
      marfa.bulkJob,
      (ms) => new Promise((r) => setTimeout(r, ms)),
    );
    expect(job.status).toBe('completed');
    expect(describeJob(job)).toMatchObject({ ok: true, title: 'Trash emptied' });
    expect((await marfa.countTrash()).count).toBe(0);
  });
});

describe('links', () => {
  it('draws an inline edge at capture and reads both ends', async () => {
    const target = await note(`target ${stamp}`);
    const highlight = await marfa.createItem({
      type: 'core.highlight',
      properties: { text: `highlight ${stamp}` },
      tags: [],
      edges: { references: [target.item.id] },
    });
    made.push(highlight.item.id);
    const out = await marfa.listEdges(highlight.item.id);
    expect(out.outbound).toHaveLength(1);
    expect(out.outbound[0]).toMatchObject({
      from_id: highlight.item.id,
      to_id: target.item.id,
      edge_type: 'references',
    });
    const inbound = await marfa.listEdges(target.item.id);
    expect(inbound.inbound[0]).toMatchObject({ from_id: highlight.item.id, to_id: target.item.id });
    const groups = groupRelations(inbound);
    expect(groups[0].relations[0].otherId).toBe(highlight.item.id);
  });

  it('draws a reply into a thread, with a position', async () => {
    const root = await note(`thread root ${stamp}`);
    const placement = threadPlacement(root.item.id, [], () => []);
    const reply = await note(`reply 1 ${stamp}`);
    await marfa.createEdge({
      from_id: reply.item.id,
      to_id: placement.root,
      edge_type: 'in-thread',
      properties: { position: placement.position },
    });
    const here = await marfa.listEdges(reply.item.id);
    const next = threadPlacement(reply.item.id, here.outbound, (id) => {
      void id;
      return [];
    });
    expect(next.root).toBe(root.item.id);
    const rootEdges = await marfa.listEdges(root.item.id);
    expect(threadPlacement(root.item.id, [], () => rootEdges.inbound).position).toBe(2);
  });

  it('reads related items in bulk, leaving out a trashed one', async () => {
    const a = await note(`bulk a ${stamp}`);
    const b = await note(`bulk b ${stamp}`);
    const gone = await note(`bulk gone ${stamp}`);
    await marfa.trashItem(gone.item.id);
    const unseen = '01a1011a-3923-73d1-963d-9e3779b19e37';
    const items = await marfa.getMany([a.item.id, b.item.id, gone.item.id, unseen]);
    expect(items.map((i) => i.id)).toEqual([a.item.id, b.item.id]);
  });

  it('refuses a link to nothing with the server reason', async () => {
    const a = await note(`dangling ${stamp}`);
    const error = await refusal(
      marfa.createEdge({
        from_id: a.item.id,
        to_id: '01a1011a-3923-73d1-963d-9e3779b19e37',
        edge_type: 'references',
      }),
    );
    expect(error).toBeInstanceOf(failure.MarfaRequestError);
    expect(describeFailure(error).kind).toBe('gone');
  });
});

describe('files', () => {
  it('uploads a blob, captures a file item, and downloads the bytes', async () => {
    const bytes = new Blob([`live ${stamp}`], { type: 'text/plain' });
    const { hash, mime_type: mime } = await marfa.uploadBlob(bytes);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const entry = await marfa.createItem({
      type: 'core.file',
      properties: { blob_ref: hash, mime_type: mime, title: `file ${stamp}` },
      tags: [],
    });
    made.push(entry.item.id);
    const downloaded = await marfa.downloadBlob(hash);
    expect(new TextDecoder().decode(downloaded)).toBe(`live ${stamp}`);
  });
});

describe('the AI tools', () => {
  it('list-types, list-items and search-items answer rows', async () => {
    const listTypes = (await import('../src/tools/list-types')).default;
    const listItems = (await import('../src/tools/list-items')).default;
    const searchItems = (await import('../src/tools/search-items')).default;
    const unique = `okapi${stamp}`;
    await note(`About the ${unique}`, ['tooltag']);
    const types = await listTypes({});
    expect(Array.isArray(types) && types.length).toBeGreaterThan(5);
    const one = await listTypes({ type: 'core.note' });
    expect(JSON.stringify(one)).toContain('body');
    const recent = await listItems({ limit: 5 });
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0]).toMatchObject({ tags: expect.any(Array), updatedAt: expect.any(String) });
    const found = await searchItems({ query: unique });
    expect(found[0].tags).toEqual(['tooltag']);
  });

  it('capture-item writes a note and an event with the form plan', async () => {
    const capture = (await import('../src/tools/capture-item')).default;
    const noteResult = await capture({
      type: 'core.note',
      properties: [{ name: 'body', value: `Captured by the tool ${stamp}` }],
      tags: ['toolcapture'],
    });
    expect(JSON.stringify(noteResult)).toContain('toolcapture');
    await capture({
      type: 'core.event',
      properties: [
        { name: 'title', value: `Event ${stamp}` },
        { name: 'starts_at', value: '2026-12-01T10:00:00Z' },
        { name: 'ends_at', value: '2026-12-01T11:00:00Z' },
      ],
    });
    const events = await marfa.listItems({ state: 'active', type: 'core.event' });
    const stored = events.entries.find((e) => e.item.properties.title === `Event ${stamp}`);
    expect(stored).toBeDefined();
  });
});

describe('failures', () => {
  it('a wrong key is unauthorized', async () => {
    const client = createClient({ baseUrl: url, credential: 'marfa_k1_wrong' });
    const { error, response } = await client.GET('/keys/current');
    const wrapped = new failure.MarfaRequestError(response.status, error);
    expect(describeFailure(wrapped).kind).toBe('unauthorized');
  });

  it('classifies a refused key listing as forbidden', async () => {
    const error = await refusal(marfa.listKeys());
    expect(describeFailure(error).kind).toBe('forbidden');
  });

  it('a mismatched contract is a contract failure, and the server refuses a wrong one with 412', async () => {
    const response = await fetch(`${url}/types`, {
      headers: { Authorization: `Bearer ${key}`, 'X-Marfa-Contract': '999' },
    });
    expect(response.status).toBe(412);
    const client = createClient({
      baseUrl: url,
      credential: key,
      fetch: async (input, init) => {
        const real = await fetch(input, init);
        const headers = new Headers(real.headers);
        headers.set('X-Marfa-Contract', '7');
        return new Response(real.body, { status: real.status, headers });
      },
    });
    const error = await client.GET('/types').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(describeFailure(error).kind).toBe('contract');
  });

  it('an unreachable server is unreachable', async () => {
    const client = createClient({ baseUrl: 'http://127.0.0.1:9', credential: key });
    const error = await client.GET('/types').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(describeFailure(error).kind).toBe('unreachable');
  });
});

describe('keys, with a key that may manage them', () => {
  it('lists, mints, edits and revokes', async () => {
    prefs.apiKey = admin;
    try {
      const self = await marfa.currentKey();
      expect((await import('../src/keys')).canManageKeys(self)).toBe(true);
      const listed = await marfa.listKeys();
      expect(listed.length).toBeGreaterThan(1);
      const minted = await marfa.createKey({
        label: `live ${stamp}`,
        source: `live-${stamp}`,
        type_permissions: { '*': 'read' },
        permissions: [],
      });
      expect(minted.key).toMatch(/^marfa_k1_/);
      const edited = await marfa.updateKey(minted.id, { label: `live ${stamp} edited` });
      expect(edited.label).toBe(`live ${stamp} edited`);
      await marfa.revokeKey(minted.id);
      const afterwards = await refusal(marfa.revokeKey(minted.id));
      expect(describeFailure(afterwards).kind).toBe('gone');
      const clash = await refusal(
        marfa.createKey({ label: 'clash', source: 'raycast', permissions: [] }),
      );
      expect(describeFailure(clash).kind).toBe('refused');
      expect((await import('../src/keys')).keyRefusal(clash, 'raycast')?.field).toBe('source');
    } finally {
      prefs.apiKey = key;
    }
  });
});
