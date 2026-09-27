import { Action, ActionPanel, Icon, Keyboard, List, openExtensionPreferences } from '@raycast/api';
import { describeFailure, SETUP_KINDS } from '../failure';

/**
 * A list that cannot load says why in place of its rows. A setup failure owns
 * the screen rather than flashing a toast over an empty list, because nothing
 * on the list can work until a preference or the server changes.
 */
export function FailureEmptyView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const failure = describeFailure(error);
  const setup = SETUP_KINDS.has(failure.kind);
  return (
    <List.EmptyView
      icon={failure.kind === 'contract' ? Icon.Warning : setup ? Icon.Plug : Icon.XMarkCircle}
      title={failure.title}
      description={failure.message}
      actions={
        <ActionPanel>
          {setup && (
            <Action
              title="Open Extension Preferences"
              icon={Icon.Gear}
              onAction={openExtensionPreferences}
            />
          )}
          <Action
            title="Try Again"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={onRetry}
          />
        </ActionPanel>
      }
    />
  );
}
