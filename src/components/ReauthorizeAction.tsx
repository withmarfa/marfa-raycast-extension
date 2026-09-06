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
export function ReauthorizeAction() {
  async function handleReauthorize() {
    const confirmed = await confirmAlert({
      title: 'Review What Marfa Shares',
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

  return (
    <Action
      title="Review What Marfa Shares"
      icon={Icon.Key}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
      onAction={handleReauthorize}
    />
  );
}
