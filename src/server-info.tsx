import { Action, ActionPanel, Detail, getPreferenceValues, Icon } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { withMymeAccessToken } from './auth/with-myme-access-token';
import { getClient } from './client';

/**
 * Server Info — read-only operator view. Surfaces instance URL, auth
 * mode, and signed-in identity. Sign-out lives in Raycast's built-in
 * **Logout** preference (auto-surfaced once tokens are stored). Disabled
 * by default in package.json — operators flip it on in Raycast Preferences
 * → Extensions → Myme when they want it.
 */

interface Preferences {
  apiUrl?: string;
  apiKey?: string;
}

interface ServerInfoData {
  authMode: 'oauth' | 'apiKey';
  identity: string;
}

function ServerInfoCommand() {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();

  const { data, isLoading, revalidate } = useCachedPromise(
    async (): Promise<ServerInfoData> => {
      if (apiKey?.trim()) {
        return { authMode: 'apiKey', identity: 'API key' };
      }
      const client = getClient();
      try {
        const profile = await client.profile.get();
        const display = profile.username
          ? `${profile.email} (@${profile.username})`
          : profile.email;
        return { authMode: 'oauth', identity: display };
      } catch {
        return { authMode: 'apiKey', identity: 'API key' };
      }
    },
    [],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to read profile' });
      },
    },
  );

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
  lines.push('');
  lines.push('Sign out via Raycast → Extensions → Myme → **Logout**.');

  return (
    <Detail
      isLoading={isLoading}
      markdown={lines.join('\n')}
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
        </ActionPanel>
      }
    />
  );
}

export default withMymeAccessToken(ServerInfoCommand);
