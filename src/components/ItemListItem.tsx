import { ActionPanel, Action, Icon, List, Color } from '@raycast/api';
import type { Item, Metadata } from '@mymehq/sdk';
import { TYPE_CONFIG, STATE_CONFIG } from '../constants';
import { getItemTitle, getItemSubtitle, formatTime } from '../helpers';
import { ItemDetailView } from './ItemDetailView';
import { ItemActionSections } from './ItemActions';

interface ItemListItemProps {
  item: Item;
  metadata?: Metadata;
  snippet?: string;
  onRefresh: () => void;
}

export function ItemListItem({ item, metadata, snippet, onRefresh }: ItemListItemProps) {
  const typeConfig = TYPE_CONFIG[item.type] ?? { label: item.type, icon: Icon.Circle, color: Color.PrimaryText };
  const stateConfig = STATE_CONFIG[item.state];

  const accessories: List.Item.Accessory[] = [
    { tag: { value: typeConfig.label, color: typeConfig.color } },
  ];
  if (stateConfig && item.state !== 'active') {
    accessories.push({ tag: { value: stateConfig.label, color: stateConfig.color } });
  }
  accessories.push({ text: formatTime(item.timestamp) });
  if (metadata?.tags) {
    for (const tag of metadata.tags.slice(0, 2)) {
      accessories.push({ tag: { value: tag } });
    }
  }

  return (
    <List.Item
      id={item.id}
      title={getItemTitle(item)}
      subtitle={snippet ?? getItemSubtitle(item)}
      icon={{ source: typeConfig.icon, tintColor: typeConfig.color }}
      accessories={accessories}
      keywords={[typeConfig.label, ...(metadata?.tags ?? [])]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.Push
              title="View Detail"
              icon={Icon.Eye}
              target={<ItemDetailView itemId={item.id} onRefresh={onRefresh} />}
            />
          </ActionPanel.Section>
          <ItemActionSections item={item} metadata={metadata} onRefresh={onRefresh} />
        </ActionPanel>
      }
    />
  );
}
