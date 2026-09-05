import { Color } from '@raycast/api';

export const STATE_CONFIG: Record<string, { label: string; color: Color }> = {
  active: { label: 'Active', color: Color.Green },
  archived: { label: 'Archived', color: Color.Blue },
  trashed: { label: 'Trashed', color: Color.Red },
};

/** The empty value is the "no filter" sentinel, not a type identifier. */
export const ALL_TYPES_OPTION = { value: '', label: 'All Types' } as const;

/** One definition of what a role looks like. The key list and the key detail
 *  both ask, and were answering separately. */
export function roleColor(role: string): Color {
  return role === 'instance_admin' ? Color.Red : Color.Blue;
}
