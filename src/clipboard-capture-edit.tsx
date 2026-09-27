import { Clipboard, Form, getPreferenceValues } from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { clipboardType, type ClipboardSnapshot } from './clipboard';
import { CaptureForm } from './components/CaptureForm';
import { NOTE_TYPE } from './display';
import { useRegistry } from './use-registry';

async function readClipboard(): Promise<ClipboardSnapshot> {
  const content = await Clipboard.read();
  return { text: content.text ?? '', html: content.html ?? '', file: content.file ?? null };
}

/**
 * The clipboard in a capture form, to shape before it lands: a copied file
 * starts as a file, a lone link as a bookmark, and anything else as the
 * Default Capture Type, each field seeded from the clipboard by what it is.
 */
export default function ClipboardCaptureEdit() {
  const { defaultCaptureType } = getPreferenceValues<Preferences>();
  const { registry, isLoading } = useRegistry();
  const clipboard = usePromise(readClipboard);

  // A form control takes its starting value once, so nothing renders until
  // the clipboard is read.
  if (!clipboard.data) return <Form isLoading />;

  return (
    <CaptureForm
      registry={registry}
      registryLoading={isLoading}
      initialType={clipboardType(clipboard.data, defaultCaptureType?.trim() || NOTE_TYPE)}
      clipboard={clipboard.data}
    />
  );
}
