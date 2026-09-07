import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Icon,
  List,
  showToast,
  Toast,
  Keyboard,
} from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import type { ApiKey } from '@withmarfa/sdk';
import { ForbiddenError } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { KEY_MANAGEMENT_NOT_GRANTED, keyRefusal } from './key-refusal';
import { useKeyGrant } from './use-key-grant';
import { ReauthorizeAction } from './components/ReauthorizeAction';
import { roleColor } from './constants';
import { formatRelativeTime } from './helpers';
import { CreateKeyForm, EditKeyForm } from './components/KeyForms';
import { KeyDetailView } from './components/KeyDetailView';

function ManageKeysCommand() {
  const mayManageKeys = useKeyGrant();
  const {
    data: keys,
    isLoading,
    error,
    mutate,
  } = useCachedPromise(
    async () => {
      const client = getClient();
      return client.keys.list();
    },
    [],
    {
      onError: async (e) => {
        if (e instanceof ForbiddenError) return;
        await showFailureToast(e, { title: 'Failed to load keys' });
      },
    },
  );

  async function handleRevoke(key: ApiKey) {
    const confirmed = await confirmAlert({
      title: 'Revoke Key',
      message: `Revoke key "${key.label}"? This cannot be undone.`,
      primaryAction: { title: 'Revoke', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      const client = getClient();
      await client.keys.revoke(key.id);
      await showToast({ style: Toast.Style.Success, title: 'Key revoked' });
      await mutate();
    } catch (err) {
      if (err instanceof ForbiddenError) {
        await showFailureToast(err, { title: keyRefusal(err).title });
      } else {
        await showFailureToast(err, { title: 'Failed to revoke key' });
      }
    }
  }

  // **Two refusals wear one status code, and the server says which.** A
  // refusal naming a capability is a permission nobody ticked, and the way out
  // is the consent screen. One naming none is role, and the consent screen
  // does nothing for it. Reading the server's own answer rather than inferring
  // from the local grant also keeps this right when the two disagree, which
  // they do whenever a stored grant is stale.
  if (error instanceof ForbiddenError) {
    const refusal = keyRefusal(error);
    return (
      <List isLoading={isLoading}>
        <List.EmptyView
          icon={{ source: Icon.Lock, tintColor: Color.Yellow }}
          title={refusal.title}
          description={refusal.description}
          actions={
            refusal.reconsentHelps ? (
              <ActionPanel>
                <ReauthorizeAction />
              </ActionPanel>
            ) : undefined
          }
        />
      </List>
    );
  }

  // Whether to offer creation at all, asked before any request. A static key
  // or a grant carrying the capability may; anything else is offered the way
  // to grant it instead of an action certain to be refused, which reads as a
  // broken extension rather than a permission nobody gave.
  const createAction = mayManageKeys ? (
    <Action.Push
      title="Create New Key"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={<CreateKeyForm onCreated={() => mutate()} />}
    />
  ) : (
    // Present rather than hidden, so cmd+N answers the question a person is
    // about to ask instead of doing nothing at all.
    <Action
      title="Why Can't I Create a Key?"
      icon={Icon.QuestionMark}
      shortcut={Keyboard.Shortcut.Common.New}
      onAction={() =>
        showToast({
          style: Toast.Style.Failure,
          title: 'Permission to manage keys was not granted',
          message: KEY_MANAGEMENT_NOT_GRANTED,
        })
      }
    />
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter keys by label, source, or role...">
      <List.EmptyView
        icon={Icon.Key}
        title="No keys"
        description={
          mayManageKeys ? 'Create your first key with cmd+N.' : KEY_MANAGEMENT_NOT_GRANTED
        }
        actions={
          <ActionPanel>
            {createAction}
            {!mayManageKeys && <ReauthorizeAction />}
          </ActionPanel>
        }
      />
      {(keys ?? []).map((key) => (
        <List.Item
          key={key.id}
          icon={{ source: Icon.Key, tintColor: roleColor(key.role) }}
          title={key.label}
          keywords={[key.source, key.role, key.label]}
          accessories={[
            // The source is deliberately absent. The server derives a runtime
            // key's label from it, so the two render as the same string with
            // one character between them, and a row showing an identifier twice
            // makes a person doubt the rest of the screen. It is on the detail,
            // where it is the only place it appears.
            { tag: { value: key.role, color: roleColor(key.role) } },
            {
              date: new Date(key.created_at),
              tooltip: `Created ${formatRelativeTime(key.created_at)}`,
            },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Open Detail"
                icon={Icon.Eye}
                target={<KeyDetailView apiKey={key} onRefresh={() => mutate()} />}
              />
              <Action.Push
                title="Edit"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={<EditKeyForm apiKey={key} onSaved={() => mutate()} />}
              />
              <Action.CopyToClipboard
                title="Copy Key ID"
                content={key.id}
                shortcut={Keyboard.Shortcut.Common.Pin}
              />
              <Action.CopyToClipboard
                title="Copy Source"
                content={key.source}
                shortcut={Keyboard.Shortcut.Common.Duplicate}
              />
              <ActionPanel.Section>{createAction}</ActionPanel.Section>
              <ActionPanel.Section title="Danger">
                <Action
                  title="Revoke"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => handleRevoke(key)}
                  shortcut={{ modifiers: ['ctrl'], key: 'x' }}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export default withMarfaAccessToken(ManageKeysCommand);
