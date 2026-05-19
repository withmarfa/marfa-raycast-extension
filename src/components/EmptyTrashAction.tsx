import {
  Action,
  Alert,
  confirmAlert,
  Icon,
  showToast,
  Toast,
} from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { getClient } from '../client';

interface EmptyTrashActionProps {
  count: number;
  onComplete: () => void;
}

/**
 * Bulk-purge every item currently in trash for the caller's tenant. Wires
 * `client.items.bulkAction({ action: 'purge', filter: { state: 'trashed' },
 * confirm: 'PURGE' })`. Server enforces the literal confirmation; we gate
 * with a Raycast `confirmAlert` so the keystroke can't slip through.
 *
 * Only rendered when the active state filter is `trashed` and the visible
 * list is non-empty — the action is meaningless otherwise.
 */
export function EmptyTrashAction({ count, onComplete }: EmptyTrashActionProps) {
  async function handleEmpty() {
    const confirmed = await confirmAlert({
      title: 'Empty Trash',
      message: `Permanently delete every trashed item (${count} visible)? This cannot be undone and runs across all of trash, not just what's loaded.`,
      primaryAction: { title: 'Empty Trash', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    try {
      const client = getClient();
      const result = await client.items.bulkAction({
        action: 'purge',
        confirm: 'PURGE',
        filter: { state: 'trashed' },
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Trash emptied',
        message: `${result.succeeded} purged${result.errored ? `, ${result.errored} failed` : ''}`,
      });
      onComplete();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to empty trash' });
    }
  }

  return (
    <Action
      title="Empty Trash"
      icon={Icon.Trash}
      style={Action.Style.Destructive}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 'backspace' }}
      onAction={handleEmpty}
    />
  );
}
