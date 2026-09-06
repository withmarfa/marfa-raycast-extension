import { Action, ActionPanel, Icon, List, Keyboard } from '@raycast/api';
import { showFailureToast, useCachedPromise, useCachedState } from '@raycast/utils';
import { useState } from 'react';
import type { ItemState } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { formatDate, stripHtmlTags } from './helpers';
import { groupByDate, mergeEntries, type Entry } from './result-merge';
import { ItemListItem } from './components/ItemListItem';
import { TierFilterDropdown, type TierFilter } from './components/TierFilterDropdown';
import { buildTypeFilterOptions } from './type-options';
import { useTypeRegistry } from './use-type-registry';
import { useTypeGrant } from './use-type-grant';
import { EmptyTrashAction } from './components/EmptyTrashAction';

/**
 * One list over everything, which browses and searches on the same bar.
 *
 * These were two commands. The split was never a design: a Raycast `List`
 * either lets Raycast filter what is loaded or hands the typed text to you, and
 * one command appeared to have to choose. It does not. Setting `filtering`
 * explicitly keeps the native filter while still delivering the text, so the
 * bar can do both at once, and it should, because neither is sufficient alone.
 * The filter is instant and blind past the loaded pages; the search sees
 * everything and costs a round trip. Running both means typing narrows what is
 * on screen immediately and anything deeper arrives a moment later.
 */

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

function BrowseCommand() {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [state, setState] = useState<StateFilter>('active');
  const [type, setType] = useState('');
  // Persist the inline-detail preference per command (Raycast caches by key
  // across launches). Default off, since the accessory view is denser.
  const [isShowingDetail, setIsShowingDetail] = useCachedState('browse-show-detail', false);

  const { registry } = useTypeRegistry();
  const isGranted = useTypeGrant();

  // The spine. Deliberately not keyed on the query: typing must not throw away
  // the pages already walked and start the cursor again.
  const {
    data: loaded,
    isLoading,
    revalidate,
    pagination,
  } = useCachedPromise(
    (typeFilter: string, tierFilter: TierFilter, stateFilter: StateFilter) =>
      async (options: { page: number; cursor?: string }) => {
        const response = await getClient().items.listWithMetadata({
          type: typeFilter || undefined,
          state: stateFilter === 'all' ? undefined : stateFilter,
          tier: tierFilter,
          sort: 'timestamp',
          direction: 'desc',
          limit: 50,
          cursor: options.cursor,
        });
        return { data: response.data, hasMore: response.has_more, cursor: response.cursor };
      },
    [type, tier, state],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to load items' });
      },
    },
  );

  // The reach. Full text against the whole instance, so a match past the loaded
  // pages is findable rather than silently absent.
  const { data: hits, isLoading: isSearching } = useCachedPromise(
    async (
      q: string,
      typeFilter: string,
      tierFilter: TierFilter,
      stateFilter: StateFilter,
    ): Promise<Entry[]> => {
      if (!q) return [];
      return getClient().search(q, {
        type: typeFilter || undefined,
        state: stateFilter === 'all' ? undefined : stateFilter,
        tier: tierFilter,
        limit: 20,
      });
    },
    [query, type, tier, state],
    {
      keepPreviousData: true,
      onError: async (err) => {
        await showFailureToast(err, { title: 'Search failed' });
      },
    },
  );

  const searchHits = query ? (hits ?? []) : [];
  const groups = groupByDate(mergeEntries(loaded ?? [], searchHits), formatDate);
  const hitIds = new Set(searchHits.map((entry) => entry.item.id));
  const isEmpty = !isLoading && !isSearching && groups.size === 0;

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
  const filterActions = (
    <>
      {typeSubmenu}
      {stateSubmenu}
    </>
  );

  const emptyTrashAction =
    state === 'trashed' && !isEmpty ? (
      <EmptyTrashAction count={loaded?.length ?? 0} onComplete={revalidate} />
    ) : null;

  return (
    <List
      isLoading={isLoading || isSearching}
      // Explicit, because supplying `onSearchTextChange` otherwise turns
      // Raycast's own filtering off, and the instant narrowing is half of what
      // this bar does.
      filtering={true}
      throttle
      onSearchTextChange={(text) => setQuery(text.trim())}
      searchBarPlaceholder="Search your items..."
      pagination={pagination}
      isShowingDetail={isShowingDetail}
      navigationTitle={navigationTitle}
      searchBarAccessory={<TierFilterDropdown onChange={setTier} />}
    >
      {isEmpty ? (
        <List.EmptyView
          icon={type && !isGranted(type) ? Icon.Lock : undefined}
          title={type && !isGranted(type) ? 'Not shared with Raycast' : 'No items'}
          description={
            type && !isGranted(type)
              ? `Your sign-in did not grant access to ${typeLabel ?? type}.`
              : query
                ? `Nothing matching "${query}"`
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
        [...groups.entries()].map(([date, entries]) => (
          <List.Section key={date} title={date}>
            {entries.map(({ item, metadata, snippet_html }) => (
              <ItemListItem
                key={item.id}
                item={item}
                metadata={metadata}
                registry={registry}
                snippet={snippet_html ? stripHtmlTags(snippet_html) : undefined}
                // A server hit matched on text the native filter cannot see,
                // such as an item's body, so without the query itself as a
                // keyword Raycast would fetch the row and then hide it.
                keywords={hitIds.has(item.id) ? [query] : undefined}
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
