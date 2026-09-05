/// <reference types="node" />
import { Clipboard, getPreferenceValues, showHUD, showToast, Toast } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { CreateItemInput } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { fetchCaptureLocation, parseTags } from './capture-utils';
import { bufferToUint8Array, isUrl, mimeForFile } from './clipboard-source';

interface CapturePreferences {
  defaultTier?: 'library' | 'feed';
  defaultTags?: string;
  captureLocation?: boolean;
}

async function locationFor(prefs: CapturePreferences): Promise<Partial<CreateItemInput>> {
  if (!prefs.captureLocation) return {};
  const loc = await fetchCaptureLocation();
  if (!loc) return {};
  return { capture_latitude: loc.lat, capture_longitude: loc.lon };
}

async function captureClipboard(): Promise<void> {
  const prefs = getPreferenceValues<CapturePreferences>();
  const tier = prefs.defaultTier ?? 'library';
  const defaultTags = parseTags(prefs.defaultTags);

  let content: Clipboard.ReadContent;
  try {
    content = await Clipboard.read();
  } catch (err) {
    await showFailureToast(err, { title: 'Failed to read clipboard' });
    return;
  }

  const text = content.text?.trim() ?? '';
  const file = content.file;
  const html = content.html?.trim() ?? '';

  if (!text && !file) {
    await showToast({ style: Toast.Style.Failure, title: 'Nothing on clipboard' });
    return;
  }

  const client = getClient();

  if (file) {
    const path = file.startsWith('file://') ? decodeURIComponent(file.slice(7)) : file;
    const mime = mimeForFile(path);
    const filename = basename(path);

    let bytes: Uint8Array;
    try {
      const buf = await readFile(path);
      bytes = bufferToUint8Array(buf);
    } catch (err) {
      await showFailureToast(err, { title: 'Failed to read file' });
      return;
    }

    try {
      await showToast({ style: Toast.Style.Animated, title: 'Uploading…', message: filename });
      const { hash } = await client.blobs.upload(bytes, mime);
      const location = await locationFor(prefs);
      await client.items.create({
        type: 'core.file',
        properties: { blob_ref: hash, mime_type: mime, title: filename },
        tags: defaultTags,
        tier,
        ...location,
      });
      await showHUD('File captured');
    } catch (err) {
      await showFailureToast(err, { title: 'Failed to capture file' });
    }
    return;
  }

  if (text && isUrl(text)) {
    try {
      const location = await locationFor(prefs);
      await client.items.create({
        type: 'core.bookmark',
        properties: { url: text, title: text },
        tags: defaultTags,
        tier,
        ...location,
      });
      await showHUD('Bookmark captured');
    } catch (err) {
      await showFailureToast(err, { title: 'Failed to capture bookmark' });
    }
    return;
  }

  // Plain or HTML-rich text → note. Preserve HTML on a property so the
  // detail view can render the formatted source if it wants to.
  const properties: Record<string, unknown> = { body: text };
  if (html && html !== text) properties.html = html;
  try {
    const location = await locationFor(prefs);
    await client.items.create({
      type: 'core.note',
      properties,
      tags: defaultTags,
      tier,
      ...location,
    });
    await showHUD('Note captured');
  } catch (err) {
    await showFailureToast(err, { title: 'Failed to capture note' });
  }
}

/**
 * Outer error boundary. The HOC handles auth; this wrapper catches anything
 * that escapes the capture flow so an unhandled async rejection can never
 * take down the extension host.
 */
async function ClipboardCaptureCommand(): Promise<void> {
  try {
    await captureClipboard();
  } catch (err) {
    await showFailureToast(err, { title: 'Capture failed' });
  }
}

export default withMarfaAccessToken(ClipboardCaptureCommand);
