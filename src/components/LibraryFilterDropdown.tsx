import { List } from '@raycast/api';

export type LibraryFilter = 'all' | 'library' | 'ambient';

const OPTIONS: { value: LibraryFilter; title: string }[] = [
  { value: 'all', title: 'All Items' },
  { value: 'library', title: 'Library only' },
  { value: 'ambient', title: 'Ambient only' },
];

export function LibraryFilterDropdown({ onChange }: { onChange: (value: LibraryFilter) => void }) {
  return (
    <List.Dropdown
      tooltip="Library filter"
      onChange={(value) => onChange(value as LibraryFilter)}
      storeValue
    >
      {OPTIONS.map((option) => (
        <List.Dropdown.Item key={option.value} title={option.title} value={option.value} />
      ))}
    </List.Dropdown>
  );
}
