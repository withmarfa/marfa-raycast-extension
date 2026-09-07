import { capabilityRefusedBy } from './auth/discovery';

/**
 * What to say when the server refuses a key operation.
 *
 * **One home because four surfaces ask** — the list, the detail's revoke, the
 * create form and the edit form — and a refusal explained one way on the screen
 * that lists keys and another on the form that makes one is worse than a bare
 * status code. All four previously said "Admin credentials required", which was
 * the only answer available when role was the only fence.
 *
 * It is now two answers, and telling them apart is the point. A refusal naming
 * a capability is a permission nobody ticked, and the consent screen fixes it.
 * One naming none is role, and the consent screen offers nothing for it —
 * sending somebody there for a role they lack is a loop with no exit.
 */

/** The permission was never granted, and the consent screen is the way out. */
export const KEY_MANAGEMENT_NOT_GRANTED =
  'This sign-in was not given permission to manage API keys. Review what Marfa shares to grant it — the permission is a row you tick on the consent screen, and a key made from a sign-in can only reach what that sign-in already can.';

/** The credential is not admin-shaped, which no consent screen can change. */
export const KEY_MANAGEMENT_NEEDS_ADMIN =
  "This account doesn't have admin role. Ask an admin of this space, sign in with an admin account, or paste an admin API key in Preferences.";

export interface KeyRefusal {
  /** Toast or empty-state title. */
  title: string;
  /** The longer form, for a surface with room for it. */
  description: string;
  /** Whether re-consenting could change the answer. */
  reconsentHelps: boolean;
}

/**
 * Which of the two refusals this is, read from the server's own words rather
 * than inferred from local state — a stored grant can be stale, and only the
 * server knows about role.
 */
export function keyRefusal(error: unknown): KeyRefusal {
  return capabilityRefusedBy(error)
    ? {
        title: 'Permission to manage keys was not granted',
        description: KEY_MANAGEMENT_NOT_GRANTED,
        reconsentHelps: true,
      }
    : {
        title: 'Admin role required',
        description: KEY_MANAGEMENT_NEEDS_ADMIN,
        reconsentHelps: false,
      };
}
