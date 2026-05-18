import {
  closeMainWindow,
  getPreferenceValues,
  openExtensionPreferences,
  popToRoot,
  showHUD,
  showToast,
  Toast,
} from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { signIn } from './auth/myme-oauth';
import { invalidateClientCache } from './client';

interface Preferences {
  apiUrl?: string;
}

export default async function SignInCommand() {
  const { apiUrl } = getPreferenceValues<Preferences>();
  if (!apiUrl?.trim()) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Server URL not set',
      message: 'Open Preferences and set the Myme server URL.',
      primaryAction: {
        title: 'Open Preferences',
        onAction: () => {
          openExtensionPreferences();
        },
      },
    });
    return;
  }

  try {
    await showToast({ style: Toast.Style.Animated, title: 'Signing in to Myme…' });
    await signIn(apiUrl.trim());
    invalidateClientCache();
    await showHUD('Signed in to Myme');
    await popToRoot();
    await closeMainWindow();
  } catch (error) {
    await showFailureToast(error, { title: 'Sign in failed' });
  }
}
