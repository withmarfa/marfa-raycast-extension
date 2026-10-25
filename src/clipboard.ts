import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import type { PlannedField } from './capture-plan';
import { BOOKMARK_TYPE, FILE_TYPE, IMAGE_TYPE } from './display';

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

/**
 * What a selection starts a capture with: its text alone, so it makes a note
 * or a bookmark even while a file sits on the clipboard. Null when nothing is
 * selected or the selection is blank.
 */
export function selectionSnapshot(selection: string | undefined): ClipboardSnapshot | null {
  if (!selection?.trim()) return null;
  return { text: selection, html: '', file: null };
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
  textContent: string | null;
  getAttribute(name: string): string | null;
  parentNode: Element | null;
  nextSibling: unknown;
  children: ArrayLike<Element>;
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
  // Code is fenced as its text, whether or not a `<code>` sits inside the
  // `<pre>`: highlighters copy as `<pre>` of colored spans, and turndown fences
  // only `pre > code`, escaping the rest.
  turndown.addRule('preformatted', {
    filter: (node) => element(node).nodeName === 'PRE',
    replacement: (_content, node) => {
      const code = (element(node).textContent ?? '').replace(/\n$/, '');
      const fence = code.includes('```') ? '````' : '```';
      return `\n\n${fence}\n${code}\n${fence}\n\n`;
    },
  });
  // A table as a markdown table, its first row the header, each cell's text on one line.
  turndown.addRule('table', {
    filter: (node) => element(node).nodeName === 'TABLE',
    replacement: (_content, node) => {
      const rows = tableRows(element(node));
      if (rows.length === 0) return '';
      const width = Math.max(...rows.map((row) => row.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
      const [head, ...body] = rows;
      return `\n\n${[line(head), line(Array(width).fill('---')), ...body.map(line)].join('\n')}\n\n`;
    },
  });
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

function tableRows(table: Element): string[][] {
  const rows: string[][] = [];
  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.nodeName === 'TR') {
        rows.push(
          Array.from(child.children)
            .filter((cell) => cell.nodeName === 'TD' || cell.nodeName === 'TH')
            .map((cell) =>
              (cell.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|'),
            ),
        );
      } else {
        visit(child);
      }
    }
  };
  visit(table);
  return rows.filter((row) => row.length > 0);
}

/** The `<b>` Google Docs wraps a whole copy in, which formats nothing. */
const UNBOLDENED = /<b\b[^>]*font-weight:\s*normal[^>]*>/gi;

/** Copied HTML as markdown, or nothing when it carries no formatting to keep. */
export function htmlToMarkdown(html: string): string | undefined {
  if (!FORMATTING.test(html.replace(UNBOLDENED, ''))) return undefined;
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
 * is rather than on a type: a link to the type's one URL field (a cover or a
 * source is not the page itself), or to the title of a type with none, a
 * file's name to the title, and the text to the body.
 */
export function clipboardSeed(
  snapshot: ClipboardSnapshot,
  field: PlannedField,
  hints: { titleField?: string; bodyField?: string; urlField?: string },
): string | undefined {
  const text = snapshot.text.trim();
  const link = isWebUrl(text);
  if (link && field.name === hints.urlField) return text;
  if (field.name === hints.titleField) {
    if (link) return hints.urlField ? undefined : text;
    if (snapshot.file) return captureFromFile(snapshot.file).title;
    return undefined;
  }
  if (field.name === hints.bodyField && !link && !snapshot.file) {
    return clipboardBody(snapshot) || undefined;
  }
  return undefined;
}
