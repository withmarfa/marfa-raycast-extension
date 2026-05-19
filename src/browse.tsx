import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import type { Item, ItemState, Metadata } from '@mymehq/sdk';
import { withMymeAccessToken } from './auth/with-myme-access-token';
import { getClient } from './client';
import { formatDate } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { TierFilterDropdown, type TierFilter } from './components/TierFilterDropdown';
import { buildTypeFilterOptions } from './type-options';

interface ItemWithMetadata {
  item: Item;
  metadata: Metadata;
}

const TIER_LABEL: Record<TierFilter, string> = {
  all: 'All items',
  library: 'Library only',
  feed: 'Feed only',
};

type StateFilter = ItemState | 'all';

const STATE_FILTERS: Array<{ value: StateFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'trashed', label: 'Trash' },
  { value: 'all', label: 'All States' },
];

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

function BrowseCommand() {
  const [tier, setTier] = useState<TierFilter>('all');
  const [state, setState] = useState<StateFilter>('active');
  const [type, setType] = useState('');

  const { data: typeSchemas } = useCachedPromise(
    async () => {
      const client = getClient();
      return client.types.list();
    },
    [],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to load type filters' });
      },
    },
  );

  const { data, isLoading, revalidate, pagination } = useCachedPromise(
    (typeFilter: string, tierFilter: TierFilter, stateFilter: StateFilter) =>
      async (options: { page: number; cursor?: string }) => {
        const client = getClient();
        const response = await client.items.listWithMetadata({
          type: typeFilter || undefined,
          state: stateFilter === 'all' ? undefined : stateFilter,
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
    [type, tier, state],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to load items' });
      },
    },
  );

  const groups = groupByDate(data ?? []);
  const typeOptions = buildTypeFilterOptions(typeSchemas);
  const typeLabel = type ? (typeOptions.find((t) => t.value === type)?.label ?? null) : null;
  const stateLabel = STATE_FILTERS.find((filter) => filter.value === state)?.label ?? state;
  const navigationTitle = [TIER_LABEL[tier], stateLabel, typeLabel].filter(Boolean).join(' · ');

  const typeSubmenu = (
    <ActionPanel.Submenu
      title="Filter by Type"
      icon={Icon.Filter}
      shortcut={{ modifiers: ['cmd'], key: 't' }}
    >
      {typeOptions.map((t) => (
        <Action
          key={t.value || 'all'}
          title={t.label}
          icon={t.value === type ? Icon.Checkmark : undefined}
          onAction={() => setType(t.value)}
        />
      ))}
    </ActionPanel.Submenu>
  );
  const stateSubmenu = (
    <ActionPanel.Submenu
      title="Filter by State"
      icon={Icon.Filter}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
    >
      {STATE_FILTERS.map((filter) => (
        <Action
          key={filter.value}
          title={filter.label}
          icon={filter.value === state ? Icon.Checkmark : undefined}
          onAction={() => setState(filter.value)}
        />
      ))}
    </ActionPanel.Submenu>
  );
  const filterActions = (
    <>
      {typeSubmenu}
      {stateSubmenu}
    </>
  );

  return (
    <List
      isLoading={isLoading}
      filtering
      pagination={pagination}
      navigationTitle={navigationTitle}
      searchBarAccessory={<TierFilterDropdown onChange={setTier} />}
    >
      {!isLoading && data?.length === 0 ? (
        <List.EmptyView
          title="No items"
          description="Nothing here yet"
          actions={<ActionPanel>{filterActions}</ActionPanel>}
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
                topActions={filterActions}
              />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}

export default withMymeAccessToken(BrowseCommand);
