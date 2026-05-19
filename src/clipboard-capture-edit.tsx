/// <reference types="node" />
import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  getPreferenceValues,
  Icon,
  showHUD,
  useNavigation,
} from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { CreateItemInput } from '@mymehq/sdk';
import { withMymeAccessToken } from './auth/with-myme-access-token';
import { getClient } from './client';
import {
  buildCoreCaptureProperties,
  fetchCaptureLocation,
  isCoreCaptureType,
  mergeTags,
  normalizeTypeId,
  parseAdditionalProperties,
  parseCustomPropertiesJson,
  validateCoreCapture,
} from './capture-utils';
import {
  AdditionalPropertiesField,
  CaptureFields,
  CustomPropertiesFields,
} from './components/CaptureFields';
import { buildCaptureTypeOptions, findSchema, schemaSummary } from './type-options';

/**
 * Clipboard Capture (Edit). Pre-fills a Quick-Capture-style form from
 * whatever is on the clipboard, then lets the user adjust type / fields
 * before submitting. The auto-routing on the no-view Clipboard Capture
 * command handles the "I trust the default" case; this command handles
 * "let me shape it before it lands".
 */

interface CapturePreferences {
  defaultTier?: 'library' | 'feed';
  defaultCaptureType?: string;
  defaultTags?: string;
  captureLocation?: boolean;
}

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
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.zip': 'application/zip',
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

function bufferToUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
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

function inferDefaultType(snapshot: ClipboardSnapshot, prefDefault?: string): string {
  // File on clipboard always wins — auto-detected file type beats the
  // operator's preference for the bookmark / note / task / event family.
  if (snapshot.file) {
    return 'core.file';
  }
  if (snapshot.text && isUrl(snapshot.text)) return 'core.bookmark';
  return normalizeTypeId(prefDefault);
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
  propertiesJson?: string;
  extraProperties?: string;
}

const FILE_CAPTURE_TYPE = { value: 'core.file', label: 'File' };

function ClipboardCaptureEditCommand() {
  const { pop } = useNavigation();
  const prefs = getPreferenceValues<CapturePreferences>();
  const tier = prefs.defaultTier ?? 'library';

  const { data: snapshot, isLoading: snapLoading } = useCachedPromise(readClipboardSnapshot, [], {
    onError: async (err) => {
      await showFailureToast(err, { title: 'Failed to read clipboard' });
    },
  });
  const { data: typeSchemas, isLoading: typesLoading } = useCachedPromise(
    async () => {
      const client = getClient();
      return client.types.list();
    },
    [],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to load types' });
      },
    },
  );

  const [type, setType] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [titleError, setTitleError] = useState<string | undefined>();
  const [bodyError, setBodyError] = useState<string | undefined>();
  const [propertiesError, setPropertiesError] = useState<string | undefined>();
  const [extraError, setExtraError] = useState<string | undefined>();

  if (snapLoading || typesLoading || !snapshot) {
    return <Form isLoading />;
  }

  // First-render default — once the user picks a type via the dropdown,
  // honour their choice for the rest of the session.
  const activeType = type ?? inferDefaultType(snapshot, prefs.defaultCaptureType);

  async function handleSubmit(values: FormValues) {
    if (!snapshot) return;

    const tags = mergeTags(prefs.defaultTags, values.tags);

    try {
      const client = getClient();
      const location: Partial<CreateItemInput> = prefs.captureLocation
        ? await (async () => {
            const loc = await fetchCaptureLocation();
            return loc ? { capture_latitude: loc.lat, capture_longitude: loc.lon } : {};
          })()
        : {};

      if (activeType === 'core.file') {
        if (!snapshot.file) {
          await showFailureToast('No file on clipboard for the selected type.');
          return;
        }
        const buf = await readFile(snapshot.file);
        const bytes = bufferToUint8Array(buf);
        const mime = snapshot.fileMime ?? 'application/octet-stream';
        const { hash } = await client.blobs.upload(bytes, mime);
        const properties: Record<string, unknown> = {
          blob_ref: hash,
          mime_type: mime,
          title: values.title?.trim() || snapshot.filename || 'file',
        };
        if (values.description?.trim()) properties.description = values.description.trim();
        const extra = parseAdditionalProperties(values.extraProperties);
        if ('error' in extra) {
          setExtraError(extra.error.message);
          return;
        }
        Object.assign(properties, extra.properties);
        await client.items.create({ type: activeType, properties, tags, tier, ...location });
        await showHUD('File captured');
        pop();
        return;
      }

      let properties: Record<string, unknown>;
      if (isCoreCaptureType(activeType)) {
        const validation = validateCoreCapture(activeType, values);
        if (validation) {
          if (validation.field === 'url') setUrlError(validation.message);
          if (validation.field === 'title') setTitleError(validation.message);
          if (validation.field === 'body') setBodyError(validation.message);
          return;
        }
        properties = buildCoreCaptureProperties(activeType, values, {
          html: snapshot.html,
          sourceText: snapshot.text,
        });
        const extra = parseAdditionalProperties(values.extraProperties);
        if ('error' in extra) {
          setExtraError(extra.error.message);
          return;
        }
        Object.assign(properties, extra.properties);
      } else {
        const schema = findSchema(typeSchemas, activeType);
        if (typeSchemas && !schema) {
          setPropertiesError(`Type ${activeType} is not registered on this server`);
          return;
        }
        const parsed = parseCustomPropertiesJson(values.propertiesJson, schema);
        if ('error' in parsed) {
          setPropertiesError(parsed.error.message);
          return;
        }
        properties = parsed.properties;
      }

      await client.items.create({ type: activeType, properties, tags, tier, ...location });
      await showHUD('Item captured');
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to capture' });
    }
  }

  const isFileType = activeType === 'core.file';
  const typeOptions = buildCaptureTypeOptions(typeSchemas, activeType);
  if (!typeOptions.some((option) => option.value === FILE_CAPTURE_TYPE.value)) {
    typeOptions.push(FILE_CAPTURE_TYPE);
  }

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
          setBodyError(undefined);
          setPropertiesError(undefined);
        }}
      >
        {typeOptions.map((t) => (
          <Form.Dropdown.Item
            key={t.value}
            value={t.value}
            title={
              !snapshot.file && t.value === 'core.file'
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
          <AdditionalPropertiesField
            error={extraError}
            onChange={() => setExtraError(undefined)}
          />
        </>
      ) : isCoreCaptureType(activeType) ? (
        <>
          <CaptureFields
            type={activeType}
            defaultTitle={inferDefaultTitle(activeType, snapshot)}
            defaultBody={inferDefaultBody(activeType, snapshot)}
            defaultUrl={inferDefaultUrl(activeType, snapshot)}
            urlError={urlError}
            titleError={titleError}
            bodyError={bodyError}
            onUrlChange={() => setUrlError(undefined)}
            onTitleChange={() => setTitleError(undefined)}
            onBodyChange={() => setBodyError(undefined)}
          />
          <AdditionalPropertiesField
            error={extraError}
            onChange={() => setExtraError(undefined)}
          />
        </>
      ) : (
        <CustomPropertiesFields
          schemaText={schemaSummary(findSchema(typeSchemas, activeType), activeType)}
          propertiesError={propertiesError}
          defaultPropertiesJson={defaultCustomPropertiesJson(snapshot)}
          onPropertiesChange={() => setPropertiesError(undefined)}
        />
      )}

      <Form.Separator />
      <Form.TextField id="tags" title="Tags" placeholder="tag1, tag2 (comma-separated)" />
    </Form>
  );
}

function defaultCustomPropertiesJson(snapshot: ClipboardSnapshot): string {
  if (!snapshot.text || isUrl(snapshot.text)) return '{}';
  try {
    const parsed = JSON.parse(snapshot.text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Plain clipboard text should not make the custom JSON field invalid by default.
  }
  return '{}';
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

export default withMymeAccessToken(ClipboardCaptureEditCommand);
