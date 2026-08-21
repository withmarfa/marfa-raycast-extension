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
import { formatRelativeTime } from './helpers';
import { CreateKeyForm, EditKeyForm } from './components/KeyForms';
import { KeyDetailView } from './components/KeyDetailView';

function ManageKeysCommand() {
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
        await showFailureToast(err, { title: 'Admin credentials required' });
      } else {
        await showFailureToast(err, { title: 'Failed to revoke key' });
      }
    }
  }

  if (error instanceof ForbiddenError) {
    return (
      <List isLoading={isLoading}>
        <List.EmptyView
          icon={{ source: Icon.Lock, tintColor: Color.Yellow }}
          title="Admin credentials required"
          description="This account doesn't have admin role. Sign in with an admin account, or paste an admin API key in Preferences."
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter keys by label, source, or role...">
      <List.EmptyView
        icon={Icon.Key}
        title="No keys"
        description="Create your first key with cmd+N."
        actions={
          <ActionPanel>
            <Action.Push
              title="Create New Key"
              icon={Icon.Plus}
              shortcut={Keyboard.Shortcut.Common.New}
              target={<CreateKeyForm onCreated={() => mutate()} />}
            />
          </ActionPanel>
        }
      />
      {(keys ?? []).map((key) => (
        <List.Item
          key={key.id}
          icon={{
            source: Icon.Key,
            tintColor: key.role === 'admin' ? Color.Red : Color.Blue,
          }}
          title={key.label}
          subtitle={key.role}
          keywords={[key.source, key.role, key.label]}
          accessories={[
            { tag: key.source },
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
              <ActionPanel.Section>
                <Action.Push
                  title="Create New Key"
                  icon={Icon.Plus}
                  shortcut={Keyboard.Shortcut.Common.New}
                  target={<CreateKeyForm onCreated={() => mutate()} />}
                />
              </ActionPanel.Section>
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
