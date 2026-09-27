import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  getPreferenceValues,
  Icon,
  type LaunchProps,
  popToRoot,
  showHUD,
  showToast,
  Toast,
} from '@raycast/api';
import { useState } from 'react';
import { NOTE_TYPE, parseTags } from './display';
import { showFailure } from './feedback';
import { createItem } from './marfa';

interface CaptureValues {
  body: string;
  tags: string;
}

/**
 * A note, written here and saved to the library. The body is markdown and the
 * note is named by its first line, as every other app names it; the form
 * writes no title of its own.
 */
export default function QuickCapture(props: LaunchProps<{ draftValues: CaptureValues }>) {
  const { defaultTags } = getPreferenceValues<Preferences>();
  const [body, setBody] = useState(props.draftValues?.body ?? '');
  const [bodyError, setBodyError] = useState<string | undefined>();

  async function capture(values: CaptureValues) {
    if (!values.body.trim()) {
      setBodyError('Write something first');
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Capturing' });
    try {
      await createItem({
        type: NOTE_TYPE,
        properties: { body: values.body },
        tags: parseTags(values.tags),
      });
      await toast.hide();
      await showHUD('Note captured');
      await popToRoot({ clearSearchBar: true });
    } catch (error) {
      await toast.hide();
      await showFailure(error, 'Capturing');
    }
  }

  async function insertClipboard() {
    const text = await Clipboard.readText();
    if (!text?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: 'No text on the clipboard' });
      return;
    }
    setBody((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text));
    setBodyError(undefined);
  }

  return (
    <Form
      enableDrafts
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Capture Note" icon={Icon.Plus} onSubmit={capture} />
          <Action
            title="Insert Clipboard Text"
            icon={Icon.Clipboard}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'v' }}
            onAction={insertClipboard}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="body"
        title="Note"
        placeholder="The first line names the note"
        enableMarkdown
        value={body}
        error={bodyError}
        onChange={(value) => {
          setBody(value);
          if (bodyError && value.trim()) setBodyError(undefined);
        }}
      />
      <Form.TextField
        id="tags"
        title="Tags"
        placeholder="reading, later"
        info="Comma-separated"
        defaultValue={props.draftValues?.tags ?? defaultTags ?? ''}
      />
    </Form>
  );
}
