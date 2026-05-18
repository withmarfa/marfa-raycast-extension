/// <reference types="node" />
import { Action, ActionPanel, Clipboard, Form, Icon, showHUD, useNavigation } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { getClient, MymeAuthMissingError } from './client';
import { CAPTURE_TYPES } from './constants';
import { CaptureFields } from './components/CaptureFields';
import { SignInRequiredDetail } from './components/SignInRequiredView';

/**
 * Clipboard Capture (Edit). Pre-fills a Quick-Capture-style form from
 * whatever is on the clipboard, then lets the user adjust type / fields
 * before submitting. The auto-routing on the no-view Clipboard Capture
 * command handles the "I trust the default" case; this command handles
 * "let me shape it before it lands".
 */

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

function mimeForFile(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface ClipboardSnapshot {
  text: string;
  html: string;
  file: string | null;
  filename: string | null;
  fileMime: string | null;
}

async function readClipboardSnapshot(): Promise<ClipboardSnapshot> {
  const content = await Clipboard.read();
  const text = content.text?.trim() ?? '';
  const html = content.html?.trim() ?? '';
  const rawFile = content.file ?? null;
  const file = rawFile
    ? rawFile.startsWith('file://')
      ? decodeURIComponent(rawFile.slice(7))
      : rawFile
    : null;
  return {
    text,
    html,
    file,
    filename: file ? basename(file) : null,
    fileMime: file ? mimeForFile(file) : null,
  };
}

function inferDefaultType(snapshot: ClipboardSnapshot): string {
  if (snapshot.file) {
    return snapshot.fileMime?.startsWith('image/') ? 'core.file.image' : 'core.file';
  }
  if (snapshot.text && isUrl(snapshot.text)) return 'core.bookmark';
  return 'core.note';
}

interface FormValues {
  type: string;
  title?: string;
  body?: string;
  url?: string;
  description?: string;
  due_at?: Date | null;
  starts_at?: Date | null;
  priority?: string;
  place?: string;
  tags?: string;
}

const EDIT_CAPTURE_TYPES = [
  ...CAPTURE_TYPES,
  { value: 'core.file.image', label: 'Image (from file)' },
  { value: 'core.file', label: 'File' },
];

export default function ClipboardCaptureEditCommand() {
  const { pop } = useNavigation();

  // Probe credentials before any other work.
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

  const { data: snapshot, isLoading: snapLoading } = useCachedPromise(readClipboardSnapshot, [], {
    onError: async (err) => {
      await showFailureToast(err, { title: 'Failed to read clipboard' });
    },
  });

  const [type, setType] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [titleError, setTitleError] = useState<string | undefined>();

  if (authError instanceof MymeAuthMissingError) {
    return <SignInRequiredDetail />;
  }
  if (authLoading || snapLoading || !snapshot) {
    return <Form isLoading actions={null} />;
  }

  // First-render default — once the user picks a type via the dropdown,
  // honour their choice for the rest of the session.
  const activeType = type ?? inferDefaultType(snapshot);

  async function handleSubmit(values: FormValues) {
    if (!snapshot) return;
    if (activeType === 'core.bookmark' && !values.url?.trim()) {
      setUrlError('URL is required');
      return;
    }
    if (activeType === 'core.task' && !values.title?.trim()) {
      setTitleError('Title is required');
      return;
    }

    try {
      const client = await getClient();

      // File-shaped types upload first, then create.
      if (activeType === 'core.file.image' || activeType === 'core.file') {
        if (!snapshot.file) {
          await showFailureToast('No file on clipboard for the selected type.');
          return;
        }
        const bytes = await readFile(snapshot.file);
        const mime = snapshot.fileMime ?? 'application/octet-stream';
        const { hash } = await client.blobs.upload(bytes, mime);
        const properties: Record<string, unknown> = {
          blob_ref: hash,
          mime_type: mime,
          filename: snapshot.filename ?? 'file',
        };
        if (values.title?.trim()) properties.title = values.title.trim();
        if (values.description?.trim()) properties.description = values.description.trim();
        const tags = parseTags(values.tags);
        await client.items.create({ type: activeType, properties, tags, tier: 'library' });
        await showHUD(activeType === 'core.file.image' ? 'Image captured' : 'File captured');
        pop();
        return;
      }

      const properties: Record<string, unknown> = {};
      switch (activeType) {
        case 'core.note':
          if (values.title?.trim()) properties.title = values.title.trim();
          if (values.body?.trim()) properties.body = values.body.trim();
          if (snapshot.html && snapshot.html !== snapshot.text) properties.html = snapshot.html;
          break;
        case 'core.bookmark':
          if (values.url?.trim()) properties.url = values.url.trim();
          if (values.title?.trim()) properties.title = values.title.trim();
          if (values.description?.trim()) properties.description = values.description.trim();
          break;
        case 'core.task':
          if (values.title?.trim()) properties.title = values.title.trim();
          if (values.description?.trim()) properties.description = values.description.trim();
          if (values.due_at) properties.due_at = values.due_at.toISOString();
          if (values.priority) properties.priority = values.priority;
          break;
        case 'core.event':
          if (values.title?.trim()) properties.title = values.title.trim();
          if (values.starts_at) properties.starts_at = values.starts_at.toISOString();
          if (values.place) properties.place = values.place;
          break;
      }

      const tags = parseTags(values.tags);
      await client.items.create({ type: activeType, properties, tags, tier: 'library' });
      await showHUD('Item captured');
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to capture' });
    }
  }

  const isFileType = activeType === 'core.file.image' || activeType === 'core.file';

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Capture" icon={Icon.Plus} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="type"
        title="Type"
        value={activeType}
        onChange={(v) => {
          setType(v);
          setUrlError(undefined);
          setTitleError(undefined);
        }}
      >
        {EDIT_CAPTURE_TYPES.map((t) => (
          <Form.Dropdown.Item
            key={t.value}
            value={t.value}
            title={
              snapshot.file && (t.value === 'core.file.image' || t.value === 'core.file')
                ? t.label
                : !snapshot.file && (t.value === 'core.file.image' || t.value === 'core.file')
                  ? `${t.label} (no file on clipboard)`
                  : t.label
            }
          />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      {isFileType ? (
        <>
          <Form.Description
            title="Source file"
            text={snapshot.file ?? 'No file on clipboard — switch to a non-file type.'}
          />
          <Form.TextField
            id="title"
            title="Title"
            placeholder={snapshot.filename ?? 'Optional title'}
            defaultValue={snapshot.filename ?? undefined}
          />
          <Form.TextArea id="description" title="Description" placeholder="Optional description" />
        </>
      ) : (
        <CaptureFields
          type={activeType}
          defaultTitle={inferDefaultTitle(activeType, snapshot)}
          defaultBody={inferDefaultBody(activeType, snapshot)}
          defaultUrl={inferDefaultUrl(activeType, snapshot)}
          urlError={urlError}
          titleError={titleError}
          onUrlChange={() => setUrlError(undefined)}
          onTitleChange={() => setTitleError(undefined)}
        />
      )}

      <Form.Separator />
      <Form.TextField id="tags" title="Tags" placeholder="tag1, tag2 (comma-separated)" />
    </Form>
  );
}

function parseTags(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const tags = value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function inferDefaultTitle(type: string, snap: ClipboardSnapshot): string | undefined {
  if (type === 'core.bookmark' && snap.text && isUrl(snap.text)) return snap.text;
  return undefined;
}

function inferDefaultBody(type: string, snap: ClipboardSnapshot): string | undefined {
  if (type === 'core.note' && snap.text) return snap.text;
  return undefined;
}

function inferDefaultUrl(type: string, snap: ClipboardSnapshot): string | undefined {
  if (type === 'core.bookmark' && snap.text && isUrl(snap.text)) return snap.text;
  return undefined;
}
