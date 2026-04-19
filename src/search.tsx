import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import { getClient } from './client';
import { ALL_TYPES } from './constants';
import { stripHtmlTags } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { LibraryFilterDropdown, type LibraryFilter } from './components/LibraryFilterDropdown';

const LIBRARY_PARAM: Record<LibraryFilter, boolean | undefined> = {
  all: undefined,
  library: true,
  ambient: false,
};

export default function SearchCommand() {
  const [searchText, setSearchText] = useState('');
  const [type, setType] = useState('');
  const [library, setLibrary] = useState<LibraryFilter>('all');

  const { data, isLoading, revalidate } = useCachedPromise(
    async (q: string, typeFilter: string, libraryFilter: LibraryFilter) => {
      if (!q.trim()) return [];
      const client = getClient();
      return client.search(q, {
        type: typeFilter || undefined,
        library: LIBRARY_PARAM[libraryFilter],
        limit: 20,
      });
    },
    [searchText, type, library],
    { keepPreviousData: true },
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
      searchBarAccessory={<LibraryFilterDropdown onChange={setLibrary} />}
      throttle
    >
      {!searchText.trim() ? (
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
