import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import { getClient, MymeAuthMissingError } from './client';
import { ALL_TYPES } from './constants';
import { stripHtmlTags } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { SignInRequiredEmptyView } from './components/SignInRequiredView';
import { TierFilterDropdown, type TierFilter } from './components/TierFilterDropdown';

export default function SearchCommand() {
  const [searchText, setSearchText] = useState('');
  const [type, setType] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');

  const { data, isLoading, error, revalidate } = useCachedPromise(
    async (q: string, typeFilter: string, tierFilter: TierFilter) => {
      if (!q.trim()) return [];
      const client = await getClient();
      return client.search(q, {
        type: typeFilter || undefined,
        tier: tierFilter,
        limit: 20,
      });
    },
    [searchText, type, tier],
    {
      keepPreviousData: true,
      onError: async (err) => {
        if (err instanceof MymeAuthMissingError) return;
        await showFailureToast(err, { title: 'Search failed' });
      },
    },
  );

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
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search items..."
      searchBarAccessory={<TierFilterDropdown onChange={setTier} />}
      throttle
    >
      {error instanceof MymeAuthMissingError ? (
        <SignInRequiredEmptyView />
      ) : !searchText.trim() ? (
        <List.EmptyView
          title="Search Myme"
          description="Type to search your items"
          icon="icon.png"
          actions={<ActionPanel>{typeSubmenu}</ActionPanel>}
        />
      ) : data?.length === 0 ? (
        <List.EmptyView
          title="No results"
          description={`No items matching "${searchText}"`}
          actions={<ActionPanel>{typeSubmenu}</ActionPanel>}
        />
      ) : (
        data?.map((result) => (
          <ItemListItem
            key={result.item.id}
            item={result.item}
            metadata={result.metadata}
            snippet={result.snippet_html ? stripHtmlTags(result.snippet_html) : undefined}
            onRefresh={revalidate}
            topActions={typeSubmenu}
          />
        ))
      )}
    </List>
  );
}
