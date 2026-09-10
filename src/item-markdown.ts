import type { Item } from '@withmarfa/sdk';

/**
 * The markdown half of an item's detail, composed once for both surfaces.
 *
 * `ItemDetailView` (the pushed Detail) and `ItemInlineDetail` (the List panel)
 * show the same item and differ only in what sits around the body: an image
 * above it on one, a search snippet on the other, and a length bound on the
 * panel. Composing it in each of them is how the two came to disagree, and a
 * rule about which property is the body is exactly the kind that has to hold in
 * both places or in neither.
 */

/**
 * Property names carrying body text, tried in this order.
 *
 * A fallback for a type whose registration names no `body_field`, and a running
 * order for one that carries several of them: `core.note` declares both `body`
 * and `notes`, and a note with personal annotations means both to show.
 *
 * The sidebar walker drops every one of these (`BODY_PROPERTY_KEYS`), so a name
 * present here and not rendered here is a property that appears nowhere.
 */
const CONVENTIONAL_BODY_FIELDS = ['body', 'description', 'text', 'notes'];

export interface ItemMarkdownOptions {
  item: Item;
  /** Already resolved through the registry, rendered as the heading. */
  title: string;
  /** `display_hints.body_field`, when the instance's registration names one. */
  bodyField?: string;
  /** Rendered above the heading. The full Detail resolves one; the panel does not. */
  imageUrl?: string | null;
  /** A server-supplied search snippet, above the body. */
  snippet?: string;
  /** Bound each body block to this many characters. Unbounded when absent. */
  truncateAt?: number;
}

/**
 * The body-carrying properties to render, in order, each named once.
 *
 * The registry's field leads, because it is the instance's own answer: a
 * captured email keeps its text in `text_body`, a podcast episode in
 * `content_encoded`. **The conventional names then follow with that field
 * removed**, which is the whole of it. Appending the conventional list whole
 * reads as harmless while the registry names something outside it and prints
 * the property twice the moment it names one inside it, which `core.note` does:
 * its `body_field` is `body`, so every note rendered its body, then rendered it
 * again.
 */
export function bodyFieldsToRender(bodyField: string | undefined): string[] {
  const conventional = CONVENTIONAL_BODY_FIELDS.filter((field) => field !== bodyField);
  return bodyField ? [bodyField, ...conventional] : conventional;
}

function truncate(text: string, max: number | undefined): string {
  if (max === undefined || text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

function readableString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Compose the detail markdown for one item.
 *
 * A `url` property renders as a link rather than as text, and is skipped when
 * the registry named it as the body, since it would then already be above.
 */
export function buildItemMarkdown({
  item,
  title,
  bodyField,
  imageUrl,
  snippet,
  truncateAt,
}: ItemMarkdownOptions): string {
  const lines: string[] = [];
  if (imageUrl) lines.push(`![${title}](${imageUrl})`, '');
  lines.push(`# ${title}`, '');
  if (snippet) lines.push(snippet, '');

  const properties = item.properties;
  for (const field of bodyFieldsToRender(bodyField)) {
    const value = readableString(properties[field]);
    if (value) lines.push(truncate(value, truncateAt), '');
  }

  const url = readableString(properties.url);
  if (url && bodyField !== 'url') lines.push(`[${url}](${url})`, '');

  return lines.join('\n');
}
