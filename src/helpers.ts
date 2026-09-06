import type { Item } from '@withmarfa/sdk';

/**
 * Conventional property names, tried when the type registry has no
 * `display_hints` for a type or the item does not carry the field it names.
 *
 * These are a fallback and nothing more. `buildTypeRegistry` asks the
 * registry first, because the conventional names are wrong for plenty of
 * real types. A captured email titles by `subject`, and a type an instance
 * defined may use any field at all. Returns `undefined` rather than a raw
 * identifier so the caller can fall through to the type's own label.
 */
export function fallbackItemTitle(item: Item): string | undefined {
  const p = item.properties;
  if (typeof p.title === 'string' && p.title) return p.title;
  if (typeof p.name === 'string' && p.name) return p.name;
  if (typeof p.url === 'string' && p.url) return p.url;
  if (typeof p.body === 'string' && p.body) return p.body.slice(0, 80);
  return undefined;
}

/**
 * The subtitle counterpart, and it does not agree with the title resolver about
 * an empty string. This one tests `title` for its type, so a present-but-blank
 * title admits the body here, while `fallbackItemTitle` skips a blank title and
 * falls through to the body as well. Both then return it, and the row renders
 * the same text twice. Known, pinned by a test, and left alone because making
 * them agree changes what a list looks like rather than correcting an error.
 */
export function fallbackItemSubtitle(item: Item): string | undefined {
  const p = item.properties;
  if (typeof p.description === 'string' && p.description) return p.description.slice(0, 100);
  if (typeof p.body === 'string' && typeof p.title === 'string') return p.body.slice(0, 100);
  if (typeof p.url === 'string' && typeof p.title === 'string') return p.url;
  return undefined;
}

/**
 * A date as a person reading this machine would write it.
 *
 * Every branch renders through the runtime's own locale rather than a fixed
 * one. A launcher is read by whoever is at the keyboard, and a hardcoded
 * `en-US` puts a month before a day for a reader whose system says otherwise,
 * which is not merely unfamiliar: `05/09` is a different day in each reading.
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Rounded, not floored. Both operands are local midnights, and the interval
  // between two consecutive local midnights is 23 or 25 hours across a
  // daylight-saving change rather than 24. Flooring 23 hours gives zero, so on
  // the day after a spring forward yesterday's items said "Today", and a day
  // later both of the preceding days said "Yesterday" and Browse merged two
  // days into one section. Rounding is exact in both directions because the
  // quantity being measured is always a whole number of calendar days.
  const diffDays = Math.round((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));

  // A weekday name only ever means the one just gone. The window is bounded at
  // both ends because a future date subtracts to a negative, and an unbounded
  // comparison put an event a year out under the same heading as last week's
  // notes: an item dated next September rendered as "Sunday". Anything ahead of
  // today falls through to a real date, which is unambiguous in a way a
  // weekday cannot be once both directions are in the list.
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(dateStr);
}

export function getItemUrl(item: Item): string | undefined {
  const url = item.properties.url;
  return typeof url === 'string' && url ? url : undefined;
}

export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Initialisms that read as shouting when lowercased, which the sidebar did to
 * every one of them: `playlist_id` rendered as "Playlist id", `html_link` as
 * "Html link".
 *
 * A hand-written set, and defensibly so. This is a fact about written English
 * rather than about any Marfa instance, so it cannot drift the way a copy of
 * the type registry would, and a word missing from it degrades to exactly the
 * old behavior rather than to something wrong.
 */
const INITIALISMS = new Set([
  'api',
  'css',
  'guid',
  'html',
  'http',
  'https',
  'id',
  'isbn',
  'isrc',
  'iso8601',
  'json',
  'md5',
  'mime',
  'oauth',
  'rss',
  'sha256',
  'sku',
  'sql',
  'uri',
  'url',
  'utc',
  'uuid',
  'xml',
]);

export function toTitleCase(key: string): string {
  const words = key.split('_').filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (INITIALISMS.has(lower)) return lower.toUpperCase();
      // Only the first word is capitalized. The rest stay lowercase, which is
      // how a label reads rather than a heading.
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

export type ImageSource =
  { kind: 'url'; url: string } | { kind: 'blob'; blobRef: string; mimeType: string };

const COVER_URL_KEYS = ['cover_url', 'image_url', 'thumbnail_url', 'poster_url', 'artwork_url'];

/** Alt text is the caller's job: it holds the type registry and so can
 *  resolve a real title, which this module cannot. */
export function getImageSource(item: Item): ImageSource | null {
  const p = item.properties;
  for (const key of COVER_URL_KEYS) {
    const candidate = p[key];
    if (
      typeof candidate === 'string' &&
      (candidate.startsWith('http://') || candidate.startsWith('https://'))
    ) {
      return { kind: 'url', url: candidate };
    }
  }
  if (item.type === 'core.file.image' && typeof p.blob_ref === 'string' && p.blob_ref) {
    const mimeType = typeof p.mime_type === 'string' && p.mime_type ? p.mime_type : 'image/jpeg';
    return { kind: 'blob', blobRef: p.blob_ref, mimeType };
  }
  return null;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64');
}
