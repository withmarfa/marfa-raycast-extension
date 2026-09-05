import { Action, ActionPanel, Icon, launchCommand, LaunchType, List, Keyboard } from '@raycast/api';
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
  const [searchText, setSearchText] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [state, setState] = useState<StateFilter>('active');
  const [type, setType] = useState('');
  // Persist the inline-detail preference per command (Raycast caches by key
  // across launches). Default off, since the accessory view is denser.
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
  const navigationTitle = [TIER_LABEL[tier], stateLabel, typeLabel].filter(Boolean).join(', ');

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
      shortcut={Keyboard.Shortcut.Common.Duplicate}
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
  /**
   * This bar narrows what is already on screen, and pagination means that is
   * rarely everything. A term matching an item three pages down simply found
   * nothing, with no way to tell that from the item not existing, which is the
   * same shape as the permissions failures and compounded diagnosing them.
   *
   * The filter stays, because narrowing a visible list is genuinely what a
   * launcher is for and Raycast users expect it. What changes is that the
   * placeholder says so, and that the full-text search is one keystroke away
   * carrying whatever was typed.
   */
  const searchEverythingAction = (
    <Action
      title="Search All Items"
      icon={Icon.MagnifyingGlass}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
      onAction={() =>
        launchCommand({
          name: 'search',
          type: LaunchType.UserInitiated,
          fallbackText: searchText,
        })
      }
    />
  );

  const filterActions = (
    <>
      {searchEverythingAction}
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
      // Explicit, because supplying `onSearchTextChange` otherwise turns
      // Raycast's own filtering off, and narrowing what is on screen is the
      // thing this bar is for.
      filtering={true}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Filter the items loaded here..."
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
              ? `Your sign-in did not grant access to ${typeLabel ?? type}.`
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
