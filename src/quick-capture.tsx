import {
  Action,
  ActionPanel,
  Form,
  getPreferenceValues,
  Icon,
  showHUD,
  useNavigation,
} from '@raycast/api';
import { showFailureToast, withAccessToken } from '@raycast/utils';
import { useState } from 'react';
import { authorize, pkceClient } from './auth/myme-oauth';
import { getClient } from './client';
import { CAPTURE_TYPES } from './constants';
import { CaptureFields } from './components/CaptureFields';

interface CapturePreferences {
  defaultTier?: 'library' | 'feed';
  defaultCaptureType?: string;
  defaultTags?: string;
}

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

function mergeTags(prefTags: string | undefined, formTags: string): string[] | undefined {
  const tags: string[] = [];
  for (const raw of [prefTags ?? '', formTags ?? '']) {
    for (const tag of raw.split(',')) {
      const trimmed = tag.trim();
      if (trimmed && !tags.includes(trimmed)) tags.push(trimmed);
    }
  }
  return tags.length > 0 ? tags : undefined;
}

function QuickCaptureCommand() {
  const prefs = getPreferenceValues<CapturePreferences>();
  const defaultType =
    prefs.defaultCaptureType && CAPTURE_TYPES.some((t) => t.value === prefs.defaultCaptureType)
      ? prefs.defaultCaptureType
      : 'core.note';
  const defaultTier = prefs.defaultTier ?? 'library';

  const [type, setType] = useState(defaultType);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [titleError, setTitleError] = useState<string | undefined>();
  const { pop } = useNavigation();

  async function handleSubmit(values: FormValues) {
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

    const tags = mergeTags(prefs.defaultTags, values.tags);

    try {
      const client = getClient();
      await client.items.create({ type, properties, tags, tier: defaultTier });
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

export default withAccessToken({ authorize, client: pkceClient })(QuickCaptureCommand);
