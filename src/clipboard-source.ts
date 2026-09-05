import { Clipboard } from '@raycast/api';
import { basename, extname } from 'node:path';
import type { PlannedField } from './capture-plan';

/**
 * What is on the clipboard, and where each part of it belongs.
 *
 * One copy. All of this existed twice, verbatim, in the two clipboard commands,
 * which is how the note-with-HTML rule ended up implemented once in a shared
 * helper and once inline beside it.
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

export function mimeForFile(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A deliberate copy. A Buffer can be a window onto a larger allocation, and
 *  handing the underlying one to an upload sends bytes nobody put there. */
export function bufferToUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
}

export interface ClipboardSnapshot {
  text: string;
  html: string;
  file: string | null;
  filename: string | null;
  fileMime: string | null;
}

export async function readClipboardSnapshot(): Promise<ClipboardSnapshot> {
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

/**
 * Which field on any type the clipboard's contents belong in.
 *
 * **Keyed on what a field is, never on a type identifier.** The four helpers
 * this replaces each named a type and a field: a URL went to `core.bookmark`'s
 * `url` and `title`, text to `core.note`'s `body`. A type nobody here has seen
 * got nothing, which is most of a registry once integrations are syncing.
 *
 * Asking the schema instead means a third party's type whose `title_field` is
 * `headline` is seeded exactly as well as a bookmark, with no entry anywhere
 * naming it.
 */
export function clipboardSeed(
  snapshot: ClipboardSnapshot,
  field: PlannedField,
  hints: { titleField?: string; bodyField?: string },
): string | undefined {
  const looksLikeUrl = Boolean(snapshot.text) && isUrl(snapshot.text);

  if (field.rawType === 'url' && looksLikeUrl) return snapshot.text;
  if (field.name === hints.titleField) {
    if (looksLikeUrl) return snapshot.text;
    if (snapshot.filename) return snapshot.filename;
    return undefined;
  }
  if (field.name === hints.bodyField && snapshot.text && !looksLikeUrl) return snapshot.text;
  return undefined;
}

/**
 * Formatted text carried alongside, when it says more than the plain text does.
 *
 * Not a per-type rule despite looking like one. It is clipboard knowledge: the
 * clipboard has three slots and something has to say where each goes. No schema
 * declares `html`, so no control is ever generated for it and it rides as a
 * carried property.
 */
export function carriedProperties(snapshot: ClipboardSnapshot): Record<string, unknown> {
  return snapshot.html && snapshot.html !== snapshot.text ? { html: snapshot.html } : {};
}
