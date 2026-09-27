import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import type { PlannedField } from './capture-plan';
import { BOOKMARK_TYPE, FILE_TYPE, IMAGE_TYPE, NOTE_TYPE } from './display';

/**
 * What is on the clipboard, and where each part of it belongs. Pure: reading
 * the clipboard itself is the command's job.
 */

export interface ClipboardSnapshot {
  text: string;
  html: string;
  /** A copied file's path, as the clipboard offers it: a path or a `file://` URL. */
  file: string | null;
}

export function isWebUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Elements that carry formatting a note can keep. Copied text with none of
 * them, such as code from an editor whose HTML is styled spans, reads better
 * as its plain text than as markdown with every `*` and `_` escaped.
 */
const FORMATTING = /<(h[1-6]|strong|b|em|i|a\s[^>]*href|ul|ol|blockquote|pre|table|hr)\b/i;

/**
 * The part of a DOM node the rules read. Turndown parses with its own DOM in
 * Node, and this project compiles without the browser's DOM types.
 */
interface Element {
  nodeName: string;
  getAttribute(name: string): string | null;
  parentNode: Element | null;
  nextSibling: unknown;
  children: ArrayLike<unknown>;
}
const element = (node: unknown) => node as Element;

let turndown: TurndownService | undefined;

function converter(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
  });
  turndown.remove(['head', 'meta', 'style', 'script', 'title', 'noscript']);
  // Google Docs wraps a whole copy in a `<b>` it styles back to normal weight.
  turndown.addRule('unboldened', {
    filter: (node) =>
      element(node).nodeName === 'B' &&
      /font-weight:\s*normal/i.test(element(node).getAttribute('style') ?? ''),
    replacement: (content) => content,
  });
  // An inlined image is its bytes as base64, which does not belong in a note's text.
  turndown.addRule('inlineImage', {
    filter: (node) =>
      element(node).nodeName === 'IMG' &&
      (element(node).getAttribute('src') ?? '').startsWith('data:'),
    replacement: () => '',
  });
  // One space after a list marker, as the other apps write lists, rather than turndown's three.
  turndown.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = element(node).parentNode;
      let prefix = `${options.bulletListMarker ?? '-'} `;
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? '1');
        const index = Array.prototype.indexOf.call(parent.children, node) as number;
        prefix = `${String((Number.isFinite(start) ? start : 1) + index)}. `;
      }
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/gm, `\n${' '.repeat(prefix.length)}`);
      return prefix + body + (element(node).nextSibling && !body.endsWith('\n') ? '\n' : '');
    },
  });
  return turndown;
}

/** Copied HTML as markdown, or nothing when it carries no formatting to keep. */
export function htmlToMarkdown(html: string): string | undefined {
  if (!FORMATTING.test(html)) return undefined;
  const markdown = converter()
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return markdown || undefined;
}

/** The text a body takes from the clipboard: its HTML as markdown where that says more. */
export function clipboardBody(snapshot: Pick<ClipboardSnapshot, 'text' | 'html'>): string {
  const text = snapshot.text.trim();
  if (!snapshot.html.trim()) return text;
  return htmlToMarkdown(snapshot.html) ?? text;
}

/** What a clipboard's text becomes: a lone web address a bookmark, anything else a note. */
export function captureFromText(
  snapshot: Pick<ClipboardSnapshot, 'text' | 'html'>,
): { type: string; properties: Record<string, unknown>; noun: string } | null {
  const text = snapshot.text.trim();
  if (isWebUrl(text)) return { type: BOOKMARK_TYPE, properties: { url: text }, noun: 'Bookmark' };
  const body = clipboardBody(snapshot);
  if (!body) return null;
  return { type: NOTE_TYPE, properties: { body }, noun: 'Note' };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  zip: 'application/zip',
};

/** A copied path or `file://` URL as a path. */
export function filePath(pathOrUrl: string): string {
  return pathOrUrl.startsWith('file://') ? fileURLToPath(pathOrUrl) : pathOrUrl;
}

export function mimeForFile(path: string): string {
  const name = path.split('/').pop() ?? path;
  const extension = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * What a copied file becomes: an image as an image, anything else as a file,
 * named by its file name.
 */
export function captureFromFile(pathOrUrl: string): {
  path: string;
  type: string;
  mimeType: string;
  title: string;
} {
  const path = filePath(pathOrUrl);
  const title = path.split('/').pop() || path;
  const mimeType = mimeForFile(path);
  return { path, type: mimeType.startsWith('image/') ? IMAGE_TYPE : FILE_TYPE, mimeType, title };
}

/** The type a clipboard suggests: a file beats the preference, and a lone link is a bookmark. */
export function clipboardType(snapshot: ClipboardSnapshot, preferred: string): string {
  if (snapshot.file) return captureFromFile(snapshot.file).type;
  if (isWebUrl(snapshot.text.trim())) return BOOKMARK_TYPE;
  return preferred;
}

/**
 * Which field on any type the clipboard belongs in, keyed on what the field
 * is rather than on a type: a link to a URL field, or to the title of a type
 * with none, a file's name to the title, and the text to the body.
 */
export function clipboardSeed(
  snapshot: ClipboardSnapshot,
  field: PlannedField,
  hints: { titleField?: string; bodyField?: string; hasUrlField: boolean },
): string | undefined {
  const text = snapshot.text.trim();
  const link = isWebUrl(text);
  if (field.rawType === 'url' && link) return text;
  if (field.name === hints.titleField) {
    if (link) return hints.hasUrlField ? undefined : text;
    if (snapshot.file) return captureFromFile(snapshot.file).title;
    return undefined;
  }
  if (field.name === hints.bodyField && !link && !snapshot.file) {
    return clipboardBody(snapshot) || undefined;
  }
  return undefined;
}
