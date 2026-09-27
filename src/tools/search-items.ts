import { buildRegistry } from '../display';
import { describeFailure } from '../failure';
import { listTypes, searchItems } from '../marfa';

type Input = {
  /** Words to look for, as the person would describe the item. Full-text, not a filter language. */
  query: string;
  /**
   * A type identifier to narrow to, such as `core.note` or `core.bookmark`. Omit it unless the
   * person named a kind of item.
   */
  type?: string;
};

/**
 * Full rows, so the model can answer from them without a second call: the
 * item's name as the apps show it, its text, tags and when it last changed.
 */
export default async function tool(input: Input) {
  try {
    const [types, entries] = await Promise.all([
      listTypes(),
      searchItems({ query: input.query, type: input.type, state: 'active', limit: 20 }),
    ]);
    const registry = buildRegistry(types);
    return entries.map(({ item, metadata }) => ({
      id: item.id,
      type: item.type,
      kind: registry.label(item.type),
      title: registry.titleOf(item),
      text: registry.bodyOf(item),
      url: typeof item.properties.url === 'string' ? item.properties.url : undefined,
      tags: metadata.tags,
      updatedAt: item.updated_at,
    }));
  } catch (error) {
    const failure = describeFailure(error);
    throw new Error(`${failure.title}. ${failure.message}`);
  }
}
