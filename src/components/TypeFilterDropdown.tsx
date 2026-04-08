import { List } from '@raycast/api';
import { ALL_TYPES } from '../constants';

export function TypeFilterDropdown({ onChange }: { onChange: (value: string) => void }) {
  return (
    <List.Dropdown tooltip="Filter by Type" onChange={onChange} storeValue>
      {ALL_TYPES.map((type) => (
        <List.Dropdown.Item key={type.value} title={type.label} value={type.value} />
      ))}
    </List.Dropdown>
  );
}
