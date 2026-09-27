import { Action, Color, Icon, List } from '@raycast/api';
import type { ReactNode } from 'react';
import { ActionPanel } from '@raycast/api';
import { typeIcon } from '../appearance';
import { formatWhen } from '../dates';
import type { Registry } from '../display';
import type { Entry } from '../marfa';
import { ItemActions, webUrl } from './ItemActions';
import { ItemDetail } from './ItemDetail';

export function EntryListItem({
  entry,
  registry,
  showingDetail,
  onChanged,
  listActions,
}: {
  entry: Entry;
  registry: Registry;
  showingDetail: boolean;
  onChanged: () => void;
  listActions: ReactNode;
}) {
  const { item, metadata } = entry;
  const title = registry.titleOf(item);
  const body = registry.bodyOf(item);
  const url = webUrl(item);
  const trashed = item.state === 'trashed';

  const detail = (
    <List.Item.Detail
      markdown={body || `_${registry.label(item.type)} with no text_`}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Type" text={registry.label(item.type)} />
          {item.state !== 'active' && (
            <List.Item.Detail.Metadata.TagList title="State">
              <List.Item.Detail.Metadata.TagList.Item
                text={trashed ? 'Trashed' : 'Archived'}
                color={trashed ? Color.Red : Color.Blue}
              />
            </List.Item.Detail.Metadata.TagList>
          )}
          {item.tier === 'feed' && <List.Item.Detail.Metadata.Label title="Tier" text="Feed" />}
          {metadata.tags.length > 0 && (
            <List.Item.Detail.Metadata.TagList title="Tags">
              {metadata.tags.map((tag) => (
                <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          )}
          {url && <List.Item.Detail.Metadata.Link title="URL" target={url} text={url} />}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Updated" text={formatWhen(item.updated_at)} />
          <List.Item.Detail.Metadata.Label title="Created" text={formatWhen(item.created_at)} />
          <List.Item.Detail.Metadata.Label title="Source" text={item.source} />
        </List.Item.Detail.Metadata>
      }
    />
  );

  return (
    <List.Item
      id={item.id}
      title={title}
      subtitle={showingDetail ? undefined : registry.subtitleOf(item)}
      keywords={[...metadata.tags, ...registry.subtitleOf(item).split(/\s+/)]}
      icon={typeIcon(registry, item.type, trashed)}
      accessories={
        showingDetail
          ? undefined
          : [
              ...metadata.tags.slice(0, 2).map((tag) => ({ tag })),
              {
                date: new Date(item.updated_at),
                tooltip: `Updated ${formatWhen(item.updated_at)}`,
              },
            ]
      }
      detail={showingDetail ? detail : undefined}
      actions={
        <ActionPanel title={title}>
          <ItemActions
            entry={entry}
            registry={registry}
            onChanged={onChanged}
            lead={
              <Action.Push
                title="Show Item"
                icon={Icon.Eye}
                target={<ItemDetail entry={entry} registry={registry} onChanged={onChanged} />}
              />
            }
          />
          {listActions}
        </ActionPanel>
      }
    />
  );
}
