import { Clipboard, LaunchType, launchCommand, showHUD, showToast, Toast } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { getClient, MymeAuthMissingError } from './client';

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default async function ClipboardCaptureCommand() {
  const text = await Clipboard.readText();
  if (!text?.trim()) {
    await showFailureToast('Nothing on clipboard');
    return;
  }

  const content = text.trim();
  let client;
  try {
    client = await getClient();
  } catch (err) {
    if (err instanceof MymeAuthMissingError) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Sign in to Myme',
        message: 'Run the Sign in to Myme command first.',
        primaryAction: {
          title: 'Sign In',
          onAction: () => {
            void launchCommand({ name: 'login', type: LaunchType.UserInitiated });
          },
        },
      });
      return;
    }
    await showFailureToast(err, { title: 'Failed to capture' });
    return;
  }

  try {
    if (isUrl(content)) {
      await client.items.create({
        type: 'core.bookmark',
        properties: { url: content, title: content },
        tier: 'library',
      });
      await showHUD('Bookmark captured');
    } else {
      await client.items.create({
        type: 'core.note',
        properties: { body: content },
        tier: 'library',
      });
      await showHUD('Note captured');
    }
  } catch (error) {
    await showFailureToast(error, { title: 'Failed to capture' });
  }
}
