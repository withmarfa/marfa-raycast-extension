import { ActionPanel, Action, Icon, List, Color } from '@raycast/api';
import { getFavicon } from '@raycast/utils';
import type { ReactNode } from 'react';
import type { Item, Metadata } from '@withmarfa/sdk';
import { TYPE_CONFIG, STATE_CONFIG } from '../constants';
import { getItemTitle, getItemUrl, formatTime, formatDate, formatRelativeTime } from '../helpers';
import { ItemDetailView } from './ItemDetailView';
import { ItemInlineDetail } from './ItemInlineDetail';
import { ItemActionSections } from './ItemActions';

interface ItemListItemProps {
  item: Item;
  metadata?: Metadata;
  snippet?: string;
  onRefresh: () => void;
  topActions?: ReactNode;
  /** When true, render the inline `<List.Item.Detail>` panel and drop
   *  accessories (per the Raycast guideline — keep one source of truth for
   *  the metadata when the side panel is showing). */
  showInlineDetail?: boolean;
  /** Wired by the parent so the toggle action is consistent across every
   *  list item (and visible in the action panel of empty list states too). */
  onToggleDetail?: () => void;
  isShowingDetail?: boolean;
}

export function ItemListItem({
  item,
  metadata,
  snippet,
  onRefresh,
  topActions,
  showInlineDetail,
  onToggleDetail,
  isShowingDetail,
}: ItemListItemProps) {
  const typeConfig = TYPE_CONFIG[item.type] ?? {
    label: item.type,
    icon: Icon.Circle,
    color: Color.PrimaryText,
  };
  const stateConfig = STATE_CONFIG[item.state];
  const url = getItemUrl(item);

  const icon = url
    ? getFavicon(url, { fallback: Icon.Link })
    : { source: typeConfig.icon, tintColor: typeConfig.color };

  const toggleAction = onToggleDetail ? (
    <Action
      title={isShowingDetail ? 'Hide Details' : 'Show Details'}
      icon={Icon.Sidebar}
      shortcut={{ modifiers: ['cmd'], key: 'd' }}
      onAction={onToggleDetail}
    />
  ) : null;

  if (showInlineDetail) {
    // With the inline panel on, Raycast guidance is: drop accessories.
    return (
      <List.Item
        id={item.id}
        title={getItemTitle(item)}
        icon={icon}
        keywords={[typeConfig.label, ...(metadata?.tags ?? [])]}
        detail={<ItemInlineDetail item={item} metadata={metadata} snippet={snippet} />}
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
            <ItemActionSections item={item} metadata={metadata} onRefresh={onRefresh} />
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
  accessories.push({
    text: formatRelativeTime(item.timestamp),
    tooltip: `${formatDate(item.timestamp)} ${formatTime(item.timestamp)}`,
  });

  return (
    <List.Item
      id={item.id}
      title={getItemTitle(item)}
      subtitle={snippet}
      icon={icon}
      accessories={accessories}
      keywords={[typeConfig.label, ...(metadata?.tags ?? [])]}
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
          <ItemActionSections item={item} metadata={metadata} onRefresh={onRefresh} />
        </ActionPanel>
      }
    />
  );
}
