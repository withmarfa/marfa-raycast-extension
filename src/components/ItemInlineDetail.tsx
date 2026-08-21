import { Color, List } from '@raycast/api';
import type { Item, Metadata } from '@withmarfa/sdk';
import { STATE_CONFIG } from '../constants';
import { formatDate, formatTime, formatRelativeTime, toTitleCase } from '../helpers';
import type { TypeRegistry } from '../type-display';
import { splitItemProperties, type ScalarSidebarEntry } from '../item-metadata';

/**
 * Inline detail panel rendered on the right-hand side of `<List>` when the
 * user toggles "Show Details" (⌘D). Mirrors the layout of the full Detail
 * view's metadata sidebar — same What → When → Custom → Provenance → Identity
 * ordering — but skips edges (no extra fetch per selection) and renders body
 * text inline as markdown rather than pushing into a separate view.
 */

interface ItemInlineDetailProps {
  item: Item;
  metadata?: Metadata;
  snippet?: string;
  registry: TypeRegistry;
}

const INLINE_BODY_TRUNCATE = 600;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

export function ItemInlineDetail({ item, metadata, snippet, registry }: ItemInlineDetailProps) {
  const typeLabel = registry.label(item.type);
  const typeColor = registry.appearance(item.type).color;
  const stateConfig = STATE_CONFIG[item.state];
  const bodyField = registry.bodyField(item.type);

  const p = item.properties;
  const lines: string[] = [`# ${registry.titleOf(item)}`, ''];
  if (snippet) lines.push(snippet, '');
  // The registry's own body field first — a captured email keeps its text in
  // `text_body`, a podcast episode in `content_encoded`.
  const hintedBody = bodyField ? p[bodyField] : undefined;
  if (typeof hintedBody === 'string' && hintedBody)
    lines.push(truncate(hintedBody, INLINE_BODY_TRUNCATE), '');
  if (typeof p.body === 'string' && p.body) lines.push(truncate(p.body, INLINE_BODY_TRUNCATE), '');
  if (typeof p.description === 'string' && p.description)
    lines.push(truncate(p.description, INLINE_BODY_TRUNCATE), '');
  if (typeof p.text === 'string' && p.text) lines.push(truncate(p.text, INLINE_BODY_TRUNCATE), '');
  if (typeof p.notes === 'string' && p.notes)
    lines.push(truncate(p.notes, INLINE_BODY_TRUNCATE), '');
  if (typeof p.url === 'string' && p.url) lines.push(`[${p.url}](${p.url})`, '');

  const { scalar: sidebarEntries } = splitItemProperties(item, [
    registry.titleField(item.type),
    bodyField,
  ]);

  const extensionNamespaces = metadata ? Object.keys(metadata.extensions) : [];

  return (
    <List.Item.Detail
      markdown={lines.join('\n')}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.TagList title="Type">
            <List.Item.Detail.Metadata.TagList.Item text={typeLabel} color={typeColor} />
          </List.Item.Detail.Metadata.TagList>
          <List.Item.Detail.Metadata.TagList title="State">
            <List.Item.Detail.Metadata.TagList.Item
              text={stateConfig?.label ?? item.state}
              color={stateConfig?.color ?? Color.PrimaryText}
            />
          </List.Item.Detail.Metadata.TagList>
          <List.Item.Detail.Metadata.TagList title="Tier">
            <List.Item.Detail.Metadata.TagList.Item
              text={item.tier === 'library' ? 'Library' : item.tier === 'feed' ? 'Feed' : '—'}
              color={item.tier === 'library' ? Color.Green : Color.SecondaryText}
            />
          </List.Item.Detail.Metadata.TagList>
          {metadata && metadata.tags.length > 0 && (
            <List.Item.Detail.Metadata.TagList title="Tags">
              {metadata.tags.map((tag) => (
                <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          )}

          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Timestamp"
            text={`${formatDate(item.timestamp)} ${formatTime(item.timestamp)}`}
          />
          <List.Item.Detail.Metadata.Label
            title="Updated"
            text={formatRelativeTime(item.updated_at)}
          />
          <List.Item.Detail.Metadata.Label
            title="Created"
            text={`${formatDate(item.created_at)} ${formatTime(item.created_at)}`}
          />

          {sidebarEntries.length > 0 && (
            <>
              <List.Item.Detail.Metadata.Separator />
              {sidebarEntries.map((entry) => renderSidebarEntry(entry))}
            </>
          )}

          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Source" text={item.source} />
          {item.device && <List.Item.Detail.Metadata.Label title="Device" text={item.device} />}
          {item.source_id && (
            <List.Item.Detail.Metadata.Label title="Source ID" text={item.source_id} />
          )}
          {item.capture_latitude !== undefined && item.capture_longitude !== undefined && (
            <List.Item.Detail.Metadata.Label
              title="Location"
              text={`${item.capture_latitude.toFixed(4)}, ${item.capture_longitude.toFixed(4)}`}
            />
          )}

          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="ID" text={item.id} />
          <List.Item.Detail.Metadata.Label title="Revision" text={String(item.version)} />

          {extensionNamespaces.length > 0 && (
            <>
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.TagList title="Extensions">
                {extensionNamespaces.map((ns) => (
                  <List.Item.Detail.Metadata.TagList.Item
                    key={ns}
                    text={ns}
                    color={Color.SecondaryText}
                  />
                ))}
              </List.Item.Detail.Metadata.TagList>
            </>
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function renderSidebarEntry(entry: ScalarSidebarEntry) {
  const title = toTitleCase(entry.key);
  switch (entry.kind) {
    case 'datetime':
      return (
        <List.Item.Detail.Metadata.Label
          key={entry.key}
          title={title}
          text={`${formatDate(entry.value)} ${formatTime(entry.value)}`}
        />
      );
    case 'url':
      return (
        <List.Item.Detail.Metadata.Link
          key={entry.key}
          title={title}
          target={entry.value}
          text={entry.value}
        />
      );
    case 'boolean':
      return (
        <List.Item.Detail.Metadata.TagList key={entry.key} title={title}>
          <List.Item.Detail.Metadata.TagList.Item
            text={entry.value ? 'Yes' : 'No'}
            color={entry.value ? Color.Green : Color.SecondaryText}
          />
        </List.Item.Detail.Metadata.TagList>
      );
    case 'number':
      return (
        <List.Item.Detail.Metadata.Label key={entry.key} title={title} text={String(entry.value)} />
      );
    case 'string':
    case 'array':
      return <List.Item.Detail.Metadata.Label key={entry.key} title={title} text={entry.value} />;
  }
}
