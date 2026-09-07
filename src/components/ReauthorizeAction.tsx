import { Action, confirmAlert, Icon, popToRoot, showToast, Toast } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { reauthorize } from '../auth/marfa-oauth';

/**
 * The way back to the consent screen.
 *
 * Offered wherever a narrow grant is felt rather than on one screen, because
 * the person who needs it is looking at a list missing things, and the command
 * that explains the session does not ship on the launcher.
 *
 * It closes the window rather than revalidating. `withAccessToken` resolves the
 * token once per process and hands the same one to every request afterwards,
 * so a command that stays open keeps using the grant that was just replaced and
 * shows the old answer under a success toast.
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
 */
export async function reviewWhatMarfaShares(): Promise<void> {
  const confirmed = await confirmAlert({
    title: REVIEW_WHAT_MARFA_SHARES,
    message: 'Opens the consent screen again so you can change what Raycast can read.',
    primaryAction: { title: 'Continue' },
  });
  if (!confirmed) return;

  const toast = await showToast({ style: Toast.Style.Animated, title: 'Opening consent' });
  try {
    await reauthorize();
    toast.style = Toast.Style.Success;
    toast.title = 'Permissions updated';
    await popToRoot();
  } catch (error) {
    toast.style = Toast.Style.Failure;
    await showFailureToast(error, { title: 'Consent was not completed' });
  }
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
