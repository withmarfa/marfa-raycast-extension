import { Clipboard, showHUD } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { getClient } from './client';

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
  const client = getClient();

  try {
    if (isUrl(content)) {
      await client.items.create({
        type: 'core.bookmark',
        properties: { url: content, title: content },
      });
      await showHUD('Bookmark captured');
    } else {
      await client.items.create({
        type: 'core.note',
        properties: { body: content },
      });
      await showHUD('Note captured');
    }
  } catch (error) {
    await showFailureToast(error, { title: 'Failed to capture' });
  }
}
