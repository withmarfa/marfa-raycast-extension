import { ActionPanel, Action, Icon, List, Color } from '@raycast/api';
import { getFavicon } from '@raycast/utils';
import type { ReactNode } from 'react';
import type { Item, Metadata } from '@mymehq/sdk';
import { TYPE_CONFIG, STATE_CONFIG } from '../constants';
import { getItemTitle, getItemUrl, formatTime, formatDate, formatRelativeTime } from '../helpers';
import { ItemDetailView } from './ItemDetailView';
import { ItemActionSections } from './ItemActions';

interface ItemListItemProps {
  item: Item;
  metadata?: Metadata;
  snippet?: string;
  onRefresh: () => void;
  topActions?: ReactNode;
}

export function ItemListItem({
  item,
  metadata,
  snippet,
  onRefresh,
  topActions,
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

  const accessories: List.Item.Accessory[] = [];
  if (stateConfig && item.state !== 'active') {
    accessories.push({ tag: { value: stateConfig.label, color: stateConfig.color } });
  }
  // Show user-curated tags (up to 2) instead of the credential source stamp.
  // Source remains visible on the Detail view alongside other audit fields.
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
          </ActionPanel.Section>
          {topActions}
          <ItemActionSections item={item} metadata={metadata} onRefresh={onRefresh} />
        </ActionPanel>
      }
    />
  );
}
