/**
 * The bodies of the requests that delete or overwrite, built apart from the
 * door so a test holds each one to what it must say: a count that is a dry
 * run, a purge held to what was confirmed, an edit that settles or refuses a
 * collision as its caller means.
 */

/** The server's hard ceiling on a bulk action's match set. */
export const BULK_MAX_ITEMS = 50_000;

const TRASH = { action: 'purge', confirm: 'PURGE', filter: { state: 'trashed' } } as const;

/** Counts the Trash and deletes nothing. The ceiling is the server's own, so a full Trash is counted rather than refused. */
export function countTrashBody() {
  return { ...TRASH, dry_run: true, max_items: BULK_MAX_ITEMS } as const;
}

/** Empties the Trash, refusing if it matches more than the count confirmed. */
export function emptyTrashBody(confirmed: number) {
  return { ...TRASH, max_items: confirmed } as const;
}

/**
 * An edit against the version read. `settle` asks the server to settle a
 * collision by the type's merge policy: right for a note, whose body keeps
 * both copies, and wrong for a type whose default is the last writer winning,
 * where it would overwrite the other side's change without a word. Without
 * it, a stale edit that collides on nothing still merges, and a collision is
 * refused with the server's current copy.
 */
export function editRequest(input: {
  version: number;
  properties: Record<string, unknown>;
  mode: 'merge' | 'replace';
  settle: boolean;
}) {
  return {
    query: input.settle ? ({ conflict: 'auto' } as const) : {},
    body: { version: input.version, properties: input.properties, properties_mode: input.mode },
  };
}

/** Whether two id lists name the same items, in any order. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((id) => left.has(id));
}
