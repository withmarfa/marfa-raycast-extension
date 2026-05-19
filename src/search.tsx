import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { showFailureToast, useCachedPromise, useCachedState } from '@raycast/utils';
import { useState } from 'react';
import type { ItemState } from '@mymehq/sdk';
import { withMymeAccessToken } from './auth/with-myme-access-token';
import { getClient } from './client';
import { stripHtmlTags } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { TierFilterDropdown, type TierFilter } from './components/TierFilterDropdown';
import { buildTypeFilterOptions } from './type-options';
import { EmptyTrashAction } from './components/EmptyTrashAction';

type StateFilter = ItemState | 'all';

const STATE_FILTERS: Array<{ value: StateFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'trashed', label: 'Trash' },
  { value: 'all', label: 'All States' },
];

function SearchCommand() {
  const [searchText, setSearchText] = useState('');
  const [type, setType] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [state, setState] = useState<StateFilter>('active');
  const [isShowingDetail, setIsShowingDetail] = useCachedState('search-show-detail', false);

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

  const { data, isLoading, revalidate } = useCachedPromise(
    async (q: string, typeFilter: string, tierFilter: TierFilter, stateFilter: StateFilter) => {
      if (!q.trim()) return [];
      const client = getClient();
      return client.search(q, {
        type: typeFilter || undefined,
        state: stateFilter === 'all' ? undefined : stateFilter,
        tier: tierFilter,
        limit: 20,
      });
    },
    [searchText, type, tier, state],
    {
      keepPreviousData: true,
      onError: async (err) => {
        await showFailureToast(err, { title: 'Search failed' });
      },
    },
  );

  const toggleDetail = () => setIsShowingDetail((v) => !v);

  const typeOptions = buildTypeFilterOptions(typeSchemas);
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
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search items..."
      searchBarAccessory={<TierFilterDropdown onChange={setTier} />}
      isShowingDetail={isShowingDetail}
      throttle
    >
      {!searchText.trim() ? (
        <List.EmptyView
          title="Search Myme"
          description="Type to search your items"
          icon="icon.png"
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
      ) : data?.length === 0 ? (
        <List.EmptyView
          title="No results"
          description={`No items matching "${searchText}"`}
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

export default withMymeAccessToken(SearchCommand);
