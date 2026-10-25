import { Clipboard, getPreferenceValues, getSelectedText } from '@raycast/api';
import { type ClipboardSnapshot, selectionSnapshot } from './clipboard';

/**
 * The text selected in the frontmost app, when the Selected Text preference is
 * on and there is some. It is the only thing that starts a capture by itself:
 * what is on the clipboard goes in only when the person asks.
 */
export async function readSelection(): Promise<ClipboardSnapshot | null> {
  const { preferSelectedText } = getPreferenceValues<Preferences>();
  if (!preferSelectedText) return null;
  // getSelectedText throws when nothing is selected or the app offers no selection.
  return selectionSnapshot(await getSelectedText().catch(() => undefined));
}

/** What is on the clipboard now. */
export async function readClipboard(): Promise<ClipboardSnapshot> {
  const content = await Clipboard.read();
  return { text: content.text ?? '', html: content.html ?? '', file: content.file ?? null };
}
