import { openExtensionPreferences, showToast, Toast } from '@raycast/api';
import { describeFailure, SETUP_KINDS } from './failure';

/**
 * A failure as a toast, titled by what was being done and explained in terms
 * of what the person can change. A setup failure carries the way to the
 * preferences, since that is where every one of them is fixed.
 */
export async function showFailure(error: unknown, doing: string): Promise<void> {
  const failure = describeFailure(error);
  await showToast({
    style: Toast.Style.Failure,
    title: `${doing} failed`,
    message: `${failure.title}. ${failure.message}`,
    primaryAction: SETUP_KINDS.has(failure.kind)
      ? { title: 'Open Extension Preferences', onAction: () => void openExtensionPreferences() }
      : undefined,
  });
}
