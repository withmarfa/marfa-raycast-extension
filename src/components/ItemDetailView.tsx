import { Action, ActionPanel, Color, Detail, Icon } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import type { Edge } from '@mymehq/sdk';
import { getClient } from '../client';
import { TYPE_CONFIG, STATE_CONFIG } from '../constants';
import {
  getItemTitle,
  getItemUrl,
  formatDate,
  formatTime,
  formatRelativeTime,
} from '../helpers';
import { ItemActionSections } from './ItemActions';

interface ItemDetailViewProps {
  itemId: string;
  onRefresh: () => void;
}

export function ItemDetailView({ itemId, onRefresh }: ItemDetailViewProps) {
  const { data, isLoading, revalidate } = useCachedPromise(
    async (id: string) => {
      const client = getClient();
      const [item, metadata, edgesResponse] = await Promise.all([
        client.items.get(id),
        client.metadata.get(id),
        client.items.edges(id, { limit: 100 }),
      ]);
      return { item, metadata, edges: edgesResponse.data };
    },
    [itemId],
  );

  if (!data) {
    return <Detail isLoading={isLoading} />;
  }

  const { item, metadata, edges } = data;
  const url = getItemUrl(item);
  const typeConfig = TYPE_CONFIG[item.type] ?? {
    label: item.type,
    icon: undefined,
    color: Color.PrimaryText,
  };
  const stateConfig = STATE_CONFIG[item.state];

  const lines: string[] = [`# ${getItemTitle(item)}`, ''];
  const p = item.properties;

  if (typeof p.body === 'string') lines.push(p.body, '');
  if (typeof p.description === 'string') lines.push(p.description, '');
  if (typeof p.url === 'string') lines.push(`[${p.url}](${p.url})`, '');

  const skip = new Set(['title', 'name', 'body', 'description', 'url']);
  for (const [key, value] of Object.entries(p)) {
    if (!skip.has(key) && value != null) {
      lines.push(`**${key}:** ${String(value)}`);
    }
  }

  const extensionNamespaces = Object.keys(metadata.extensions);
  if (extensionNamespaces.length > 0) {
    lines.push('', '## Extensions', '');
    for (const ns of extensionNamespaces) {
      lines.push(`### ${ns}`, '', '```json', JSON.stringify(metadata.extensions[ns], null, 2), '```', '');
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
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Source" text={item.source} />
          <Detail.Metadata.Label title="Origin" text={item.origin} />
          <Detail.Metadata.TagList title="Library">
            <Detail.Metadata.TagList.Item
              text={item.library ? 'Library' : 'Ambient'}
              color={item.library ? Color.Green : Color.SecondaryText}
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
