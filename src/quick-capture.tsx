import { type Form, getPreferenceValues, type LaunchProps } from '@raycast/api';
import { CaptureForm } from './components/CaptureForm';
import { NOTE_TYPE } from './display';
import { useRegistry } from './use-registry';

/**
 * Capture any type, starting on the Default Capture Type. A note is written as
 * its body, named by its first line as every app names it; any other type gets
 * the form its schema describes. A half-written capture is kept as a draft.
 */
export default function QuickCapture(props: LaunchProps<{ draftValues: Form.Values }>) {
  const { defaultCaptureType } = getPreferenceValues<Preferences>();
  const { registry, isLoading } = useRegistry();
  return (
    <CaptureForm
      registry={registry}
      registryLoading={isLoading}
      initialType={defaultCaptureType?.trim() || NOTE_TYPE}
      enableDrafts
      draftValues={props.draftValues}
    />
  );
}
