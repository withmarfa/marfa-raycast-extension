import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { showFailureToast, useCachedPromise, useCachedState } from '@raycast/utils';
import { useState } from 'react';
import type { Item, ItemState, Metadata } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { formatDate } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { TierFilterDropdown, type TierFilter } from './components/TierFilterDropdown';
import { buildTypeFilterOptions } from './type-options';
import { useTypeRegistry } from './use-type-registry';
import { useTypeGrant } from './use-type-grant';
import { EmptyTrashAction } from './components/EmptyTrashAction';

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
  // Persist the inline-detail preference per command (Raycast caches by key
  // across launches). Default off — accessory view is denser at-a-glance.
  const [isShowingDetail, setIsShowingDetail] = useCachedState('browse-show-detail', false);

  const { registry } = useTypeRegistry();
  const isGranted = useTypeGrant();

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
  const typeOptions = buildTypeFilterOptions(registry);
  const typeLabel = type ? (typeOptions.find((t) => t.value === type)?.label ?? null) : null;
  const stateLabel = STATE_FILTERS.find((filter) => filter.value === state)?.label ?? state;
  const navigationTitle = [TIER_LABEL[tier], stateLabel, typeLabel].filter(Boolean).join(' · ');

  const toggleDetail = () => setIsShowingDetail((v) => !v);

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

  const emptyTrashAction =
    state === 'trashed' && (data?.length ?? 0) > 0 ? (
      <EmptyTrashAction count={data?.length ?? 0} onComplete={revalidate} />
    ) : null;

  return (
    <List
      isLoading={isLoading}
      filtering
      pagination={pagination}
      isShowingDetail={isShowingDetail}
      navigationTitle={navigationTitle}
      searchBarAccessory={<TierFilterDropdown onChange={setTier} />}
    >
      {!isLoading && data?.length === 0 ? (
        <List.EmptyView
          icon={type && !isGranted(type) ? Icon.Lock : undefined}
          title={type && !isGranted(type) ? 'Not shared with Raycast' : 'No items'}
          description={
            type && !isGranted(type)
              ? `Your sign-in did not grant access to ${typeLabel ?? type}. Sign out and back in from Raycast's extension settings to review what Marfa is allowed to show.`
              : 'Nothing here yet'
          }
          actions={
            <ActionPanel>
              {filterActions}
              <Action
                title={isShowingDetail ? 'Hide Details' : 'Show Details'}
                icon={Icon.Sidebar}
                shortcut={{ modifiers: ['cmd'], key: 'd' }}
                onAction={toggleDetail}
              />
            </ActionPanel>
          }
        />
      ) : (
        Array.from(groups.entries()).map(([date, entries]) => (
          <List.Section key={date} title={date}>
            {entries.map(({ item, metadata }) => (
              <ItemListItem
                key={item.id}
                item={item}
                metadata={metadata}
                registry={registry}
                onRefresh={revalidate}
                topActions={
                  <>
                    {filterActions}
                    {emptyTrashAction}
                  </>
                }
                showInlineDetail={isShowingDetail}
                onToggleDetail={toggleDetail}
                isShowingDetail={isShowingDetail}
              />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}

export default withMarfaAccessToken(BrowseCommand);
