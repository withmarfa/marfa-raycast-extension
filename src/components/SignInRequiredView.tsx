import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  LaunchType,
  launchCommand,
  List,
  openExtensionPreferences,
} from '@raycast/api';

/**
 * Shared "Sign in to Myme" empty state. List-flavoured (for the four list
 * commands) and Detail-flavoured (for view-only / form commands that can't
 * render a `List.EmptyView`).
 *
 * Wired via `launchCommand({ name: 'login', type: LaunchType.UserInitiated })`
 * so the Sign In action drives the OAuth flow without the user typing the
 * command name.
 */

const SIGN_IN_TITLE = 'Sign in to Myme';
const SIGN_IN_DESCRIPTION =
  'Connect your Myme account to start capturing, browsing, and managing items.';

function buildSignInActions() {
  return (
    <ActionPanel>
      <Action
        title="Sign in to Myme"
        icon={Icon.Key}
        onAction={() => {
          void launchCommand({ name: 'login', type: LaunchType.UserInitiated });
        }}
      />
      <Action
        title="Open Preferences"
        icon={Icon.Gear}
        onAction={() => {
          void openExtensionPreferences();
        }}
      />
    </ActionPanel>
  );
}

export function SignInRequiredEmptyView() {
  return (
    <List.EmptyView
      icon={{ source: Icon.Key, tintColor: Color.Yellow }}
      title={SIGN_IN_TITLE}
      description={SIGN_IN_DESCRIPTION}
      actions={buildSignInActions()}
    />
  );
}

export function SignInRequiredDetail() {
  const markdown = `# ${SIGN_IN_TITLE}\n\n${SIGN_IN_DESCRIPTION}`;
  return <Detail markdown={markdown} actions={buildSignInActions()} />;
}
