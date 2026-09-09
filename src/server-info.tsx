import {
  Action,
  ActionPanel,
  Color,
  Detail,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
} from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getGrantShortfall } from './auth/marfa-oauth';
import { getClient, isStaticKeySession } from './client';
import { ReauthorizeAction } from './components/ReauthorizeAction';
import { flattenScopes, groupScopes } from './scope-groups';
import { resolveSessionIdentity, type SessionIdentity } from './session-identity';

/**
 * Server Info, a read-only operator view. Surfaces instance URL, auth mode and
 * signed-in identity. Sign-out lives in Raycast's built-in **Logout**
 * preference, auto-surfaced once tokens are stored. Disabled by default in
 * package.json, so operators flip it on in Raycast Preferences → Extensions →
 * Marfa when they want it.
 */

/** The identity, plus what this session was not given. */
type SessionView = SessionIdentity & { shortfall: string[] };

interface Preferences {
  apiUrl?: string;
  apiKey?: string;
}

/** Pushed rather than inline: the shortfall runs to sixty-odd entries, and a
 *  bullet each buried everything else on the screen. */
function MissingScopesList({ scopes }: { scopes: string[] }) {
  const families = groupScopes(scopes);
  const copyAll = (
    <Action.CopyToClipboard
      title="Copy All Scopes"
      content={flattenScopes(families).join('\n')}
      shortcut={Keyboard.Shortcut.Common.Copy}
    />
  );

  return (
    <List
      navigationTitle={`Not granted (${String(scopes.length)})`}
      searchBarPlaceholder="Filter scopes..."
    >
      {families.map((family) => (
        <List.Section
          key={family.name}
          title={family.label}
          subtitle={family.scopeCount === 1 ? '1 scope' : `${String(family.scopeCount)} scopes`}
        >
          {family.groups.map((group) => (
            <List.Item
              // Qualified by family, because `id` has to be unique across the
              // whole list and `profile` is a resource in two of them.
              id={`${family.name}/${group.resource}`}
              key={group.resource}
              title={group.resource}
              keywords={group.scopes}
              accessories={group.accesses.map((access) => ({
                // Read and write are the difference between not seeing
                // something and not being able to add to it.
                tag: { value: access, color: access === 'read' ? Color.Blue : Color.Orange },
              }))}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title={group.scopes.length === 1 ? 'Copy Scope' : 'Copy Scopes'}
                    content={group.scopes.join('\n')}
                  />
                  {copyAll}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

function ServerInfoCommand() {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();

  const { data, isLoading, revalidate } = useCachedPromise(async (): Promise<SessionView> => {
    const staticKey = isStaticKeySession();
    // A static key carries no OAuth grant, so there is no shortfall to name.
    const shortfall = staticKey ? [] : await getGrantShortfall();
    if (staticKey) return { ...resolveSessionIdentity({ staticKey }), shortfall };
    try {
      const profile = await getClient().profile.get();
      return { ...resolveSessionIdentity({ staticKey, profile }), shortfall };
    } catch (error) {
      // Handled rather than thrown, which is also why this hook has no error
      // handler: the profile is gated on a permission a person can decline on
      // the consent screen, so a session that cannot read it is an ordinary
      // session rather than a fault, and a toast on every launch would be
      // noise on the one screen meant to explain the session rather than
      // interrupt it. The reason is rendered.
      return { ...resolveSessionIdentity({ staticKey, error }), shortfall };
    }
  }, []);

  const shortfall = data?.shortfall ?? [];

  // The refusal stays in the body rather than becoming a sidebar row, because
  // it can be a message the server wrote and a stray pipe or newline in a
  // metadata row reshapes the rows after it. Out here it only reads oddly.
  // Everything else this screen knows is a row or an action, and saying any of
  // it again in prose is what made the page unreadable.
  const markdown = data?.note ? `> ${data.note}` : '';

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Instance URL" text={apiUrl ?? '(not set)'} />
          {data && (
            <Detail.Metadata.TagList title="Auth mode">
              <Detail.Metadata.TagList.Item
                text={data.authMode === 'oauth' ? 'OAuth (PKCE)' : 'API key (static)'}
                color={data.authMode === 'oauth' ? Color.Green : Color.Yellow}
              />
            </Detail.Metadata.TagList>
          )}
          {data && <Detail.Metadata.Label title="Identity" text={data.identity} />}
          {data?.authMode === 'apiKey' && apiKey && (
            <Detail.Metadata.Label
              title="Key fingerprint"
              text={`${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`}
            />
          )}
          {shortfall.length > 0 && (
            <Detail.Metadata.Label
              title="Not granted"
              icon={{ source: Icon.Lock, tintColor: Color.Orange }}
              text={shortfall.length === 1 ? '1 scope' : `${String(shortfall.length)} scopes`}
            />
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {shortfall.length > 0 && (
            <Action.Push
              title="Show Missing Scopes"
              icon={Icon.Lock}
              shortcut={Keyboard.Shortcut.Common.Open}
              target={<MissingScopesList scopes={shortfall} />}
            />
          )}
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
          {data?.authMode === 'oauth' && <ReauthorizeAction />}
        </ActionPanel>
      }
    />
  );
}

export default withMarfaAccessToken(ServerInfoCommand);
