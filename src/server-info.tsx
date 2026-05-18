import {
  Action,
  ActionPanel,
  Detail,
  getPreferenceValues,
  Icon,
  LaunchType,
  launchCommand,
} from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { getClient, invalidateClientCache, MymeAuthMissingError } from './client';
import { signOut as oauthSignOut } from './auth/myme-oauth';
import { SignInRequiredDetail } from './components/SignInRequiredView';

/**
 * Server Info — read-only operator view. Surfaces instance URL, auth
 * mode, signed-in identity (when OAuth), and a Sign Out action. Disabled
 * by default in `package.json` — operators flip it on in Raycast
 * Preferences → Extensions → Myme when they want it.
 */

interface Preferences {
  apiUrl?: string;
  apiKey?: string;
}

interface ServerInfoData {
  authMode: 'oauth' | 'apiKey';
  identity: string;
  detail: string | null;
}

export default function ServerInfoCommand() {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();

  const { data, error, isLoading, revalidate } = useCachedPromise(
    async (): Promise<ServerInfoData> => {
      const client = await getClient();
      // OAuth principals can read their own profile; API-key principals
      // 401/404 here (no auth_user link), so fall back to the key label.
      try {
        const profile = await client.profile.get();
        const display = profile.username
          ? `${profile.email} (@${profile.username})`
          : profile.email;
        return { authMode: 'oauth', identity: display, detail: null };
      } catch {
        return { authMode: 'apiKey', identity: 'API key', detail: null };
      }
    },
    [],
    {
      onError: async (err) => {
        if (err instanceof MymeAuthMissingError) return;
        await showFailureToast(err, { title: 'Failed to read profile' });
      },
    },
  );

  if (error instanceof MymeAuthMissingError) {
    return <SignInRequiredDetail />;
  }

  const lines: string[] = ['# Server Info', ''];
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| **Instance URL** | \`${apiUrl ?? '(not set)'}\` |`);
  if (data) {
    lines.push(
      `| **Auth mode** | ${data.authMode === 'oauth' ? 'OAuth (PKCE)' : 'API key (static)'} |`,
    );
    lines.push(`| **Identity** | ${data.identity} |`);
  }
  if (data?.authMode === 'apiKey' && apiKey) {
    lines.push(`| **API key fingerprint** | \`${apiKey.slice(0, 8)}…${apiKey.slice(-4)}\` |`);
  }
  const markdown = lines.join('\n');

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          {apiUrl && (
            <Action.CopyToClipboard
              title="Copy Instance URL"
              content={apiUrl}
              shortcut={{ modifiers: ['cmd'], key: 'c' }}
            />
          )}
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ['cmd'], key: 'r' }}
            onAction={revalidate}
          />
          {data?.authMode === 'oauth' && (
            <Action
              title="Sign out"
              icon={Icon.Logout}
              style={Action.Style.Destructive}
              onAction={async () => {
                try {
                  await oauthSignOut();
                  invalidateClientCache();
                  revalidate();
                } catch (err) {
                  await showFailureToast(err, { title: 'Sign out failed' });
                }
              }}
            />
          )}
          {data?.authMode !== 'oauth' && (
            <Action
              title="Sign in to Myme"
              icon={Icon.Key}
              onAction={() => {
                void launchCommand({ name: 'login', type: LaunchType.UserInitiated });
              }}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
