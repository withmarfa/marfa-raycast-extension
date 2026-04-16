import { List } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import { getClient } from './client';
import { stripHtmlTags } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { TypeFilterDropdown } from './components/TypeFilterDropdown';

export default function SearchCommand() {
  const [searchText, setSearchText] = useState('');
  const [type, setType] = useState('');

  const { data, isLoading, revalidate } = useCachedPromise(
    async (q: string, typeFilter: string) => {
      if (!q.trim()) return [];
      const client = getClient();
      return client.search(q, {
        type: typeFilter || undefined,
        library: true,
        limit: 20,
      });
    },
    [searchText, type],
    { keepPreviousData: true },
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search items..."
      searchBarAccessory={<TypeFilterDropdown onChange={setType} />}
      throttle
    >
      {!searchText.trim() ? (
        <List.EmptyView
          title="Search Myme"
          description="Type to search your items"
          icon="icon.png"
        />
      ) : data?.length === 0 ? (
        <List.EmptyView title="No results" description={`No items matching "${searchText}"`} />
      ) : (
        data?.map((result) => (
          <ItemListItem
            key={result.item.id}
            item={result.item}
            metadata={result.metadata}
            snippet={result.snippet_html ? stripHtmlTags(result.snippet_html) : undefined}
            onRefresh={revalidate}
          />
        ))
      )}
    </List>
  );
}
