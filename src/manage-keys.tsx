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
} from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import type { ApiKey } from '@mymehq/sdk';
import { ForbiddenError } from '@mymehq/sdk';
import { getClient } from './client';
import { formatRelativeTime } from './helpers';
import { CreateKeyForm, EditKeyForm } from './components/KeyForms';
import { KeyDetailView } from './components/KeyDetailView';

export default function ManageKeysCommand() {
  const {
    data: keys,
    isLoading,
    error,
    mutate,
  } = useCachedPromise(
    async () => {
      const client = await getClient();
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
      const client = await getClient();
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
          description="The API key in extension preferences cannot list keys. Replace it with an admin key in Raycast preferences."
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
              shortcut={{ modifiers: ['cmd'], key: 'n' }}
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
                shortcut={{ modifiers: ['cmd'], key: 'e' }}
                target={<EditKeyForm apiKey={key} onSaved={() => mutate()} />}
              />
              <Action.CopyToClipboard
                title="Copy Key ID"
                content={key.id}
                shortcut={{ modifiers: ['cmd'], key: '.' }}
              />
              <Action.CopyToClipboard
                title="Copy Source"
                content={key.source}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
              />
              <ActionPanel.Section>
                <Action.Push
                  title="Create New Key"
                  icon={Icon.Plus}
                  shortcut={{ modifiers: ['cmd'], key: 'n' }}
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
