import { Action, ActionPanel, Icon, List, showToast, Toast } from '@raycast/api';
import { useState, useEffect, useCallback } from 'react';
import type { Item } from '@mymehq/sdk';
import { getClient } from './client';
import { groupItemsByDate } from './helpers';
import { ItemListItem } from './components/ItemListItem';
import { TypeFilterDropdown } from './components/TypeFilterDropdown';

export default function BrowseCommand() {
  const [type, setType] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadItems = useCallback(async (typeFilter: string, loadCursor?: string) => {
    setIsLoading(true);
    try {
      const client = getClient();
      const response = await client.items.list({
        type: typeFilter || undefined,
        sort: 'timestamp',
        direction: 'desc',
        limit: 50,
        cursor: loadCursor ?? undefined,
      });
      if (loadCursor) {
        setItems((prev) => [...prev, ...response.data]);
      } else {
        setItems(response.data);
      }
      setCursor(response.cursor);
      setHasMore(response.has_more);
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: 'Failed to load items', message: String(error) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems(type);
  }, [type, loadItems]);

  const handleRefresh = useCallback(() => {
    loadItems(type);
  }, [type, loadItems]);

  const handleLoadMore = useCallback(() => {
    if (cursor) loadItems(type, cursor);
  }, [cursor, type, loadItems]);

  const groups = groupItemsByDate(items);

  return (
    <List
      isLoading={isLoading}
      searchBarAccessory={<TypeFilterDropdown onChange={(value) => setType(value)} />}
    >
      {items.length === 0 && !isLoading ? (
        <List.EmptyView title="No items" description="Nothing here yet" />
      ) : (
        <>
          {Array.from(groups.entries()).map(([date, dateItems]) => (
            <List.Section key={date} title={date}>
              {dateItems.map((item) => (
                <ItemListItem key={item.id} item={item} onRefresh={handleRefresh} />
              ))}
            </List.Section>
          ))}
          {hasMore && (
            <List.Section>
              <List.Item
                title="Load More..."
                icon={Icon.ArrowDown}
                actions={
                  <ActionPanel>
                    <Action title="Load More" icon={Icon.ArrowDown} onAction={handleLoadMore} />
                  </ActionPanel>
                }
              />
            </List.Section>
          )}
        </>
      )}
    </List>
  );
}
