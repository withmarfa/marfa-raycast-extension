import { buildRegistry } from '../display';
import { describeFailure } from '../failure';
import { listItems, listTypes } from '../marfa';

type Input = {
  /**
   * A type identifier to narrow to, such as `core.task`; a type's subtypes come with it. Omit it
   * unless the person named a kind of item.
   */
  type?: string;
  /** `active` unless the person asked about archived or trashed items; `any` for every state. */
  state?: 'active' | 'archived' | 'trashed' | 'any';
  /** `library` for what the person kept, `feed` for what arrived in volume; omit for both. */
  tier?: 'library' | 'feed' | 'all';
  /** How many of the most recently changed items to return, at most 50. Defaults to 20. */
  limit?: number;
};

/**
 * The most recently changed items, newest first, as full rows: for "what did
 * I save lately" and "my open tasks", where there are no words to search for.
 */
export default async function tool(input: Input) {
  try {
    const [types, page] = await Promise.all([
      listTypes(),
      listItems({
        type: input.type,
        state: input.state ?? 'active',
        tier: input.tier ?? 'all',
        limit: Math.min(Math.max(input.limit ?? 20, 1), 50),
      }),
    ]);
    const registry = buildRegistry(types);
    return page.entries.map(({ item, metadata }) => ({
      id: item.id,
      type: item.type,
      kind: registry.label(item.type),
      title: registry.titleOf(item),
      text: registry.bodyOf(item),
      url: typeof item.properties.url === 'string' ? item.properties.url : undefined,
      state: item.state,
      tier: item.tier,
      tags: metadata.tags,
      updatedAt: item.updated_at,
    }));
  } catch (error) {
    const failure = describeFailure(error);
    throw new Error(`${failure.title}. ${failure.message}`);
  }
}
