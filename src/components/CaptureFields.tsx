import { Form } from '@raycast/api';
import type { ReactNode } from 'react';

/**
 * Shared type-specific form fields used by Quick Capture and Clipboard
 * Capture (Edit). Each branch returns the field set Raycast Form needs for
 * the chosen item type. Field IDs match the `FormValues` shape consumed by
 * the host form's submit handler.
 */
export interface CaptureFieldOptions {
  type: string;
  defaultTitle?: string;
  defaultBody?: string;
  defaultUrl?: string;
  defaultDescription?: string;
  urlError?: string;
  titleError?: string;
  bodyError?: string;
  onUrlChange?: () => void;
  onTitleChange?: () => void;
  onBodyChange?: () => void;
}

export function CaptureFields(props: CaptureFieldOptions): ReactNode {
  const {
    type,
    defaultTitle,
    defaultBody,
    defaultUrl,
    defaultDescription,
    urlError,
    titleError,
    bodyError,
    onUrlChange,
    onTitleChange,
    onBodyChange,
  } = props;

  switch (type) {
    case 'core.note':
      return (
        <>
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Note title"
            defaultValue={defaultTitle}
            onChange={onTitleChange}
          />
          <Form.TextArea
            id="body"
            title="Body"
            placeholder="Write your note..."
            defaultValue={defaultBody}
            error={bodyError}
            onChange={onBodyChange}
          />
        </>
      );
    case 'core.bookmark':
      return (
        <>
          <Form.TextField
            id="url"
            title="URL"
            placeholder="https://..."
            defaultValue={defaultUrl}
            error={urlError}
            onChange={onUrlChange}
          />
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Bookmark title"
            defaultValue={defaultTitle}
            onChange={onTitleChange}
          />
          <Form.TextArea
            id="description"
            title="Description"
            placeholder="Optional description"
            defaultValue={defaultDescription}
          />
        </>
      );
    case 'core.task':
      return (
        <>
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Task title"
            defaultValue={defaultTitle}
            error={titleError}
            onChange={onTitleChange}
          />
          <Form.TextArea
            id="description"
            title="Description"
            placeholder="Optional description"
            defaultValue={defaultDescription}
          />
          <Form.DatePicker id="due_at" title="Due Date" />
          <Form.Dropdown id="priority" title="Priority" defaultValue="medium">
            <Form.Dropdown.Item title="Low" value="low" />
            <Form.Dropdown.Item title="Medium" value="medium" />
            <Form.Dropdown.Item title="High" value="high" />
            <Form.Dropdown.Item title="Urgent" value="urgent" />
          </Form.Dropdown>
        </>
      );
    case 'core.event':
      return (
        <>
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Event title"
            defaultValue={defaultTitle}
            onChange={onTitleChange}
          />
          <Form.DatePicker id="starts_at" title="Starts At" />
          <Form.TextField id="place" title="Place" placeholder="Location" />
        </>
      );
    default:
      return null;
  }
}
