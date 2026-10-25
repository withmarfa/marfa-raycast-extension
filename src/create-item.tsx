import { Form, getPreferenceValues, type LaunchProps } from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { readSelection } from './capture-source';
import { clipboardType } from './clipboard';
import { CaptureForm } from './components/CaptureForm';
import { NOTE_TYPE } from './display';
import { useRegistry } from './use-registry';

/**
 * Create an item of any type, starting on the Default Capture Type. The text
 * selected in the frontmost app, when there is some, starts the form: a lone
 * link as a bookmark, anything else on the default type, each field seeded
 * from it by what it is. A note is written as its body, named by its first
 * line as every app names it; any other type gets the form its schema
 * describes. Nothing is saved until the person submits, and a half-written
 * capture is kept as a draft.
 */
export default function CreateItem(props: LaunchProps<{ draftValues: Form.Values }>) {
  const { defaultCaptureType } = getPreferenceValues<Preferences>();
  const { registry, isLoading } = useRegistry();
  // A draft is what the person was writing, so a selection does not replace it.
  const selection = usePromise(readSelection, [], { execute: !props.draftValues });

  // A form control takes its starting value once, so nothing renders until
  // the selection is read.
  if (selection.isLoading) return <Form isLoading />;

  const preferred = defaultCaptureType?.trim() || NOTE_TYPE;
  return (
    <CaptureForm
      registry={registry}
      registryLoading={isLoading}
      initialType={selection.data ? clipboardType(selection.data, preferred) : preferred}
      clipboard={selection.data ?? undefined}
      canUseClipboard
      enableDrafts
      draftValues={props.draftValues}
    />
  );
}
