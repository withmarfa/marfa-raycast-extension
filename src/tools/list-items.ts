import { refuseIfNotGranted, toolClient, toolItem, unreadableNote } from './shared';

type Input = {
  /** Restrict to one type, as a full identifier such as `core.task`. Omit for
   *  everything. */
  type?: string;
  /** Restrict to a lifecycle state. Defaults to active. */
  state?: 'active' | 'archived' | 'trashed';
  /** `library` is curated and kept, `feed` is high-volume capture. */
  tier?: 'library' | 'feed' | 'all';
  /** How many to return, newest first. */
  limit?: number;
};

/**
 * The person's most recent items, newest first.
 *
 * Use this for "what did I capture today", "show me my tasks", or any request
 * about recency rather than content. Use search-items when they describe what
 * they are looking for.
 *
 * A `note` on the result means this sign-in cannot see everything the server
 * holds, so the items are real but the absence of one proves nothing.
 */
export default async function listItems(input: Input) {
  await refuseIfNotGranted(input.type);
  const [note, response] = await Promise.all([
    unreadableNote(),
    toolClient().items.listWithMetadata({
      type: input.type,
      state: input.state ?? 'active',
      tier: input.tier ?? 'all',
      sort: 'timestamp',
      direction: 'desc',
      limit: Math.min(input.limit ?? 20, 50),
    }),
  ]);
  return {
    items: response.data.map((entry) => ({ ...toolItem(entry.item), tags: entry.metadata.tags })),
    note,
  };
}
