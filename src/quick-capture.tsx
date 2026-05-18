import { Action, ActionPanel, Form, Icon, showHUD, useNavigation } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import { getClient, MymeAuthMissingError } from './client';
import { CAPTURE_TYPES } from './constants';
import { CaptureFields } from './components/CaptureFields';
import { SignInRequiredDetail } from './components/SignInRequiredView';

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

  // Probe credentials before rendering the form — if no session, surface
  // the Sign In screen rather than a form that 401s on submit.
  const { error: authError, isLoading: authLoading } = useCachedPromise(
    async () => {
      await getClient();
      return true;
    },
    [],
    {
      onError: async (err) => {
        if (err instanceof MymeAuthMissingError) return;
        await showFailureToast(err);
      },
    },
  );
  if (authError instanceof MymeAuthMissingError) {
    return <SignInRequiredDetail />;
  }
  if (authLoading) {
    return <Form isLoading actions={null} />;
  }

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
      const client = await getClient();
      await client.items.create({ type, properties, tags, tier: 'library' });
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

      <CaptureFields
        type={type}
        urlError={urlError}
        titleError={titleError}
        onUrlChange={() => setUrlError(undefined)}
        onTitleChange={() => setTitleError(undefined)}
      />

      <Form.Separator />
      <Form.TextField id="tags" title="Tags" placeholder="tag1, tag2 (comma-separated)" />
    </Form>
  );
}
