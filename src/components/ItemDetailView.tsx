import { Action, ActionPanel, Color, Detail, Icon } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { getClient } from '../client';
import { TYPE_CONFIG, STATE_CONFIG } from '../constants';
import {
  getItemTitle,
  getItemUrl,
  formatDate,
  formatTime,
  formatRelativeTime,
  toTitleCase,
  getImageSource,
  arrayBufferToBase64,
} from '../helpers';
import { ItemActionSections } from './ItemActions';

const BODY_PROPERTY_KEYS = new Set([
  'title',
  'name',
  'body',
  'description',
  'url',
  'text',
  'notes',
]);

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;

type ScalarSidebarEntry =
  | { kind: 'datetime'; key: string; value: string }
  | { kind: 'url'; key: string; value: string }
  | { kind: 'boolean'; key: string; value: boolean }
  | { kind: 'number'; key: string; value: number }
  | { kind: 'string'; key: string; value: string }
  | { kind: 'array'; key: string; value: string };

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function classifyProperty(
  key: string,
  value: unknown,
): ScalarSidebarEntry | { kind: 'complex'; key: string; value: unknown } | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value === '') return null;
    if (ISO_DATETIME_RE.test(value)) return { kind: 'datetime', key, value };
    if (value.startsWith('http://') || value.startsWith('https://'))
      return { kind: 'url', key, value };
    return { kind: 'string', key, value };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', key, value };
  if (typeof value === 'number') return { kind: 'number', key, value };
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every(isPrimitive)) {
      return { kind: 'array', key, value: value.map((v) => String(v)).join(', ') };
    }
    return { kind: 'complex', key, value };
  }
  if (typeof value === 'object') {
    return { kind: 'complex', key, value };
  }
  return null;
}

interface Edge {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ItemDetailViewProps {
  itemId: string;
  onRefresh: () => void;
}

export function ItemDetailView({ itemId, onRefresh }: ItemDetailViewProps) {
  const { data, isLoading, revalidate } = useCachedPromise(
    async (id: string) => {
      const client = await getClient();
      const [item, metadata, edgesResponse] = await Promise.all([
        client.items.get(id),
        client.metadata.get(id),
        client.items.edges(id, { limit: 100 }),
      ]);
      const source = getImageSource(item);
      let imageMarkdownUrl: string | null = null;
      let imageAlt = '';
      if (source?.kind === 'url') {
        imageMarkdownUrl = source.url;
        imageAlt = source.alt;
      } else if (source?.kind === 'blob') {
        try {
          const bytes = await client.blobs.download(source.blobRef);
          imageMarkdownUrl = `data:${source.mimeType};base64,${arrayBufferToBase64(bytes)}`;
          imageAlt = source.alt;
        } catch {
          imageMarkdownUrl = null;
        }
      }
      return { item, metadata, edges: edgesResponse.data, imageMarkdownUrl, imageAlt };
    },
    [itemId],
  );

  if (!data) {
    return <Detail isLoading={isLoading} />;
  }

  const { item, metadata, edges, imageMarkdownUrl, imageAlt } = data;
  const url = getItemUrl(item);
  const typeConfig = TYPE_CONFIG[item.type] ?? {
    label: item.type,
    icon: undefined,
    color: Color.PrimaryText,
  };
  const stateConfig = STATE_CONFIG[item.state];

  const lines: string[] = [];
  if (imageMarkdownUrl) {
    lines.push(`![${imageAlt}](${imageMarkdownUrl})`, '');
  }
  lines.push(`# ${getItemTitle(item)}`, '');
  const p = item.properties;

  if (typeof p.body === 'string' && p.body) lines.push(p.body, '');
  if (typeof p.description === 'string' && p.description) lines.push(p.description, '');
  if (typeof p.text === 'string' && p.text) lines.push(p.text, '');
  if (typeof p.notes === 'string' && p.notes) lines.push(p.notes, '');
  if (typeof p.url === 'string' && p.url) lines.push(`[${p.url}](${p.url})`, '');

  const sidebarEntries: ScalarSidebarEntry[] = [];
  const complexEntries: Array<{ key: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(p)) {
    if (BODY_PROPERTY_KEYS.has(key)) continue;
    const classified = classifyProperty(key, value);
    if (!classified) continue;
    if (classified.kind === 'complex') {
      complexEntries.push({ key: classified.key, value: classified.value });
    } else {
      sidebarEntries.push(classified);
    }
  }

  if (complexEntries.length > 0) {
    lines.push('## Extended properties', '', '```json');
    lines.push(
      JSON.stringify(Object.fromEntries(complexEntries.map((e) => [e.key, e.value])), null, 2),
    );
    lines.push('```', '');
  }

  const extensionNamespaces = Object.keys(metadata.extensions);
  if (extensionNamespaces.length > 0) {
    lines.push('', '## Extensions', '');
    for (const ns of extensionNamespaces) {
      lines.push(
        `### ${ns}`,
        '',
        '```json',
        JSON.stringify(metadata.extensions[ns], null, 2),
        '```',
        '',
      );
    }
  }

  const edgeCounts = new Map<string, number>();
  for (const edge of edges) {
    edgeCounts.set(edge.edge_type, (edgeCounts.get(edge.edge_type) ?? 0) + 1);
  }

  function handleRefresh() {
    revalidate();
    onRefresh();
  }

  return (
    <Detail
      isLoading={isLoading}
      markdown={lines.join('\n')}
      navigationTitle={getItemTitle(item)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Type">
            <Detail.Metadata.TagList.Item text={typeConfig.label} color={typeConfig.color} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="State">
            <Detail.Metadata.TagList.Item
              text={stateConfig?.label ?? item.state}
              color={stateConfig?.color ?? Color.PrimaryText}
            />
          </Detail.Metadata.TagList>
          {sidebarEntries.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              {sidebarEntries.map((entry) => renderSidebarEntry(entry))}
            </>
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Source" text={item.source} />
          <Detail.Metadata.TagList title="Tier">
            <Detail.Metadata.TagList.Item
              text={item.tier === 'library' ? 'Library' : item.tier === 'feed' ? 'Feed' : '—'}
              color={
                item.tier === 'library'
                  ? Color.Green
                  : item.tier === 'feed'
                    ? Color.SecondaryText
                    : Color.SecondaryText
              }
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Timestamp"
            text={`${formatDate(item.timestamp)} ${formatTime(item.timestamp)}`}
          />
          <Detail.Metadata.Label
            title="Created"
            text={`${formatDate(item.created_at)} ${formatTime(item.created_at)}`}
          />
          <Detail.Metadata.Label
            title="Updated"
            text={`${formatDate(item.updated_at)} ${formatTime(item.updated_at)} (${formatRelativeTime(item.updated_at)})`}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="ID" text={item.id} />
          <Detail.Metadata.Label title="Version" text={`v${item.version}`} />
          <Detail.Metadata.Label title="Schema version" text={`v${item.schema_version}`} />
          {item.source_id && <Detail.Metadata.Label title="Source ID" text={item.source_id} />}
          {item.device && <Detail.Metadata.Label title="Device" text={item.device} />}
          {metadata.tags.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.TagList title="Tags">
                {metadata.tags.map((tag) => (
                  <Detail.Metadata.TagList.Item key={tag} text={tag} />
                ))}
              </Detail.Metadata.TagList>
            </>
          )}
          {edgeCounts.size > 0 && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.TagList title="Edges">
                {Array.from(edgeCounts.entries()).map(([edgeType, count]) => (
                  <Detail.Metadata.TagList.Item
                    key={edgeType}
                    text={`${edgeType} (${count})`}
                    color={Color.SecondaryText}
                  />
                ))}
              </Detail.Metadata.TagList>
            </>
          )}
          {extensionNamespaces.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.TagList title="Extensions">
                {extensionNamespaces.map((ns) => (
                  <Detail.Metadata.TagList.Item key={ns} text={ns} color={Color.SecondaryText} />
                ))}
              </Detail.Metadata.TagList>
            </>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {url && <Action.OpenInBrowser url={url} />}
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ['cmd'], key: 'r' }}
              onAction={handleRefresh}
            />
            {edges.length > 0 && (
              <Action.Push
                title="View Edges"
                icon={Icon.Link}
                target={<EdgesDetailView itemTitle={getItemTitle(item)} edges={edges} />}
              />
            )}
          </ActionPanel.Section>
          <ItemActionSections item={item} metadata={metadata} onRefresh={handleRefresh} />
        </ActionPanel>
      }
    />
  );
}

function renderSidebarEntry(entry: ScalarSidebarEntry) {
  const title = toTitleCase(entry.key);
  switch (entry.kind) {
    case 'datetime':
      return (
        <Detail.Metadata.Label
          key={entry.key}
          title={title}
          text={`${formatDate(entry.value)} ${formatTime(entry.value)}`}
        />
      );
    case 'url':
      return (
        <Detail.Metadata.Link
          key={entry.key}
          title={title}
          target={entry.value}
          text={entry.value}
        />
      );
    case 'boolean':
      return (
        <Detail.Metadata.TagList key={entry.key} title={title}>
          <Detail.Metadata.TagList.Item
            text={entry.value ? 'Yes' : 'No'}
            color={entry.value ? Color.Green : Color.SecondaryText}
          />
        </Detail.Metadata.TagList>
      );
    case 'number':
      return <Detail.Metadata.Label key={entry.key} title={title} text={String(entry.value)} />;
    case 'string':
    case 'array':
      return <Detail.Metadata.Label key={entry.key} title={title} text={entry.value} />;
  }
}

function EdgesDetailView({ itemTitle, edges }: { itemTitle: string; edges: Edge[] }) {
  const grouped = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge.edge_type);
    if (list) {
      list.push(edge);
    } else {
      grouped.set(edge.edge_type, [edge]);
    }
  }

  const lines: string[] = [`# Edges — ${itemTitle}`, ''];
  for (const [edgeType, edgesOfType] of grouped.entries()) {
    lines.push(`## ${edgeType} (${edgesOfType.length})`, '');
    lines.push('```json', JSON.stringify(edgesOfType, null, 2), '```', '');
  }

  return <Detail markdown={lines.join('\n')} navigationTitle={`Edges — ${itemTitle}`} />;
}
