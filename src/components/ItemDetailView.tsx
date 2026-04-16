import { Action, ActionPanel, Color, Detail, Icon } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { getClient } from '../client';
import { TYPE_CONFIG, STATE_CONFIG } from '../constants';
import { getItemTitle, getItemUrl, formatDate, formatTime } from '../helpers';
import { ItemActionSections } from './ItemActions';

interface ItemDetailViewProps {
  itemId: string;
  onRefresh: () => void;
}

export function ItemDetailView({ itemId, onRefresh }: ItemDetailViewProps) {
  const { data, isLoading, revalidate } = useCachedPromise(
    async (id: string) => {
      const client = getClient();
      const [item, metadata] = await Promise.all([client.items.get(id), client.metadata.get(id)]);
      return { item, metadata };
    },
    [itemId],
  );

  if (!data) {
    return <Detail isLoading={isLoading} />;
  }

  const { item, metadata } = data;
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
            text={`${formatDate(item.updated_at)} ${formatTime(item.updated_at)}`}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="ID" text={item.id} />
          {item.source && <Detail.Metadata.Label title="Source" text={item.source} />}
          {metadata.tags.length > 0 && (
            <Detail.Metadata.TagList title="Tags">
              {metadata.tags.map((tag) => (
                <Detail.Metadata.TagList.Item key={tag} text={tag} />
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
              shortcut={{ modifiers: ['cmd'], key: 'r' }}
              onAction={handleRefresh}
            />
          </ActionPanel.Section>
          <ItemActionSections item={item} metadata={metadata} onRefresh={handleRefresh} />
        </ActionPanel>
      }
    />
  );
}
