import { List } from '@raycast/api';

export type TierFilter = 'all' | 'library' | 'feed';

const OPTIONS: { value: TierFilter; title: string }[] = [
  { value: 'all', title: 'All Items' },
  { value: 'library', title: 'Library only' },
  { value: 'feed', title: 'Feed only' },
];

export function TierFilterDropdown({ onChange }: { onChange: (value: TierFilter) => void }) {
  return (
    <List.Dropdown
      tooltip="Tier filter"
      onChange={(value) => onChange(value as TierFilter)}
      storeValue
    >
      {OPTIONS.map((option) => (
        <List.Dropdown.Item key={option.value} title={option.title} value={option.value} />
      ))}
    </List.Dropdown>
  );
}
