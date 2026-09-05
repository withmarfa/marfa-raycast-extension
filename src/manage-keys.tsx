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
import { getClient, isStaticKeySession } from './client';
import { roleColor } from './constants';
import { formatRelativeTime } from './helpers';
import { CreateKeyForm, EditKeyForm } from './components/KeyForms';
import { KeyDetailView } from './components/KeyDetailView';

/**
 * Why key minting is unavailable on a browser sign-in.
 *
 * The reason rather than the refusal, because the boundary is deliberate and
 * a person told only "forbidden" reasonably concludes the extension is
 * broken. A key minted from an OAuth token would carry permissions the grant
 * never had, and would keep working after the app was revoked.
 */
const KEY_MINTING_NEEDS_A_KEY =
  'A key would outlive the app you signed in with, so it has to be created somewhere that already holds one. Paste an admin API key into Preferences, or create the key in the web console.';

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

  // Minting a key is refused on a browser sign-in, so the command says why
  // instead of offering an action that cannot succeed. Offering it anyway
  // reads as a broken extension rather than a deliberate boundary, and the
  // refusal arrives as a bare permission error that names no reason.
  const canCreate = isStaticKeySession();
  const createAction = canCreate ? (
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
          title: 'Keys cannot be created from a browser sign-in',
          message: KEY_MINTING_NEEDS_A_KEY,
        })
      }
    />
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter keys by label, source, or role...">
      <List.EmptyView
        icon={Icon.Key}
        title="No keys"
        description={canCreate ? 'Create your first key with cmd+N.' : KEY_MINTING_NEEDS_A_KEY}
        actions={<ActionPanel>{createAction}</ActionPanel>}
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
