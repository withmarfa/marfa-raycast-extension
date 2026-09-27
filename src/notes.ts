/**
 * A note is named by its first line as it reads, without its markdown.
 *
 * A note's stored `title` is not its name: Memos WithMarfa never writes one and
 * Marfa Mini treats it as a date stamp, so a list titled by it would disagree
 * with every other app showing the same notes. This follows Memos WithMarfa's
 * rule line for line, so the three apps name a note the same way.
 */

export const UNTITLED = 'Untitled';

export function noteTitle(markdown: string): string {
  for (const line of markdown.split(/\r\n|\r|\n/)) {
    const text = plainText(line.slice(0, 300));
    if (text) return text;
  }
  return UNTITLED;
}

/** What a list row shows under the title: the body after the line that names it. */
export function noteExcerpt(markdown: string, limit = 120): string {
  const lines = markdown.split(/\r\n|\r|\n/);
  const named = lines.findIndex((line) => plainText(line.slice(0, 300)) !== '');
  const rest = lines
    .slice(named + 1)
    .map((line) => plainText(line.slice(0, 300)))
    .filter(Boolean)
    .join(' ');
  return rest.length > limit ? `${rest.slice(0, limit).trimEnd()}…` : rest;
}

function plainText(line: string): string {
  let text = line.trim();
  // Quotes and lists nest, as in `> - [ ] **Call**`; a heading's text is then plain.
  for (
    let inner = withoutContainerMarker(text);
    inner !== null;
    inner = withoutContainerMarker(text)
  ) {
    text = inner;
  }
  if (text.startsWith('```') || text.startsWith('~~~')) return '';
  if (text.startsWith('#')) text = withoutHeadingMarks(text);
  if (text && /^[-*_]+$/.test(text)) return '';
  return withoutInlineMarks(text).trim();
}

function withoutContainerMarker(text: string): string | null {
  const first = text.charAt(0);
  if (!first) return null;
  if (first === '>') return text.slice(1).trim();
  if (first === '-' || first === '*' || first === '+') {
    if (text.charAt(1) !== ' ') return null;
    let inner = text.slice(2).trim();
    for (const marker of ['[ ]', '[x]', '[X]']) {
      if (inner.startsWith(marker)) inner = inner.slice(marker.length).trim();
    }
    return inner;
  }
  const ordered = /^(\d{1,9})[.)] /.exec(text);
  return ordered ? text.slice(ordered[0].length).trim() : null;
}

function withoutHeadingMarks(text: string): string {
  let inner = text.replace(/^#+/, '');
  // A closing run of marks only counts when a space precedes it, as in CommonMark.
  const closing = /#+$/.exec(inner)?.[0].length ?? 0;
  if (closing > 0 && inner.slice(0, -closing).endsWith(' ')) inner = inner.slice(0, -closing);
  return inner.trim();
}

function withoutInlineMarks(text: string): string {
  // Escaped punctuation and code span contents are literal; they sit out the
  // stripping as private-use characters.
  let plain = text.replace(/\\([!-/:-@[-`{-~])/g, (_, char: string) => shielded(char));
  plain = plain.replace(/`([^`]+)`/g, (_, code: string) => shielded(code));
  plain = plain.replace(/(!?)\[([^[\]]*)\]\(([^()\s]*)\)/g, (_, bang: string, words: string) =>
    // An image's width rides in its alt text; the title is the words alone.
    bang === '!' ? words.replace(/\|\d{1,5}$/, '') : words,
  );
  plain = plain.replace(/<(https?:\/\/[^<>\s]+)>/g, '$1');
  plain = plain.replace(/(\*\*|__|~~)([^*_~]+)\1/g, '$2');
  plain = plain.replace(/\*([^*\s][^*]*)\*/g, '$1');
  plain = plain.replace(/\b_([^_\s][^_]*)_\b/g, '$1');
  // A backslash ending the line is a hard break.
  if (plain.endsWith('\\')) plain = plain.slice(0, -1);
  // The editor writes a character that would otherwise change the parse as a
  // numeric reference, the only kind the store holds.
  plain = plain.replace(/&#(x[0-9A-Fa-f]{1,6}|[0-9]{1,7});/g, (whole, ref: string) => {
    const value = ref.startsWith('x') ? parseInt(ref.slice(1), 16) : parseInt(ref, 10);
    return value <= 0x10ffff ? String.fromCodePoint(value) : whole;
  });
  return unshielded(plain);
}

function shielded(text: string): string {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x21 && code <= 0x7e ? String.fromCodePoint(code + 0xe000) : char;
  }).join('');
}

function unshielded(text: string): string {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0xe021 && code <= 0xe07e ? String.fromCodePoint(code - 0xe000) : char;
  }).join('');
}
