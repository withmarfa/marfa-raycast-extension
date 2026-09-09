import { isSpacePermission } from '@withmarfa/shared';
import type { CreateKeyInput } from '@withmarfa/sdk';
import { SIGN_IN_FAMILY, groupScopes } from './scope-groups';

/**
 * The presets the create-key form offers, and what each one puts on the wire.
 *
 * **"Everything" is a claim about the credential in hand, not a list.** A key's
 * permissions are bounded by its creator's, and a request naming no permission
 * at all takes the creator's whole set, so the way to ask for everything the
 * signed-in credential holds is to ask for nothing. Naming the eleven space
 * permissions instead asks for a set no sign-in has ever held — a sign-in is
 * offered exactly one of them on the consent screen — and the server refuses
 * the mint on the first one the credential is missing.
 *
 * Pure and separate from the form, because what a preset sends is the whole of
 * the question and a form component is not a thing a test can reach.
 */

export const EVERYTHING_PRESET_ID = 'everything';
export const CONTENT_WRITE_PRESET_ID = 'content-write';
export const CONTENT_READ_PRESET_ID = 'content-read';
export const CUSTOM_PRESET_ID = 'custom';

export type PresetId =
  typeof EVERYTHING_PRESET_ID | typeof CONTENT_WRITE_PRESET_ID | typeof CONTENT_READ_PRESET_ID;

export interface KeyPreset {
  id: PresetId;
  label: string;
}

/**
 * **Each label says what the key will be able to do, not how wide it sounds.**
 * The first one used to read "Everything (the whole space, administration
 * included)", which described a set the form then asked for by name and no
 * sign-in could be given.
 */
export const KEY_PRESETS: readonly KeyPreset[] = [
  { id: EVERYTHING_PRESET_ID, label: 'Everything you hold' },
  { id: CONTENT_WRITE_PRESET_ID, label: 'Content, read and write' },
  { id: CONTENT_READ_PRESET_ID, label: 'Content, read only' },
];

export function isPresetId(value: string): value is PresetId {
  return KEY_PRESETS.some((preset) => preset.id === value);
}

/** The permission-bearing half of a create request. */
export type PresetPermissionFields = Pick<
  CreateKeyInput,
  | 'space_permissions'
  | 'default_tier'
  | 'type_permissions'
  | 'extension_permissions'
  | 'edge_permissions'
  | 'metadata_permissions'
>;

/**
 * What a preset contributes to the create body.
 *
 * **Absent and empty are different answers and the two content presets rely on
 * the difference.** The server reads an absent `space_permissions` as the
 * creator's whole set and an empty one as none at all, so a content key has to
 * name the empty list while "Everything you hold" has to name nothing. The
 * same rule governs the four content maps, which is why the first preset omits
 * the default tier too: a request that names nothing names nothing.
 */
export function presetPermissionFields(id: PresetId): PresetPermissionFields {
  if (id === EVERYTHING_PRESET_ID) return {};
  const access = id === CONTENT_WRITE_PRESET_ID ? 'write' : 'read';
  return {
    space_permissions: [],
    default_tier: 'library',
    type_permissions: { '*': access },
    extension_permissions: { '*': access },
    edge_permissions: { '*': access },
    metadata_permissions: { types: access },
  };
}

/**
 * What the credential signing this request is known to hold.
 *
 * `granted` is the scope string the server reported for a browser sign-in, and
 * `undefined` means it reported none rather than that it granted none.
 */
export interface CredentialReach {
  staticKey: boolean;
  granted: string | undefined;
  /** The grant is still being read, so nothing here is an answer yet. */
  loading?: boolean;
}

const CLAMP_NOTE =
  'Clamped to what this credential holds: the server refuses any part of it this credential does not hold itself.';

/**
 * The text under the form, describing what the selected preset will produce.
 *
 * **The first preset reads from the credential and the other two read from
 * themselves, because that is the difference between them.** A named set is
 * the same whoever sends it; "everything you hold" is a different set for
 * every credential, and stating it from a constant is what told an operator he
 * was about to create a key holding eleven permissions his sign-in had never
 * held.
 */
export function presetSummary(id: PresetId, credential: CredentialReach): string {
  if (id !== EVERYTHING_PRESET_ID) return namedPresetSummary(id);
  return everythingSummary(credential);
}

const COPIES_THE_CREDENTIAL =
  "This asks for no permission at all, so the key is minted with a copy of this credential's own set. It cannot exceed it, because nothing can hold more than whoever created it.";

function everythingSummary(credential: CredentialReach): string {
  if (credential.loading) {
    return [COPIES_THE_CREDENTIAL, 'Reading what this credential holds...'].join('\n\n');
  }

  // **Two credentials cannot be described and both say so rather than
  // guessing.** A pasted key is stored only as a hash, so no row on the
  // instance can be matched back to it, and the tokens of an earlier browser
  // sign-in survive in storage beside it — reading those would describe a
  // credential no request is using. A sign-in whose scopes the server did not
  // report is not evidence of a narrow grant either, which is the rule the
  // whole auth surface already runs on. Neither is a reason not to mint: the
  // server knows the set even when this screen cannot.
  if (credential.staticKey) {
    return [
      COPIES_THE_CREDENTIAL,
      'What that set is cannot be listed here. A pasted key is stored as a hash, so nothing matches it back to its row.',
    ].join('\n\n');
  }
  if (!credential.granted) {
    return [
      COPIES_THE_CREDENTIAL,
      "What that set is cannot be listed here, because the server did not report this sign-in's scopes.",
    ].join('\n\n');
  }

  const held = credential.granted.split(/\s+/).filter(Boolean);
  const spacePermissions = held.filter(isSpacePermission);
  // Everything else goes through the same grouping the permissions screen
  // uses, and the sign-in family drops out of it: `openid` and `profile` say
  // who signed in rather than what a key could reach, and listing them invites
  // somebody to read them as content.
  const reach = groupScopes(held.filter((scope) => !isSpacePermission(scope)))
    .filter((family) => family.name !== SIGN_IN_FAMILY)
    .flatMap((family) => family.groups)
    .map((group) =>
      group.accesses.length > 0
        ? `${group.resource} (${group.accesses.join(', ')})`
        : group.resource,
    );

  return [
    COPIES_THE_CREDENTIAL,
    `Space permissions: ${spacePermissions.join(', ') || 'none'}`,
    `Content and operations: ${reach.join(', ') || 'none'}`,
  ].join('\n\n');
}

function namedPresetSummary(id: PresetId): string {
  const fields = presetPermissionFields(id);
  return [
    // Named rather than derived, so the empty list reads as the decision it is
    // rather than as a set nobody filled in.
    'Space permissions: none',
    `Default tier: ${fields.default_tier ?? 'library'}`,
    `Types: ${describePermissionMap(fields.type_permissions)}`,
    `Extensions: ${describePermissionMap(fields.extension_permissions)}`,
    `Edges: ${describePermissionMap(fields.edge_permissions)}`,
    `Metadata: ${describePermissionMap(fields.metadata_permissions)}`,
    CLAMP_NOTE,
  ].join('\n');
}

/**
 * One permission map as a line of prose.
 *
 * Exported because the screen showing a key that was just minted asks the same
 * question of the key's own row, and two spellings of "no access" on two
 * screens describing one key is how somebody concludes the mint did something
 * other than what the form said it would.
 */
export function describePermissionMap(map: Record<string, string> | undefined): string {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return 'none';
  return entries.map(([pattern, access]) => `${pattern}: ${access}`).join(', ');
}
