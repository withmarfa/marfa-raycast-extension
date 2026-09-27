import { Clipboard, getPreferenceValues, showHUD, showToast, Toast } from '@raycast/api';
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { captureFromFile, captureFromText } from './clipboard';
import { IMAGE_TYPE, parseTags } from './display';
import { showFailure } from './feedback';
import { createItem, uploadBlob } from './marfa';

/**
 * The clipboard captured without a form: a copied file as a file, an image as
 * an image, a lone web address as a bookmark, and any other text as a note,
 * its formatting kept as markdown. Clipboard Capture (Edit) shapes it first.
 */
export default async function ClipboardCapture() {
  const { defaultTags } = getPreferenceValues<Preferences>();
  const tags = parseTags(defaultTags);
  const content = await Clipboard.read();

  // Checked before the text, since a copied file also offers its name as text.
  if (content.file) {
    const file = captureFromFile(content.file);
    // A folder opens as a blob too, and only fails once fetch reads it, as a
    // transport error that would blame the server.
    if (!(await stat(file.path).catch(() => undefined))?.isFile()) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Only files can be captured',
        message: `${file.title} is a folder or cannot be read.`,
      });
      return;
    }
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Uploading',
      message: file.title,
    });
    try {
      const bytes = await openAsBlob(file.path, { type: file.mimeType });
      const { hash } = await uploadBlob(bytes);
      await createItem({
        type: file.type,
        properties: { blob_ref: hash, mime_type: file.mimeType, title: file.title },
        tags,
      });
      await toast.hide();
      await showHUD(file.type === IMAGE_TYPE ? 'Image captured' : 'File captured');
    } catch (error) {
      await toast.hide();
      await showFailure(error, `Capturing ${file.title}`);
    }
    return;
  }

  const capture = captureFromText({ text: content.text ?? '', html: content.html ?? '' });
  if (!capture) {
    await showToast({ style: Toast.Style.Failure, title: 'Nothing to capture on the clipboard' });
    return;
  }
  try {
    await createItem({ type: capture.type, properties: capture.properties, tags });
    await showHUD(`${capture.noun} captured`);
  } catch (error) {
    await showFailure(error, `Capturing the ${capture.noun.toLowerCase()}`);
  }
}
