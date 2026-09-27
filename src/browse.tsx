import { Action, ActionPanel, Icon, Keyboard, List } from '@raycast/api';
import { useCachedPromise, useCachedState } from '@raycast/utils';
import { useEffect, useState } from 'react';
import { EntryListItem } from './components/EntryListItem';
import { FailureEmptyView } from './components/FailureEmptyView';
import { buildRegistry, NOTE_TYPE } from './display';
import { showFailure } from './feedback';
import { listItems, listTypes, searchItems, type StateFilter } from './marfa';

const STATES: Array<{ value: StateFilter; title: string }> = [
  { value: 'active', title: 'Active' },
  { value: 'archived', title: 'Archived' },
  { value: 'trashed', title: 'Trash' },
];

const ALL_TYPES = '';

/**
 * Every item, newest change first, and full-text search on the same bar.
 *
 * An empty bar walks the list page by page; typing hands the text to the
 * server's search, which reaches past the loaded pages. The list is read again
 * on every open, so a change made in another app shows the next time Browse is
 * opened, or at once with Refresh.
 */
export default function Browse() {
  const [query, setQuery] = useState('');
  const [type, setType] = useCachedState('browse-type', NOTE_TYPE);
  const [state, setState] = useState<StateFilter>('active');
  const [showingDetail, setShowingDetail] = useCachedState('browse-show-detail', true);

  // Silent on failure: whatever stops the registry stops the listing too,
  // which says so, and without it types read by their identifiers.
  const types = useCachedPromise(listTypes, [], { onError: () => undefined });
  const registry = buildRegistry(types.data);

  const listing = useCachedPromise(
    (typeFilter: string, stateFilter: StateFilter) => async (options: { cursor?: string }) => {
      const page = await listItems({
        type: typeFilter || undefined,
        state: stateFilter,
        cursor: options.cursor,
      });
      return {
        data: page.entries,
        hasMore: page.cursor !== null,
        cursor: page.cursor ?? undefined,
      };
    },
    [type, state],
    { execute: query === '', keepPreviousData: true, onError: () => undefined },
  );

  const search = useCachedPromise(
    (q: string, typeFilter: string, stateFilter: StateFilter) =>
      searchItems({ query: q, type: typeFilter || undefined, state: stateFilter }),
    [query, type, state],
    { execute: query !== '', keepPreviousData: true, onError: () => undefined },
  );

  const active = query === '' ? listing : search;
  const entries = active.data ?? [];
  // A failed refresh over rows already shown is a toast; with nothing to show,
  // the empty view explains it instead.
  const hasEntries = entries.length > 0;
  useEffect(() => {
    if (active.error && hasEntries) void showFailure(active.error, 'Refreshing');
  }, [active.error]);

  const refresh = () => {
    active.revalidate();
    types.revalidate();
  };

  const listActions = (
    <ActionPanel.Section title="List">
      <Action
        title="Refresh"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={refresh}
      />
      <Action
        title={showingDetail ? 'Hide Details' : 'Show Details'}
        icon={Icon.Sidebar}
        shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
        onAction={() => setShowingDetail(!showingDetail)}
      />
      <ActionPanel.Submenu
        title="Show State"
        icon={Icon.Filter}
        shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
      >
        {STATES.map((option) => (
          <Action
            key={option.value}
            title={option.title}
            icon={option.value === state ? Icon.Checkmark : undefined}
            onAction={() => setState(option.value)}
          />
        ))}
      </ActionPanel.Submenu>
    </ActionPanel.Section>
  );

  const stateTitle = STATES.find((option) => option.value === state)?.title ?? state;
  // Until the first answer arrives, an empty list is loading, not empty.
  const answered = active.data !== undefined || active.error !== undefined;

  return (
    <List
      isLoading={active.isLoading || !answered}
      filtering={false}
      throttle
      onSearchTextChange={(text) => setQuery(text.trim())}
      searchBarPlaceholder={state === 'active' ? 'Search' : `Search ${stateTitle}`}
      navigationTitle={state === 'active' ? undefined : stateTitle}
      pagination={query === '' ? listing.pagination : undefined}
      isShowingDetail={showingDetail && entries.length > 0}
      searchBarAccessory={
        <List.Dropdown tooltip="Type" value={type} onChange={setType}>
          <List.Dropdown.Item title="All Types" value={ALL_TYPES} />
          {/* Listed before the registry arrives, so the default is always an option. */}
          <List.Dropdown.Item title="Notes" value={NOTE_TYPE} />
          <List.Dropdown.Section>
            {registry
              .filterable()
              .filter((definition) => definition.id !== NOTE_TYPE)
              .map((definition) => (
                <List.Dropdown.Item
                  key={definition.id}
                  title={registry.label(definition.id)}
                  value={definition.id}
                />
              ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {active.error && entries.length === 0 ? (
        <FailureEmptyView error={active.error} onRetry={refresh} />
      ) : !answered ? (
        <List.EmptyView icon={Icon.CircleProgress} title="Loading" />
      ) : entries.length === 0 ? (
        <List.EmptyView
          title={
            query
              ? `Nothing matches "${query}"`
              : state === 'trashed'
                ? 'Trash is empty'
                : 'Nothing here yet'
          }
          actions={<ActionPanel>{listActions}</ActionPanel>}
        />
      ) : (
        entries.map((entry) => (
          <EntryListItem
            key={entry.item.id}
            entry={entry}
            registry={registry}
            showingDetail={showingDetail}
            onChanged={active.revalidate}
            listActions={listActions}
          />
        ))
      )}
    </List>
  );
}
