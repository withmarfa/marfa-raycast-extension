/// <reference types="node" />
import { Clipboard, getPreferenceValues, showHUD, showToast, Toast } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { withMymeAccessToken } from './auth/with-myme-access-token';
import { getClient } from './client';
import { parseTags } from './capture-utils';

interface CapturePreferences {
  defaultTier?: 'library' | 'feed';
  defaultTags?: string;
}

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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

/**
 * Convert a Node Buffer to a fresh Uint8Array with no shared offset / pool
 * underlying. Avoids the byteOffset-mismatch crash class when handing a
 * Buffer to consumers that expect `new Uint8Array(input)` to give the full
 * payload. `slice()` allocates a clean range.
 */
function bufferToUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
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

      await client.items.create({
        type: 'core.file',
        properties: { blob_ref: hash, mime_type: mime, title: filename },
        tags: defaultTags,
        tier,
      });
      await showHUD('File captured');
    } catch (err) {
      await showFailureToast(err, { title: 'Failed to capture file' });
    }
    return;
  }

  if (text && isUrl(text)) {
    try {
      await client.items.create({
        type: 'core.bookmark',
        properties: { url: text, title: text },
        tags: defaultTags,
        tier,
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
    await client.items.create({
      type: 'core.note',
      properties,
      tags: defaultTags,
      tier,
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

export default withMymeAccessToken(ClipboardCaptureCommand);
