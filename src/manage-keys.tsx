import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { KeyDetail } from './components/KeyDetail';
import { CreateKeyForm, EditKeyForm } from './components/KeyForms';
import { FailureEmptyView } from './components/FailureEmptyView';
import { formatRelative } from './dates';
import { showFailure } from './feedback';
import { canManageKeys, keySummary } from './keys';
import { type ApiKey, currentKey, listKeys, revokeKey } from './marfa';

const MINT_COMMAND =
  "marfa keys create --label raycast --source raycast-keys --type-permission '*=write' --metadata-permission '*=write' --edge-permission '*=write' --permission keys.mint";

/**
 * Every key on the server, and minting, changing and revoking them. The key
 * in the preferences decides whether any of it is possible: without
 * `keys.mint`, and not the operator key, the command says so and stops.
 */
export default function ManageKeys() {
  const self = usePromise(currentKey, [], { onError: () => undefined });
  const allowed = self.data ? canManageKeys(self.data) : false;
  const keys = usePromise(listKeys, [], { execute: allowed, onError: () => undefined });

  if (self.error) {
    return (
      <List>
        <FailureEmptyView error={self.error} onRetry={self.revalidate} />
      </List>
    );
  }
  if (self.data && !allowed) {
    return (
      <List>
        <List.EmptyView
          icon={{ source: Icon.Lock, tintColor: Color.Yellow }}
          title="This key cannot manage keys"
          description={`Manage Keys needs the keys.mint permission, which the API Key “${self.data.label}” does not hold. Mint a key that holds it with the CLI, or with the operator key, and put it in the extension preferences.`}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy the Mint Command" content={MINT_COMMAND} />
              <Action
                title="Open Extension Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const refresh = () => {
    keys.revalidate();
    self.revalidate();
  };
  const creator = self.data;
  const createAction = creator && (
    <Action.Push
      title="Create Key"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={<CreateKeyForm creator={creator} onCreated={refresh} />}
    />
  );

  async function revoke(key: ApiKey): Promise<boolean> {
    const own = key.id === creator?.id;
    const confirmed = await confirmAlert({
      title: `Revoke “${key.label}”?`,
      message: own
        ? 'This is the key Raycast is using. Once revoked, nothing in the extension works until another key is in its preferences.'
        : `Anything using it is refused from its next request. Items it wrote stay, stamped with ${key.source}.`,
      primaryAction: { title: 'Revoke', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return false;
    try {
      await revokeKey(key.id);
      if (own) {
        // Nothing can be read with it now, the list included.
        await showToast({
          style: Toast.Style.Success,
          title: 'Revoked the key Raycast was using',
          message: 'Put another key in the extension preferences.',
          primaryAction: {
            title: 'Open Extension Preferences',
            onAction: () => void openExtensionPreferences(),
          },
        });
      } else {
        await showToast({ style: Toast.Style.Success, title: 'Revoked', message: key.label });
        refresh();
      }
      return true;
    } catch (error) {
      await showFailure(error, 'Revoking the key');
      return false;
    }
  }

  return (
    <List
      isLoading={self.isLoading || keys.isLoading}
      searchBarPlaceholder="Filter keys by label or source"
    >
      {keys.error ? (
        <FailureEmptyView error={keys.error} onRetry={refresh} />
      ) : !keys.data ? (
        <List.EmptyView icon={Icon.CircleProgress} title="Loading" />
      ) : (
        <List.EmptyView
          icon={Icon.Key}
          title="No keys"
          actions={<ActionPanel>{createAction}</ActionPanel>}
        />
      )}
      {(keys.data ?? []).map((key) => {
        const own = key.id === creator?.id;
        return (
          <List.Item
            key={key.id}
            icon={{
              source: Icon.Key,
              tintColor: key.is_operator
                ? Color.Purple
                : (key.permissions ?? []).length > 0
                  ? Color.Orange
                  : Color.SecondaryText,
            }}
            title={key.label}
            subtitle={key.source}
            keywords={[key.source, ...(key.sources ?? [])]}
            accessories={[
              ...(own ? [{ tag: { value: 'This key', color: Color.Green } }] : []),
              { tag: keySummary(key) },
              {
                text: formatRelative(key.last_used_at),
                tooltip: key.last_used_at ? 'Last used' : 'Never used',
              },
            ]}
            actions={
              <ActionPanel title={key.label}>
                <Action.Push
                  title="Show Key"
                  icon={Icon.Eye}
                  target={
                    <KeyDetail
                      apiKey={key}
                      own={own}
                      onChanged={refresh}
                      onRevoke={() => revoke(key)}
                    />
                  }
                />
                {!key.is_operator && (
                  <Action.Push
                    title="Edit Key"
                    icon={Icon.Pencil}
                    shortcut={Keyboard.Shortcut.Common.Edit}
                    target={<EditKeyForm apiKey={key} onSaved={refresh} />}
                  />
                )}
                {createAction}
                <ActionPanel.Section>
                  <Action.CopyToClipboard
                    title="Copy Key ID"
                    content={key.id}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'i' }}
                  />
                  <Action.CopyToClipboard title="Copy Source" content={key.source} />
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={refresh}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title="Revoke Key"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={() => void revoke(key)}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
