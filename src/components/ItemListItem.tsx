import { ActionPanel, Action, Icon, List } from '@raycast/api';
import { getFavicon } from '@raycast/utils';
import type { ReactNode } from 'react';
import type { Item, Metadata } from '@withmarfa/sdk';
import { STATE_CONFIG } from '../constants';
import { getItemUrl, formatTime, formatDate, formatRelativeTime } from '../helpers';
import type { TypeRegistry } from '../type-display';
import { ItemDetailView } from './ItemDetailView';
import { ItemInlineDetail } from './ItemInlineDetail';
import { ItemActionSections } from './ItemActions';

interface ItemListItemProps {
  item: Item;
  metadata?: Metadata;
  registry: TypeRegistry;
  snippet?: string;
  /** Appended to the row's own keywords. A caller that knows why a row is here,
   *  such as the query a server hit matched, adds it so Raycast's native filter
   *  cannot hide a row that was fetched precisely because it matched. */
  keywords?: string[];
  onRefresh: () => void;
  topActions?: ReactNode;
  /** When true, render the inline `<List.Item.Detail>` panel and drop
   *  accessories, per the Raycast guideline: one source of truth for the
   *  metadata when the side panel is showing. */
  showInlineDetail?: boolean;
  /** Wired by the parent so the toggle action is consistent across every
   *  list item (and visible in the action panel of empty list states too). */
  onToggleDetail?: () => void;
  isShowingDetail?: boolean;
}

export function ItemListItem({
  item,
  metadata,
  registry,
  snippet,
  keywords,
  onRefresh,
  topActions,
  showInlineDetail,
  onToggleDetail,
  isShowingDetail,
}: ItemListItemProps) {
  const typeLabel = registry.label(item.type);
  const { icon: typeIcon, color: typeColor } = registry.appearance(item.type);
  const stateConfig = STATE_CONFIG[item.state];
  const url = getItemUrl(item);

  // The type's own glyph, always. A favicon used to win whenever an item
  // carried a URL, which is most of them once integrations are syncing, so a
  // list holding a note, a bookmark, a video and an article showed three
  // websites and one glyph. The resolver exists precisely so a book, a song and
  // a film are told apart at a glance, and that is worth more in a mixed list
  // than the site is. The favicon still says which site, one column over.
  const icon = { source: typeIcon, tintColor: typeColor };

  const toggleAction = onToggleDetail ? (
    <Action
      title={isShowingDetail ? 'Hide Details' : 'Show Details'}
      icon={Icon.Sidebar}
      shortcut={{ modifiers: ['cmd'], key: 'd' }}
      onAction={onToggleDetail}
    />
  ) : null;

  if (showInlineDetail) {
    return (
      <List.Item
        id={item.id}
        title={registry.titleOf(item)}
        icon={icon}
        keywords={[typeLabel, item.type, ...(metadata?.tags ?? []), ...(keywords ?? [])]}
        detail={
          <ItemInlineDetail item={item} metadata={metadata} snippet={snippet} registry={registry} />
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              {url && <Action.OpenInBrowser url={url} />}
              <Action.Push
                title="View Detail"
                icon={Icon.Eye}
                target={<ItemDetailView itemId={item.id} onRefresh={onRefresh} />}
                shortcut={url ? { modifiers: ['cmd'], key: 'return' } : undefined}
              />
              {toggleAction}
            </ActionPanel.Section>
            {topActions}
            <ItemActionSections
              item={item}
              metadata={metadata}
              registry={registry}
              onRefresh={onRefresh}
            />
          </ActionPanel>
        }
      />
    );
  }

  const accessories: List.Item.Accessory[] = [];
  if (stateConfig && item.state !== 'active') {
    accessories.push({ tag: { value: stateConfig.label, color: stateConfig.color } });
  }
  for (const tag of (metadata?.tags ?? []).slice(0, 2)) {
    accessories.push({ tag });
  }
  if (url) {
    // After the tags and before the timestamp. The timestamp is the one
    // accessory every row carries, so it keeps the rightmost slot and stays in
    // the same place down the list.
    //
    // The fallback is deliberately not `Icon.Link`, which is the curated glyph
    // for a bookmark: a favicon that fails to resolve would then render a link
    // icon at both ends of the row, two identical marks carrying nothing, which
    // is the duplication moving the favicon here was meant to remove.
    accessories.push({ icon: getFavicon(url, { fallback: Icon.Globe }), tooltip: url });
  }
  accessories.push({
    text: formatRelativeTime(item.timestamp),
    tooltip: `${formatDate(item.timestamp)} ${formatTime(item.timestamp)}`,
  });

  return (
    <List.Item
      id={item.id}
      title={registry.titleOf(item)}
      subtitle={snippet}
      icon={icon}
      accessories={accessories}
      keywords={[typeLabel, item.type, ...(metadata?.tags ?? []), ...(keywords ?? [])]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {url && <Action.OpenInBrowser url={url} />}
            <Action.Push
              title="View Detail"
              icon={Icon.Eye}
              target={<ItemDetailView itemId={item.id} onRefresh={onRefresh} />}
              shortcut={url ? { modifiers: ['cmd'], key: 'return' } : undefined}
            />
            {toggleAction}
          </ActionPanel.Section>
          {topActions}
          <ItemActionSections
            item={item}
            metadata={metadata}
            registry={registry}
            onRefresh={onRefresh}
          />
        </ActionPanel>
      }
    />
  );
}
