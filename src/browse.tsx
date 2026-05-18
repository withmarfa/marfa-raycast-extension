import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import type { Item, Metadata } from '@mymehq/sdk';
import { getClient, MymeAuthMissingError } from './client';
import { ALL_TYPES } from './constants';
import { formatDate } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { SignInRequiredEmptyView } from './components/SignInRequiredView';
import { TierFilterDropdown, type TierFilter } from './components/TierFilterDropdown';

interface ItemWithMetadata {
  item: Item;
  metadata: Metadata;
}

const TIER_LABEL: Record<TierFilter, string> = {
  all: 'All items',
  library: 'Library only',
  feed: 'Feed only',
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
  const [tier, setTier] = useState<TierFilter>('all');
  const [type, setType] = useState('');

  const { data, isLoading, error, revalidate, pagination } = useCachedPromise(
    (typeFilter: string, tierFilter: TierFilter) =>
      async (options: { page: number; cursor?: string }) => {
        const client = await getClient();
        const response = await client.items.listWithMetadata({
          type: typeFilter || undefined,
          tier: tierFilter,
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
    [type, tier],
    {
      onError: async (err) => {
        if (err instanceof MymeAuthMissingError) return;
        await showFailureToast(err, { title: 'Failed to load items' });
      },
    },
  );

  const groups = groupByDate(data ?? []);
  const typeLabel = type ? (ALL_TYPES.find((t) => t.value === type)?.label ?? null) : null;
  const navigationTitle = typeLabel ? `${TIER_LABEL[tier]} · ${typeLabel}` : TIER_LABEL[tier];

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
      searchBarAccessory={<TierFilterDropdown onChange={setTier} />}
    >
      {error instanceof MymeAuthMissingError ? (
        <SignInRequiredEmptyView />
      ) : !isLoading && data?.length === 0 ? (
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
