import { Clipboard, getPreferenceValues, showHUD, showToast, Toast } from '@raycast/api';
import { captureFromText, parseTags } from './display';
import { showFailure } from './feedback';
import { createItem } from './marfa';

/**
 * The clipboard's text, captured without a form: a lone web address as a
 * bookmark, anything else as a note. To shape the text first, Quick Capture
 * inserts the clipboard into its form.
 */
export default async function ClipboardCapture() {
  const { defaultTags } = getPreferenceValues<Preferences>();
  const content = await Clipboard.read();
  // A copied file also offers its name as text, which would capture a note
  // holding a file name; files are not captured yet, so say so.
  if (content.file) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Files are not captured yet',
      message: 'Copy text or a link instead.',
    });
    return;
  }
  const capture = captureFromText(content.text ?? '');
  if (!capture) {
    await showToast({ style: Toast.Style.Failure, title: 'No text on the clipboard' });
    return;
  }
  try {
    await createItem({
      type: capture.type,
      properties: capture.properties,
      tags: parseTags(defaultTags),
    });
    await showHUD(`${capture.noun} captured`);
  } catch (error) {
    await showFailure(error, `Capturing the ${capture.noun.toLowerCase()}`);
  }
}
