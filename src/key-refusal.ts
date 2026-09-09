import { forbiddenMessage, scopeRefusedBy, spacePermissionRefusedBy } from './auth/discovery';

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

/**
 * What to say when the server refused a key because the request named more
 * than the credential in hand holds.
 *
 * **A different question from {@link keyRefusal}, and only the two forms can
 * ask it.** Reaching this refusal means the credential already passed the
 * key-management door, so nothing about its authority is in doubt: what is
 * wrong is the request. Sending it through the other answer told somebody
 * their credential could not manage keys on a screen it had just opened by
 * managing keys, and pointed them at a consent screen that would not have
 * helped.
 *
 * `space.keys` is excluded deliberately. This form asks for no space
 * permission at all, so a refusal naming that one is the door rather than the
 * ceiling, and the door has its own answer with a way out on it.
 *
 * **A refusal from this door that names nothing is still this door, and it
 * used to fall through to the answer that contradicts the screen.** The
 * extension refusals carry no `details` — no literal names a namespace, so
 * there is none to attach — and answering `undefined` for them sent the form
 * to "this credential cannot manage API keys, paste one that holds
 * `space.keys`", on a form the credential had opened by managing keys. The
 * server's own sentence is the only thing that says which family was refused,
 * so it is what goes on the form. Safe because `requireSpacePermission`
 * attaches `required_scope` unconditionally: a refusal from the create or
 * update door carrying none is never the door.
 */
export function creatorCeilingRefusal(error: unknown): string | undefined {
  const required = scopeRefusedBy(error);
  if (required === 'space.keys') return undefined;
  if (required === undefined) return forbiddenMessage(error);
  return `This credential does not hold ${required}, and a key cannot be given a permission its creator does not hold. Choose a narrower preset, or "Everything you hold", which copies this credential's own set exactly.`;
}
