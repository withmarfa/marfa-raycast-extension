import { Color } from '@raycast/api';
import { SPACE_PERMISSIONS } from '@withmarfa/shared';

export const STATE_CONFIG: Record<string, { label: string; color: Color }> = {
  active: { label: 'Active', color: Color.Green },
  archived: { label: 'Archived', color: Color.Blue },
  trashed: { label: 'Trashed', color: Color.Red },
};

/** The empty value is the "no filter" sentinel, not a type identifier. */
export const ALL_TYPES_OPTION = { value: '', label: 'All Types' } as const;

/**
 * How a key's administrative reach reads, and how it is coloured. The key list
 * and the key detail both ask, and were answering separately.
 *
 * **Red is for a key that administers the space, not for a rank.** A key
 * holding any space permission can create credentials, change settings or
 * purge past the trash, and that is worth marking; one holding none is an
 * ordinary content credential however wide its type map, which is the
 * distinction the old rank colouring could not draw.
 */
export function spacePermissionSummary(permissions: readonly string[]): {
  label: string;
  color: Color;
} {
  if (permissions.length === 0) return { label: 'content only', color: Color.Blue };
  return {
    label:
      permissions.length === SPACE_PERMISSION_COUNT
        ? 'full access'
        : `${String(permissions.length)} admin`,
    color: Color.Red,
  };
}

/** The eleven, counted once rather than at each caller. */
const SPACE_PERMISSION_COUNT = SPACE_PERMISSIONS.length;
