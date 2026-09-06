import { refuseIfNotGranted, toolClient, toolItem, unreadableNote } from './shared';

type Input = {
  /** What to search for. Matched against every searchable field of every item,
   *  so a phrase from the body of a note finds that note. */
  query: string;
  /** Restrict to one type, as a full identifier such as `core.note` or
   *  `readwise.highlight`. Omit to search everything. Use the list-types tool
   *  if you need to know what this instance holds. */
  type?: string;
  /** Restrict to a lifecycle state. Defaults to active, which is what a person
   *  means unless they say otherwise. */
  state?: 'active' | 'archived' | 'trashed';
  /** `library` is curated and kept, `feed` is high-volume capture. Omit for
   *  both. */
  tier?: 'library' | 'feed' | 'all';
  /** How many to return. Keep it small unless the person asked for a sweep. */
  limit?: number;
};

/**
 * Full-text search across the person's items.
 *
 * Use this when they describe what they are looking for. Use list-items instead
 * when they ask for recent things, or for everything of a type.
 *
 * A `note` on the result means this sign-in cannot see everything the server
 * holds, so the items are real but the absence of one proves nothing.
 */
export default async function searchItems(input: Input) {
  await refuseIfNotGranted(input.type);
  const [note, results] = await Promise.all([
    unreadableNote(),
    toolClient().search(input.query, {
      type: input.type,
      state: input.state ?? 'active',
      tier: input.tier ?? 'all',
      limit: Math.min(input.limit ?? 20, 50),
    }),
  ]);
  return {
    items: results.map((result) => ({
      ...toolItem(result.item),
      tags: result.metadata.tags,
      snippet: result.snippet_html?.replace(/<[^>]*>/g, ''),
    })),
    note,
  };
}
