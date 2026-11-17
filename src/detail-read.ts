import { describeFailure } from './failure';
import type { Entry } from './marfa';

/**
 * How the detail view reads its item again. Pure, so what the view does when
 * the item has been restored, trashed or deleted elsewhere is tested without
 * Raycast.
 */

export type DetailRead = { kind: 'present'; entry: Entry } | { kind: 'gone' };

/**
 * Reads the item in whatever state it holds now, so a restore from the Trash
 * shows the restored item instead of a refusal. Only an item the server no
 * longer has, or the key can no longer read, is gone.
 */
export async function readForDetail(
  id: string,
  read: (id: string, state: 'any') => Promise<Entry>,
): Promise<DetailRead> {
  try {
    return { kind: 'present', entry: await read(id, 'any') };
  } catch (error) {
    if (describeFailure(error).kind === 'gone') return { kind: 'gone' };
    throw error;
  }
}
