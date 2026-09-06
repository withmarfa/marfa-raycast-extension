import type { Item, Metadata } from '@withmarfa/sdk';

/** A row's data, whichever half of the list it came from. */
export interface Entry {
  item: Item;
  metadata: Metadata;
  /** Present only on a server hit, where it is the text that matched. */
  snippet_html?: string;
}

/** An unparseable timestamp sinks rather than poisoning the comparison: `NaN`
 *  from either side makes every comparison false and the sort incoherent. */
function at(entry: Entry): number {
  const parsed = Date.parse(entry.item.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The paginated walk and the server's answer to a query, as one list.
 *
 * Two sources because they answer different questions. The walk holds what has
 * been loaded and Raycast filters it natively as you type, which is instant and
 * is what a launcher is for. The search reaches past it, which the walk cannot
 * do: a match three pages down is invisible to a filter over what is on screen,
 * and that looks exactly like the item not existing.
 *
 * A hit wins a collision because it carries the snippet saying why it matched.
 * The result stays in date order so the merged list groups the same way the
 * unfiltered one does, rather than reordering itself the moment a query starts.
 */
export function mergeEntries(loaded: Entry[], hits: Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const entry of loaded) byId.set(entry.item.id, entry);
  for (const entry of hits) byId.set(entry.item.id, entry);
  return [...byId.values()].sort((a, b) => at(b) - at(a));
}

/**
 * Date headings, in the order the entries arrive.
 *
 * The caller sorts, so this preserves that order for both the sections and the
 * rows inside them. Sorting here as well would be a second opinion about
 * ordering, and the two would eventually disagree.
 */
export function groupByDate(
  entries: Entry[],
  formatDate: (timestamp: string) => string,
): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = formatDate(entry.item.timestamp);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}
