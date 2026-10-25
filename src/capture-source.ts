import { Clipboard, getPreferenceValues, getSelectedText } from '@raycast/api';
import { type CaptureSource, chooseSource } from './clipboard';

/** The selected text in the frontmost app, or the clipboard, as the Prefer Selected Text preference says. */
export async function readCaptureSource(): Promise<CaptureSource> {
  const { preferSelectedText } = getPreferenceValues<Preferences>();
  // getSelectedText throws when nothing is selected or the app offers no selection.
  const selection = preferSelectedText ? await getSelectedText().catch(() => undefined) : undefined;
  const content = await Clipboard.read();
  return chooseSource(
    selection,
    { text: content.text ?? '', html: content.html ?? '', file: content.file ?? null },
    preferSelectedText,
  );
}
