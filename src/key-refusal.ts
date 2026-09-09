import { spacePermissionRefusedBy } from './auth/discovery';

/**
 * What to say when the server refuses a key operation.
 *
 * **One home because four surfaces ask** — the list, the detail's revoke, the
 * create form and the edit form — and a refusal explained one way on the screen
 * that lists keys and another on the form that makes one is worse than a bare
 * status code. All four once said "Admin credentials required", which was the
 * only answer available while a rank was the only fence.
 *
 * **Three answers now, and telling them apart is the point.** A refusal naming
 * `space.keys` is a permission nobody ticked, and the consent screen fixes it.
 * One naming a different permission is real and this extension cannot ask for
 * it, so promising re-consent would rebuild the dead end this split exists to
 * remove. One naming nothing is a credential that simply does not hold the
 * permission — an API key pasted into Preferences, most often — and no consent
 * screen reaches a key.
 */

/** The permission was never granted, and the consent screen is the way out. */
export const KEY_MANAGEMENT_NOT_GRANTED =
  'This sign-in was not given permission to manage API keys. Review what Marfa shares to grant it — the permission is a row you tick on the consent screen, and a key made from a sign-in can only reach what that sign-in already can.';

/** The credential holds no permission to manage keys, and no consent screen
 *  reaches a credential. */
export const KEY_MANAGEMENT_NEEDS_PERMISSION =
  'This credential cannot manage API keys. Paste one that holds `space.keys` in Preferences, or sign in instead — a sign-in can be granted the permission on the consent screen.';

export interface KeyRefusal {
  /** Toast or empty-state title. */
  title: string;
  /** The longer form, for a surface with room for it. */
  description: string;
  /** Whether re-consenting could change the answer. */
  reconsentHelps: boolean;
}

/**
 * Which of the three refusals this is, read from the server's own words rather
 * than inferred from local state: a stored grant can be stale, and the server
 * is the only thing that knows what the credential in hand actually holds.
 *
 * **`reconsentHelps` asks whether re-consent would actually help, which is
 * narrower than whether a permission was named.** Re-consent requests exactly
 * `REQUESTED_SPACE_PERMISSIONS`, so it can only ever obtain `space.keys`. A
 * refusal naming any other permission is one this extension cannot satisfy by
 * asking again, and promising otherwise rebuilds the dead end this whole split
 * exists to remove.
 */
export function keyRefusal(error: unknown): KeyRefusal {
  const required = spacePermissionRefusedBy(error);
  if (required === 'space.keys') {
    return {
      title: 'Permission to manage keys was not granted',
      description: KEY_MANAGEMENT_NOT_GRANTED,
      reconsentHelps: true,
    };
  }
  if (required) {
    return {
      title: 'This sign-in is missing a permission',
      description: `The server refused this because the sign-in does not carry ${required}, which Raycast never asks for. Somebody whose credential holds it can make the change instead.`,
      reconsentHelps: false,
    };
  }
  return {
    title: 'This credential cannot manage keys',
    description: KEY_MANAGEMENT_NEEDS_PERMISSION,
    reconsentHelps: false,
  };
}
