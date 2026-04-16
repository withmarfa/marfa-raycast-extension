import { Action, ActionPanel, Form, Icon, showHUD, useNavigation } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { useState } from 'react';
import { getClient } from './client';
import { CAPTURE_TYPES } from './constants';

interface FormValues {
  type: string;
  title: string;
  body: string;
  url: string;
  description: string;
  due_at: Date | null;
  starts_at: Date | null;
  priority: string;
  place: string;
  tags: string;
}

export default function QuickCaptureCommand() {
  const [type, setType] = useState('core.note');
  const [urlError, setUrlError] = useState<string | undefined>();
  const [titleError, setTitleError] = useState<string | undefined>();
  const { pop } = useNavigation();

  async function handleSubmit(values: FormValues) {
    // Validate required fields
    if (type === 'core.bookmark' && !values.url?.trim()) {
      setUrlError('URL is required');
      return;
    }
    if (type === 'core.task' && !values.title?.trim()) {
      setTitleError('Title is required');
      return;
    }

    const properties: Record<string, unknown> = {};

    switch (type) {
      case 'core.note':
        if (values.title) properties.title = values.title;
        if (values.body) properties.body = values.body;
        break;
      case 'core.bookmark':
        if (values.url) properties.url = values.url;
        if (values.title) properties.title = values.title;
        if (values.description) properties.description = values.description;
        break;
      case 'core.task':
        if (values.title) properties.title = values.title;
        if (values.description) properties.description = values.description;
        if (values.due_at) properties.due_at = values.due_at.toISOString();
        if (values.priority) properties.priority = values.priority;
        break;
      case 'core.event':
        if (values.title) properties.title = values.title;
        if (values.starts_at) properties.starts_at = values.starts_at.toISOString();
        if (values.place) properties.place = values.place;
        break;
    }

    const tags = values.tags
      ? values.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

    try {
      const client = getClient();
      await client.items.create({ type, properties, tags, library: true });
      await showHUD('Item captured');
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to capture' });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Capture" icon={Icon.Plus} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="type" title="Type" value={type} onChange={setType}>
        {CAPTURE_TYPES.map((t) => (
          <Form.Dropdown.Item key={t.value} value={t.value} title={t.label} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      {type === 'core.note' && (
        <>
          <Form.TextField id="title" title="Title" placeholder="Note title" />
          <Form.TextArea id="body" title="Body" placeholder="Write your note..." />
        </>
      )}

      {type === 'core.bookmark' && (
        <>
          <Form.TextField
            id="url"
            title="URL"
            placeholder="https://..."
            error={urlError}
            onChange={() => setUrlError(undefined)}
          />
          <Form.TextField id="title" title="Title" placeholder="Bookmark title" />
          <Form.TextArea id="description" title="Description" placeholder="Optional description" />
        </>
      )}

      {type === 'core.task' && (
        <>
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Task title"
            error={titleError}
            onChange={() => setTitleError(undefined)}
          />
          <Form.TextArea id="description" title="Description" placeholder="Optional description" />
          <Form.DatePicker id="due_at" title="Due Date" />
          <Form.Dropdown id="priority" title="Priority" defaultValue="medium">
            <Form.Dropdown.Item title="Low" value="low" />
            <Form.Dropdown.Item title="Medium" value="medium" />
            <Form.Dropdown.Item title="High" value="high" />
            <Form.Dropdown.Item title="Urgent" value="urgent" />
          </Form.Dropdown>
        </>
      )}

      {type === 'core.event' && (
        <>
          <Form.TextField id="title" title="Title" placeholder="Event title" />
          <Form.DatePicker id="starts_at" title="Starts At" />
          <Form.TextField id="place" title="Place" placeholder="Location" />
        </>
      )}

      <Form.Separator />
      <Form.TextField id="tags" title="Tags" placeholder="tag1, tag2 (comma-separated)" />
    </Form>
  );
}
