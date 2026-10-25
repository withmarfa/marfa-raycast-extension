import { Form, getPreferenceValues } from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { readCaptureSource } from './capture-source';
import { clipboardType } from './clipboard';
import { CaptureForm } from './components/CaptureForm';
import { NOTE_TYPE } from './display';
import { useRegistry } from './use-registry';

/**
 * The selected text, or the clipboard, in a capture form to shape before it
 * lands: a copied file starts as a file, a lone link as a bookmark, and
 * anything else as the Default Capture Type, each field seeded from it by
 * what it is.
 */
export default function QuickCaptureEdit() {
  const { defaultCaptureType } = getPreferenceValues<Preferences>();
  const { registry, isLoading } = useRegistry();
  const source = usePromise(readCaptureSource);

  // A form control takes its starting value once, so nothing renders until
  // the text is read.
  if (!source.data) return <Form isLoading />;

  return (
    <CaptureForm
      registry={registry}
      registryLoading={isLoading}
      initialType={clipboardType(source.data.snapshot, defaultCaptureType?.trim() || NOTE_TYPE)}
      clipboard={source.data.snapshot}
    />
  );
}
