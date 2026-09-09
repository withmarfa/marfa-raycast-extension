import { Action, confirmAlert, Icon, popToRoot, showToast, Toast } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { requestConsentOnNextLaunch } from '../auth/marfa-oauth';

/**
 * The way back to the consent screen.
 *
 * Offered wherever a narrow grant is felt rather than on one screen, because
 * the person who needs it is looking at a list missing things, and the command
 * that explains the session does not ship on the launcher.
 */
/** The title both the action and any toast offering it must carry. One
 *  constant because a person looking for the thing they were just told about
 *  finds it by its name. */
export const REVIEW_WHAT_MARFA_SHARES = 'Review What Marfa Shares';

/**
 * The re-consent itself, callable rather than only clickable.
 *
 * Extracted because a refusal arrives two ways. A surface that can render an
 * `Action` gets one; a surface that can only raise a toast gets a
 * `primaryAction`, and before this it got neither — the toast named a
 * permission nobody had granted and offered nothing that could grant it.
 *
 * **It signs out and hands the sign-in itself to the next command launch
 * rather than running one here, which is load-bearing rather than tidy.** An
 * OAuth redirect is resolved back into the extension worker waiting for it, and
 * a worker belongs to a command that a person is free to dismiss and Raycast is
 * free to unload; awaiting the flow in this handler is what lost four
 * consecutive consent screens on a real install. `requestConsentOnNextLaunch`
 * carries the full account.
 *
 * Popping to root is not cosmetic either. `withAccessToken` resolves the token
 * once per process and hands the same one to every request afterwards, so a
 * command left open would keep using the session that was just discarded.
 */
export async function reviewWhatMarfaShares(): Promise<void> {
  const confirmed = await confirmAlert({
    title: REVIEW_WHAT_MARFA_SHARES,
    message:
      'Marfa signs out and opens the consent screen the next time you run one of its commands, so you can change what Raycast can read.',
    primaryAction: { title: 'Continue' },
  });
  if (!confirmed) return;

  try {
    await requestConsentOnNextLaunch();
  } catch (error) {
    await showFailureToast(error, { title: 'Could not sign out' });
    return;
  }

  await showToast({
    style: Toast.Style.Success,
    title: 'Signed out of Marfa',
    message: 'Run a Marfa command to choose what it can read.',
  });
  await popToRoot();
}

export function ReauthorizeAction() {
  return (
    <Action
      title={REVIEW_WHAT_MARFA_SHARES}
      icon={Icon.Key}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
      onAction={reviewWhatMarfaShares}
    />
  );
}
