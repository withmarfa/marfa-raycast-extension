import { Action, ActionPanel, Detail, getPreferenceValues, Icon, Keyboard } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient, isStaticKeySession } from './client';
import { resolveSessionIdentity, type SessionIdentity } from './session-identity';

/**
 * Server Info, a read-only operator view. Surfaces instance URL, auth mode and
 * signed-in identity. Sign-out lives in Raycast's built-in **Logout**
 * preference, auto-surfaced once tokens are stored. Disabled by default in
 * package.json, so operators flip it on in Raycast Preferences → Extensions →
 * Marfa when they want it.
 */

interface Preferences {
  apiUrl?: string;
  apiKey?: string;
}

function ServerInfoCommand() {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();

  const { data, isLoading, revalidate } = useCachedPromise(async (): Promise<SessionIdentity> => {
    const staticKey = isStaticKeySession();
    if (staticKey) return resolveSessionIdentity({ staticKey });
    try {
      return resolveSessionIdentity({ staticKey, profile: await getClient().profile.get() });
    } catch (error) {
      // Handled rather than thrown, which is also why this hook has no error
      // handler: a profile this session cannot read is the ordinary case, so
      // a toast on every launch would be noise on the one screen meant to
      // explain the session rather than interrupt it. The reason is rendered.
      return resolveSessionIdentity({ staticKey, error });
    }
  }, []);

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
  // Below the table rather than in it. The reason can be a message the server
  // wrote, and a pipe or a newline in a table cell silently reshapes every row
  // after it. Out here the worst a stray character does is read oddly.
  if (data?.note) lines.push(`> ${data.note}`, '');
  lines.push('Sign out via Raycast → Extensions → Marfa → **Logout**.');

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
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={revalidate}
          />
        </ActionPanel>
      }
    />
  );
}

export default withMarfaAccessToken(ServerInfoCommand);
