import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from '@raycast/api';
import { useCachedPromise, useCachedState } from '@raycast/utils';
import { setTimeout as sleep } from 'node:timers/promises';
import { useEffect, useState } from 'react';
import { describeJob, followJob } from './bulk-job';
import { EntryListItem } from './components/EntryListItem';
import { FailureEmptyView } from './components/FailureEmptyView';
import { groupByDay } from './dates';
import { NOTE_TYPE } from './display';
import { describeFailure, MarfaRequestError } from './failure';
import { showFailure } from './feedback';
import {
  bulkJob,
  countTrash,
  emptyTrash,
  type Entry,
  listItems,
  searchItems,
  type StateFilter,
  type TierFilter,
} from './marfa';
import { sameIds } from './requests';
import { useRegistry } from './use-registry';

const STATES: Array<{ value: StateFilter; title: string }> = [
  { value: 'active', title: 'Active' },
  { value: 'archived', title: 'Archived' },
  { value: 'trashed', title: 'Trash' },
  { value: 'any', title: 'All States' },
];

const TIERS: Array<{ value: TierFilter; title: string }> = [
  { value: 'all', title: 'All Tiers' },
  { value: 'library', title: 'Library' },
  { value: 'feed', title: 'Feed' },
];

const ALL_TYPES = '';

/**
 * Every item, newest change first under the day it changed, and full-text
 * search on the same bar.
 *
 * An empty bar walks the list page by page; typing hands the text to the
 * server's search, which reaches past the loaded pages, except in the Trash,
 * which the search index leaves out. The list is read again on every open, so
 * a change made in another app shows the next time Browse is opened, or at
 * once with Refresh.
 */
export default function Browse() {
  const [query, setQuery] = useState('');
  const [type, setType] = useCachedState('browse-type', NOTE_TYPE);
  const [state, setState] = useState<StateFilter>('active');
  const [tier, setTier] = useCachedState<TierFilter>('browse-tier', 'all');
  const [showingDetail, setShowingDetail] = useCachedState('browse-show-detail', true);

  // Silent on failure: whatever stops the registry stops the listing too,
  // which says so, and without it types read by their identifiers.
  const types = useRegistry();
  const registry = types.registry;

  // The server's search index leaves out the Trash, so in the Trash typed text
  // filters the loaded rows instead of asking the server.
  const searching = query !== '' && state !== 'trashed';

  const listing = useCachedPromise(
    (typeFilter: string, stateFilter: StateFilter, tierFilter: TierFilter) =>
      async (options: { cursor?: string }) => {
        const page = await listItems({
          type: typeFilter || undefined,
          state: stateFilter,
          tier: tierFilter,
          cursor: options.cursor,
        });
        return {
          data: page.entries,
          hasMore: page.cursor !== null,
          cursor: page.cursor ?? undefined,
        };
      },
    [type, state, tier],
    { execute: !searching, keepPreviousData: true, onError: () => undefined },
  );

  const search = useCachedPromise(
    (q: string, typeFilter: string, stateFilter: StateFilter, tierFilter: TierFilter) =>
      searchItems({
        query: q,
        type: typeFilter || undefined,
        state: stateFilter,
        tier: tierFilter,
      }),
    [query, type, state, tier],
    { execute: searching, keepPreviousData: true, onError: () => undefined },
  );

  const active = searching ? search : listing;
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

  async function emptyTheTrash() {
    let counted: { count: number; ids: string[] };
    try {
      counted = await countTrash();
    } catch (error) {
      await showFailure(error, 'Counting the Trash');
      return;
    }
    const { count } = counted;
    if (count === 0) {
      await showToast({ style: Toast.Style.Success, title: 'Nothing in the Trash to delete' });
      refresh();
      return;
    }
    const confirmed = await confirmAlert({
      title: 'Empty the Trash?',
      message: `${count === 1 ? 'The 1 item' : `All ${String(count)} items`} in the Trash that this key may delete, in every app and not only those listed here, will be deleted for good. This cannot be undone.`,
      primaryAction: { title: 'Empty Trash', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Emptying the Trash' });
    let started;
    try {
      // The purge matches again when it starts and takes no ids, so it starts
      // only when the Trash holds the very items the person confirmed.
      const now = await countTrash();
      if (!sameIds(now.ids, counted.ids)) {
        toast.style = Toast.Style.Failure;
        toast.title = 'The Trash changed since it was counted';
        toast.message = 'Nothing was deleted. Empty it again to confirm what is there now.';
        refresh();
        return;
      }
      started = await emptyTrash(count);
    } catch (error) {
      await toast.hide();
      if (error instanceof MarfaRequestError && error.code === 'bulk_cap_exceeded') {
        await showToast({
          style: Toast.Style.Failure,
          title: 'The Trash changed since it was counted',
          message: 'Nothing was deleted. Empty it again to confirm what is there now.',
        });
        refresh();
        return;
      }
      await showFailure(error, 'Emptying the Trash');
      return;
    }
    try {
      const result = describeJob(await followJob(started, bulkJob, (ms) => sleep(ms)));
      toast.style = result.ok ? Toast.Style.Success : Toast.Style.Failure;
      toast.title = result.title;
      // A narrower key purges only the types it may write; say what it left.
      const left = (await listItems({ state: 'trashed', limit: 1 })).entries.length > 0;
      toast.message = left
        ? `${result.message}; what this key may not delete stays in the Trash`
        : result.message;
    } catch (error) {
      // The job was started and runs on without Raycast; only following it failed.
      toast.style = Toast.Style.Failure;
      toast.title = 'The server is emptying the Trash';
      toast.message = `Raycast lost track of it: ${describeFailure(error).message}`;
    }
    refresh();
  }

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
      <ActionPanel.Submenu
        title="Show Tier"
        icon={Icon.Layers}
        shortcut={{ modifiers: ['cmd', 'shift'], key: 'l' }}
      >
        {TIERS.map((option) => (
          <Action
            key={option.value}
            title={option.title}
            icon={option.value === tier ? Icon.Checkmark : undefined}
            onAction={() => setTier(option.value)}
          />
        ))}
      </ActionPanel.Submenu>
      {state === 'trashed' && (
        <Action
          title="Empty Trash"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={Keyboard.Shortcut.Common.RemoveAll}
          onAction={emptyTheTrash}
        />
      )}
    </ActionPanel.Section>
  );

  const stateTitle = STATES.find((option) => option.value === state)?.title ?? state;
  const tierTitle = TIERS.find((option) => option.value === tier)?.title ?? tier;
  const filterTitle = [
    state === 'active' ? undefined : stateTitle,
    tier === 'all' ? undefined : tierTitle,
  ]
    .filter(Boolean)
    .join(', ');
  // Until the first answer arrives, an empty list is loading, not empty.
  const answered = active.data !== undefined || active.error !== undefined;

  const row = (entry: Entry) => (
    <EntryListItem
      key={entry.item.id}
      entry={entry}
      registry={registry}
      showingDetail={showingDetail}
      onChanged={active.revalidate}
      listActions={listActions}
    />
  );

  return (
    <List
      isLoading={active.isLoading || !answered}
      filtering={state === 'trashed'}
      throttle
      onSearchTextChange={(text) => setQuery(text.trim())}
      searchBarPlaceholder={filterTitle ? `Search ${filterTitle}` : 'Search'}
      navigationTitle={filterTitle || undefined}
      pagination={searching ? undefined : listing.pagination}
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
      ) : searching ? (
        // Search answers in order of relevance, which day headings would scatter.
        entries.map(row)
      ) : (
        groupByDay(entries, (entry) => entry.item.updated_at).map(([day, rows]) => (
          <List.Section key={day} title={day}>
            {rows.map(row)}
          </List.Section>
        ))
      )}
    </List>
  );
}
