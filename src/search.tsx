import { Action, ActionPanel, Icon, List, Keyboard } from '@raycast/api';
import type { LaunchProps } from '@raycast/api';
import { showFailureToast, useCachedPromise, useCachedState } from '@raycast/utils';
import { useState } from 'react';
import type { Item, ItemState, Metadata } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { stripHtmlTags } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { TierFilterDropdown, type TierFilter } from './components/TierFilterDropdown';
import { buildTypeFilterOptions } from './type-options';
import { useTypeRegistry } from './use-type-registry';
import { useTypeGrant } from './use-type-grant';
import { EmptyTrashAction } from './components/EmptyTrashAction';

type StateFilter = ItemState | 'all';

/** What both fetches return. A search adds a snippet; a recent read does not,
 *  and the row renders one when it is there. */
interface Result {
  item: Item;
  metadata: Metadata;
  snippet_html?: string;
}

const STATE_FILTERS: Array<{ value: StateFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'trashed', label: 'Trash' },
  { value: 'all', label: 'All States' },
];

function SearchCommand({ fallbackText }: LaunchProps) {
  // Browse hands its typed text over here, because its own bar only narrows
  // what is loaded. Raycast delivers it as fallback text rather than filling
  // the bar, so the bar is driven from state seeded with it.
  const [searchText, setSearchText] = useState(fallbackText ?? '');
  const [type, setType] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [state, setState] = useState<StateFilter>('active');
  const [isShowingDetail, setIsShowingDetail] = useCachedState('search-show-detail', false);

  const { registry } = useTypeRegistry();
  const isGranted = useTypeGrant();

  const { data, isLoading, revalidate } = useCachedPromise(
    async (
      q: string,
      typeFilter: string,
      tierFilter: TierFilter,
      stateFilter: StateFilter,
    ): Promise<Result[]> => {
      const client = getClient();
      const filters = {
        type: typeFilter || undefined,
        state: stateFilter === 'all' ? undefined : stateFilter,
        tier: tierFilter,
      };

      // With nothing typed, the most recent items rather than nothing at all.
      // A command whose whole value is being one keystroke away should not open
      // inert, and the same filters apply, so the dropdowns work before a query
      // exists rather than after.
      if (!q.trim()) {
        const recent = await client.items.listWithMetadata({
          ...filters,
          sort: 'timestamp',
          direction: 'desc',
          limit: 20,
        });
        return recent.data;
      }

      return client.search(q, { ...filters, limit: 20 });
    },
    // Trimmed, because the fetcher branches on the trimmed value: an untrimmed
    // key makes every whitespace variant a separate cache entry resolving to the
    // same recent-items read.
    [searchText.trim(), type, tier, state],
    {
      keepPreviousData: true,
      onError: async (err) => {
        await showFailureToast(err, { title: 'Search failed' });
      },
    },
  );

  const toggleDetail = () => setIsShowingDetail((v) => !v);

  const typeOptions = buildTypeFilterOptions(registry);
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
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search items..."
      searchBarAccessory={<TierFilterDropdown onChange={setTier} />}
      isShowingDetail={isShowingDetail}
      throttle
    >
      {data?.length === 0 ? (
        <List.EmptyView
          icon={type && !isGranted(type) ? Icon.Lock : undefined}
          title={type && !isGranted(type) ? 'Not shared with Raycast' : 'Nothing here'}
          description={
            type && !isGranted(type)
              ? `Your sign-in did not grant access to ${type}.`
              : searchText.trim()
                ? `No items matching "${searchText}"`
                : 'No items yet'
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
        data?.map((result) => (
          <ItemListItem
            key={result.item.id}
            item={result.item}
            metadata={result.metadata}
            registry={registry}
            snippet={result.snippet_html ? stripHtmlTags(result.snippet_html) : undefined}
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
        ))
      )}
    </List>
  );
}

export default withMarfaAccessToken(SearchCommand);
