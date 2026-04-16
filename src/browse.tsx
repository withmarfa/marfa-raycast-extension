import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import type { Item, Metadata } from '@mymehq/sdk';
import { getClient } from './client';
import { ALL_TYPES } from './constants';
import { formatDate } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import {
  LibraryFilterDropdown,
  type LibraryFilter,
} from './components/LibraryFilterDropdown';

interface ItemWithMetadata {
  item: Item;
  metadata: Metadata;
}

const LIBRARY_PARAM: Record<LibraryFilter, boolean | undefined> = {
  all: undefined,
  library: true,
  ambient: false,
};

const LIBRARY_LABEL: Record<LibraryFilter, string> = {
  all: 'All items',
  library: 'Library only',
  ambient: 'Ambient only',
};

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
  const [library, setLibrary] = useState<LibraryFilter>('all');
  const [type, setType] = useState('');

  const { data, isLoading, revalidate, pagination } = useCachedPromise(
    (typeFilter: string, libraryFilter: LibraryFilter) =>
      async (options: { page: number; cursor?: string }) => {
        const client = getClient();
        const response = await client.items.listWithMetadata({
          type: typeFilter || undefined,
          library: LIBRARY_PARAM[libraryFilter],
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
    [type, library],
  );

  const groups = groupByDate(data ?? []);
  const typeLabel = type ? (ALL_TYPES.find((t) => t.value === type)?.label ?? null) : null;
  const navigationTitle = typeLabel
    ? `${LIBRARY_LABEL[library]} · ${typeLabel}`
    : LIBRARY_LABEL[library];

  const typeSubmenu = (
    <ActionPanel.Submenu
      title="Filter by Type"
      icon={Icon.Filter}
      shortcut={{ modifiers: ['cmd'], key: 't' }}
    >
      {ALL_TYPES.map((t) => (
        <Action
          key={t.value || 'all'}
          title={t.label}
          icon={t.value === type ? Icon.Checkmark : undefined}
          onAction={() => setType(t.value)}
        />
      ))}
    </ActionPanel.Submenu>
  );

  return (
    <List
      isLoading={isLoading}
      filtering
      pagination={pagination}
      navigationTitle={navigationTitle}
      searchBarAccessory={<LibraryFilterDropdown onChange={setLibrary} />}
    >
      {!isLoading && data?.length === 0 ? (
        <List.EmptyView
          title="No items"
          description="Nothing here yet"
          actions={<ActionPanel>{typeSubmenu}</ActionPanel>}
        />
      ) : (
        Array.from(groups.entries()).map(([date, entries]) => (
          <List.Section key={date} title={date}>
            {entries.map(({ item, metadata }) => (
              <ItemListItem
                key={item.id}
                item={item}
                metadata={metadata}
                onRefresh={revalidate}
                topActions={typeSubmenu}
              />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}
