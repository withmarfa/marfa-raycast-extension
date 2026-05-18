import { Clipboard, LaunchType, launchCommand, showHUD, showToast, Toast } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { getClient, MymeAuthMissingError } from './client';

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

export default async function ClipboardCaptureCommand() {
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
    await showFailureToast('Nothing on clipboard');
    return;
  }

  // Resolve the client up front so the user gets a clear sign-in prompt
  // before we try to upload anything.
  let client;
  try {
    client = await getClient();
  } catch (err) {
    if (err instanceof MymeAuthMissingError) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Sign in to Myme',
        message: 'Run the Sign in to Myme command first.',
        primaryAction: {
          title: 'Sign In',
          onAction: () => {
            void launchCommand({ name: 'login', type: LaunchType.UserInitiated });
          },
        },
      });
      return;
    }
    await showFailureToast(err, { title: 'Failed to capture' });
    return;
  }

  try {
    if (file) {
      // file paths come through as `file://...` or absolute paths depending
      // on the source app. URL-decode where applicable.
      const path = file.startsWith('file://') ? decodeURIComponent(file.slice(7)) : file;
      const mime = mimeForFile(path);
      const filename = basename(path);
      const bytes = await readFile(path);

      await showToast({ style: Toast.Style.Animated, title: 'Uploading…', message: filename });
      const { hash } = await client.blobs.upload(bytes, mime);

      const isImage = mime.startsWith('image/');
      const type = isImage ? 'core.file.image' : 'core.file';
      await client.items.create({
        type,
        properties: { blob_ref: hash, mime_type: mime, filename },
        tier: 'library',
      });
      await showHUD(isImage ? 'Image captured' : 'File captured');
      return;
    }

    if (text && isUrl(text)) {
      await client.items.create({
        type: 'core.bookmark',
        properties: { url: text, title: text },
        tier: 'library',
      });
      await showHUD('Bookmark captured');
      return;
    }

    // Plain or HTML-rich text → note. Preserve HTML on a property so the
    // detail view can render the formatted source if it wants to.
    const properties: Record<string, unknown> = { body: text };
    if (html && html !== text) properties.html = html;
    await client.items.create({
      type: 'core.note',
      properties,
      tier: 'library',
    });
    await showHUD('Note captured');
  } catch (error) {
    await showFailureToast(error, { title: 'Failed to capture' });
  }
}
