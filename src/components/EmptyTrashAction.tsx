import { Action, Alert, confirmAlert, Icon, showToast, Toast } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { getClient } from '../client';

interface EmptyTrashActionProps {
  count: number;
  onComplete: () => void;
}

/**
 * Server enforces the literal `'PURGE'` confirmation string; the Raycast
 * `confirmAlert` is a second gate so the action can't fire from a stray
 * keystroke. Only rendered when the active state filter is `trashed` and
 * the visible list is non-empty.
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
