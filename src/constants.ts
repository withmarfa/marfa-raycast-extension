import { Color } from '@raycast/api';
import type { PlatformTypeId } from '@withmarfa/shared';

export const STATE_CONFIG: Record<string, { label: string; color: Color }> = {
  active: { label: 'Active', color: Color.Green },
  archived: { label: 'Archived', color: Color.Blue },
  trashed: { label: 'Trashed', color: Color.Red },
};

/**
 * The types Quick Capture can build a native form for.
 *
 * This list is hardcoded on purpose, and it is a different kind of thing
 * from a display map: it says what this extension knows how to *render a
 * form for*, rather than what exists on the server. Every other type is offered in
 * the same dropdown and captured through the generic properties editor, so
 * a type missing from here is still capturable, it just does not get
 * bespoke fields.
 *
 * Labels are resolved from the registry like everywhere else; the label
 * here is only the fallback used before the schema list arrives.
 */
export const CAPTURE_TYPES = [
  { value: 'core.note', label: 'Note' },
  { value: 'core.bookmark', label: 'Bookmark' },
  { value: 'core.task', label: 'Task' },
  { value: 'core.event', label: 'Event' },
] as const satisfies readonly { value: PlatformTypeId; label: string }[];

/** The empty value is the "no filter" sentinel, not a type identifier. */
export const ALL_TYPES_OPTION = { value: '', label: 'All Types' } as const;

/** One definition of what a role looks like. The key list and the key detail
 *  both ask, and were answering separately. */
export function roleColor(role: string): Color {
  return role === 'instance_admin' ? Color.Red : Color.Blue;
}
