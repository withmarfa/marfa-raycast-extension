import { showHUD } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { signOut } from './auth/myme-oauth';
import { invalidateClientCache } from './client';

export default async function SignOutCommand() {
  try {
    await signOut();
    invalidateClientCache();
    await showHUD('Signed out of Myme');
  } catch (error) {
    await showFailureToast(error, { title: 'Sign out failed' });
  }
}
