import { List } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import type { Item, Metadata } from '@mymehq/sdk';
import { getClient } from './client';
import { formatDate } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { TypeFilterDropdown } from './components/TypeFilterDropdown';

interface ItemWithMetadata {
  item: Item;
  metadata: Metadata;
}

function groupByDate(entries: ItemWithMetadata[]): Map<string, ItemWithMetadata[]> {
  const groups = new Map<string, ItemWithMetadata[]>();
  for (const entry of entries) {
    const key = formatDate(entry.item.timestamp);
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return groups;
}

export default function BrowseCommand() {
  const [type, setType] = useState('');

  const { data, isLoading, revalidate, pagination } = useCachedPromise(
    (typeFilter: string) => async (options: { page: number; cursor?: string }) => {
      const client = getClient();
      const response = await client.items.listWithMetadata({
        type: typeFilter || undefined,
        library: true,
        sort: 'timestamp',
        direction: 'desc',
        limit: 50,
        cursor: options.cursor,
      });
      return {
        data: response.data,
        hasMore: response.has_more,
        cursor: response.cursor,
      };
    },
    [type],
  );

  const groups = groupByDate(data ?? []);

  return (
    <List
      isLoading={isLoading}
      filtering
      pagination={pagination}
      searchBarAccessory={<TypeFilterDropdown onChange={setType} />}
    >
      {!isLoading && data?.length === 0 ? (
        <List.EmptyView title="No items" description="Nothing here yet" />
      ) : (
        Array.from(groups.entries()).map(([date, entries]) => (
          <List.Section key={date} title={date}>
            {entries.map(({ item, metadata }) => (
              <ItemListItem key={item.id} item={item} metadata={metadata} onRefresh={revalidate} />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}
