import { Action, ActionPanel, Color, Detail, Icon, Keyboard } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { getClient } from '../client';
import { STATE_CONFIG } from '../constants';
import {
  getItemUrl,
  formatDate,
  formatTime,
  formatRelativeTime,
  toTitleCase,
  getImageSource,
  arrayBufferToBase64,
} from '../helpers';
import { ItemActionSections } from './ItemActions';
import { splitItemProperties, type ScalarSidebarEntry } from '../item-metadata';
import { useTypeRegistry } from '../use-type-registry';
import type { Edge } from '@withmarfa/sdk';

interface ItemDetailViewProps {
  itemId: string;
  onRefresh: () => void;
}

export function ItemDetailView({ itemId, onRefresh }: ItemDetailViewProps) {
  const { registry } = useTypeRegistry();
  const { data, isLoading, revalidate } = useCachedPromise(
    async (id: string) => {
      const client = getClient();
      const [item, metadata, edgesResponse] = await Promise.all([
        client.items.get(id),
        client.metadata.get(id),
        client.items.edges(id, { limit: 100 }),
      ]);
      const source = getImageSource(item);
      let imageMarkdownUrl: string | null = null;
      if (source?.kind === 'url') {
        imageMarkdownUrl = source.url;
      } else if (source?.kind === 'blob') {
        try {
          const bytes = await client.blobs.download(source.blobRef);
          imageMarkdownUrl = `data:${source.mimeType};base64,${arrayBufferToBase64(bytes)}`;
        } catch {
          imageMarkdownUrl = null;
        }
      }
      return { item, metadata, edges: edgesResponse.data, imageMarkdownUrl };
    },
    [itemId],
  );

  if (!data) {
    return <Detail isLoading={isLoading} />;
  }

  const { item, metadata, edges, imageMarkdownUrl } = data;
  const title = registry.titleOf(item);
  const bodyField = registry.bodyField(item.type);
  const url = getItemUrl(item);
  const typeLabel = registry.label(item.type);
  const typeColor = registry.appearance(item.type).color;
  const stateConfig = STATE_CONFIG[item.state];

  const lines: string[] = [];
  if (imageMarkdownUrl) {
    lines.push(`![${title}](${imageMarkdownUrl})`, '');
  }
  lines.push(`# ${title}`, '');
  const p = item.properties;

  // The registry's own body field first, then the conventional names for
  // types it has no hint for.
  const hintedBody = bodyField ? p[bodyField] : undefined;
  if (typeof hintedBody === 'string' && hintedBody) lines.push(hintedBody, '');
  if (typeof p.body === 'string' && p.body) lines.push(p.body, '');
  if (typeof p.description === 'string' && p.description) lines.push(p.description, '');
  if (typeof p.text === 'string' && p.text) lines.push(p.text, '');
  if (typeof p.notes === 'string' && p.notes) lines.push(p.notes, '');
  if (typeof p.url === 'string' && p.url) lines.push(`[${p.url}](${p.url})`, '');

  const { scalar: sidebarEntries, complex: complexEntries } = splitItemProperties(item, [
    registry.titleField(item.type),
    bodyField,
  ]);

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
      navigationTitle={title}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Type">
            <Detail.Metadata.TagList.Item text={typeLabel} color={typeColor} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="State">
            <Detail.Metadata.TagList.Item
              text={stateConfig?.label ?? item.state}
              color={stateConfig?.color ?? Color.PrimaryText}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="Tier">
            <Detail.Metadata.TagList.Item
              text={item.tier === 'library' ? 'Library' : item.tier === 'feed' ? 'Feed' : '—'}
              color={item.tier === 'library' ? Color.Green : Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
          {metadata.tags.length > 0 && (
            <Detail.Metadata.TagList title="Tags">
              {metadata.tags.map((tag) => (
                <Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </Detail.Metadata.TagList>
          )}

          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Timestamp"
            text={`${formatDate(item.timestamp)} ${formatTime(item.timestamp)}`}
          />
          <Detail.Metadata.Label
            title="Updated"
            text={`${formatDate(item.updated_at)} ${formatTime(item.updated_at)} (${formatRelativeTime(item.updated_at)})`}
          />
          <Detail.Metadata.Label
            title="Created"
            text={`${formatDate(item.created_at)} ${formatTime(item.created_at)}`}
          />

          {/* Custom properties from the item's typed schema */}
          {sidebarEntries.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              {sidebarEntries.map((entry) => renderSidebarEntry(entry))}
            </>
          )}

          {/* Provenance */}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Source" text={item.source} />
          {item.device && <Detail.Metadata.Label title="Device" text={item.device} />}
          {item.source_id && <Detail.Metadata.Label title="Source ID" text={item.source_id} />}
          {/* Both halves or neither. One coordinate is not a location, and the
              row that used to render for it said so with a dash, which is a
              row whose only content is that it has none. The inline panel
              already required both; this is the two agreeing. */}
          {item.capture_latitude !== undefined && item.capture_longitude !== undefined && (
            <Detail.Metadata.Label
              title="Location"
              text={`${item.capture_latitude.toFixed(4)}, ${item.capture_longitude.toFixed(4)}`}
            />
          )}

          {/* Identity */}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="ID" text={item.id} />
          <Detail.Metadata.Label title="Revision" text={String(item.version)} />
          <Detail.Metadata.Label title="Schema version" text={String(item.schema_version)} />

          {/* Relationships */}
          {(edgeCounts.size > 0 || extensionNamespaces.length > 0) && <Detail.Metadata.Separator />}
          {edgeCounts.size > 0 && (
            <Detail.Metadata.TagList title="Edges">
              {Array.from(edgeCounts.entries()).map(([edgeType, count]) => (
                <Detail.Metadata.TagList.Item
                  key={edgeType}
                  text={`${edgeType} (${count})`}
                  color={Color.SecondaryText}
                />
              ))}
            </Detail.Metadata.TagList>
          )}
          {extensionNamespaces.length > 0 && (
            <Detail.Metadata.TagList title="Extensions">
              {extensionNamespaces.map((ns) => (
                <Detail.Metadata.TagList.Item key={ns} text={ns} color={Color.SecondaryText} />
              ))}
            </Detail.Metadata.TagList>
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
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={handleRefresh}
            />
            {edges.length > 0 && (
              <Action.Push
                title="View Edges"
                icon={Icon.Link}
                target={<EdgesDetailView itemTitle={title} edges={edges} />}
              />
            )}
          </ActionPanel.Section>
          <ItemActionSections
            item={item}
            metadata={metadata}
            registry={registry}
            onRefresh={handleRefresh}
          />
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

  const lines: string[] = [`# Edges: ${itemTitle}`, ''];
  for (const [edgeType, edgesOfType] of grouped.entries()) {
    lines.push(`## ${edgeType} (${edgesOfType.length})`, '');
    lines.push('```json', JSON.stringify(edgesOfType, null, 2), '```', '');
  }

  return <Detail markdown={lines.join('\n')} navigationTitle={`Edges: ${itemTitle}`} />;
}
