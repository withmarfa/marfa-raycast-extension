import {
  isSpacePermission,
  parseScope,
  scopesToEdgePermissions,
  scopesToMetadataPermissions,
  scopesToProfilePermissions,
  scopesToTypePermissions,
} from '@withmarfa/shared';
import type { CreateKeyInput } from '@withmarfa/sdk';
import { SIGN_IN_FAMILY, groupScopes } from './scope-groups';

/**
 * The presets the create-key form offers, and what each one puts on the wire.
 *
 * **Every preset is a claim about the credential in hand, not a list.** A key's
 * permissions are bounded by its creator's, and a request naming no permission
 * at all takes the creator's whole set, so the way to ask for everything the
 * signed-in credential holds is to ask for nothing. Naming the eleven space
 * permissions instead asks for a set no sign-in has ever held — a sign-in is
 * offered exactly one of them on the consent screen — and the server refuses
 * the mint on the first one the credential is missing.
 *
 * **The same was true of the content presets through a third family.** Both
 * named `type_permissions: {"*": <access>}`, the global wildcard, which reaches
 * every registered type including the system namespace. No permission bundle
 * confers it: every content bundle names concrete types, so a session mint was
 * refused on the type axis whatever the person had ticked. What they ask for
 * now is the credential's own content reach — derived by the server for read
 * and write, computed here for read only, because the server has one derive
 * and it copies the creator whole.
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
  | 'profile_permissions'
>;

/**
 * The four families a permission map can be measured against a grant on.
 *
 * Extensions are absent deliberately: no scope names an extension namespace,
 * so a session has nothing to be measured on that axis and the server refuses
 * any non-empty map from one outright. A key carries namespaces on its own
 * row, which is why the static path below can still ask for them.
 */
type ContentReach = Pick<
  PresetPermissionFields,
  'type_permissions' | 'edge_permissions' | 'metadata_permissions' | 'profile_permissions'
>;

/**
 * One granted scope narrowed to read, or null when it names no reach a
 * permission map can carry.
 *
 * `openid`, `email` and `offline_access` say who signed in and for how long;
 * a space permission names an administrative surface the content presets
 * deliberately hand over none of. All of them parse to an operation of
 * `none`, so the filter is the platform's classification rather than a list
 * of prefixes to skip — a family this build has never heard of is dropped
 * rather than projected into a content map by accident.
 */
function narrowedToRead(scope: string): string | null {
  const parsed = parseScope(scope);
  if (parsed === null || parsed.operation === 'none') return null;
  if (parsed.kind === 'oidc' || parsed.kind === 'space') return null;
  return `${scope.slice(0, scope.lastIndexOf(':'))}:read`;
}

/**
 * A credential's own content reach, projected the way the platform projects
 * it.
 *
 * **These four projections are the server's own, and reaching for them rather
 * than writing the fifth hand-rolled scope walker is the rule this repository
 * already runs on.** The bearer middleware builds a session's synthetic key
 * with exactly these calls over exactly these scopes, so what they return
 * here is what the server will derive there — the summary and the mint cannot
 * disagree about what a key is going to hold.
 *
 * At `read` every literal is narrowed first, so a grant of `core.note:write`
 * asks for `core.note: read` and the request stays inside what the credential
 * holds on every axis the mint measures.
 *
 * **One grant would come back out wider than it went in, and it is the one no
 * instance hands out.** The content category is not a type pattern, so the
 * platform projects `content:read` to the global wildcard with the system
 * namespace denied beside it — an accurate description of the category and a
 * literal the mint's own coverage check refuses. Dropping it instead would
 * hand back a key that reads nothing while the screen said it read
 * everything, which is the worse of the two. No bundle confers the category,
 * so this is reachable only from an instance that adds one, and it arrives as
 * a refusal naming `*:read` rather than as a key nobody can use.
 */
function reachFromGrant(granted: string, level: 'read' | 'write'): ContentReach {
  const held = granted.split(/\s+/).filter(Boolean);
  const scopes =
    level === 'write'
      ? held
      : [...new Set(held.map(narrowedToRead).filter((scope): scope is string => scope !== null))];
  return {
    type_permissions: scopesToTypePermissions(scopes),
    edge_permissions: scopesToEdgePermissions(scopes),
    metadata_permissions: scopesToMetadataPermissions(scopes),
    profile_permissions: scopesToProfilePermissions(scopes),
  };
}

/**
 * Read across everything, for a credential whose own reach cannot be read.
 *
 * **The global wildcard is right here and wrong for a sign-in, and the
 * difference is which comparison the server runs.** A pasted key is measured
 * map against map, so a key holding `{"*": "write"}` covers this and a
 * narrower one is refused by name. A session is measured literal by literal
 * against its granted scopes, and no bundle confers `*:read`, so the same
 * request from a sign-in is refused whatever that sign-in holds.
 */
const WILDCARD_READ: ContentReach = {
  type_permissions: { '*': 'read' },
  edge_permissions: { '*': 'read' },
  metadata_permissions: { types: 'read' },
  profile_permissions: { '*': 'read' },
};

/**
 * What a preset contributes to the create body.
 *
 * **Absent and empty are different answers and both content presets rely on
 * the difference.** The server reads an absent `space_permissions` as the
 * creator's whole set and an empty one as none at all, so a content key has
 * to name the empty list while "Everything you hold" has to name nothing.
 *
 * **"Content, read and write" names no content family either, and that is the
 * whole of it.** A body naming none of the five takes the creator's content
 * set, so the preset is "everything you hold, minus the administrative half"
 * expressed as the one request that cannot ask for more than the credential
 * has. It reads the same for a key and for a sign-in because the server
 * derives from whichever is signing.
 *
 * **"Content, read only" has nothing to derive from, so it is computed.** The
 * server has one derive and it copies the creator whole; there is no "copy me
 * narrowed". So the request has to name the set, and the only honest set is
 * the credential's own reach at read: for a sign-in the granted scopes
 * narrowed and projected, for a pasted key the wildcard the server clamps
 * against the key's own row.
 */
export function presetPermissionFields(
  id: PresetId,
  credential: CredentialReach,
): PresetPermissionFields {
  if (id === EVERYTHING_PRESET_ID) return {};
  // Named rather than derived, and the only two fields the read-and-write
  // preset sends: an empty list is the decision to hand over no
  // administrative reach, and the tier is what this extension stamps.
  const base: PresetPermissionFields = { space_permissions: [], default_tier: 'library' };
  if (id === CONTENT_WRITE_PRESET_ID) return base;
  if (credential.staticKey) {
    // A key's own row carries namespaces, so asking for them is a request the
    // creator ceiling can check rather than one it has to refuse.
    return { ...base, ...WILDCARD_READ, extension_permissions: { '*': 'read' } };
  }
  // **An unreported grant is not a narrow one**, which is the rule the whole
  // auth surface runs on, so nothing here guesses a set from its absence. The
  // request goes out naming the widest read there is and the mint answers:
  // the refusal names the literal the credential was not granted, which is a
  // better answer than a set this screen invented.
  if (credential.granted === undefined) return { ...base, ...WILDCARD_READ };
  return { ...base, ...reachFromGrant(credential.granted, 'read') };
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
 * **Every preset reads from the credential, because every preset is now a
 * claim about one.** A constant is what told an operator he was about to
 * create a key holding eleven space permissions his sign-in had never held,
 * and the two content presets said the same thing about the global type
 * wildcard for exactly as long. What differs between them is which question
 * the credential is asked: what will the server copy, or what may this
 * request name.
 */
export function presetSummary(id: PresetId, credential: CredentialReach): string {
  if (id !== EVERYTHING_PRESET_ID) return namedPresetSummary(id, credential);
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
  // **`=== undefined`, not falsiness, and the doc comment on `granted` is the
  // rule.** `undefined` means the server reported no scopes; a string is what
  // it reported, and the empty one is a reported grant of nothing. Collapsing
  // the two says "the server did not report this sign-in's scopes" about the
  // one credential the server described exactly.
  if (credential.granted === undefined) {
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

/**
 * The content presets, each described by the set the credential produces.
 *
 * **Read from the request wherever the request names something**, so a family
 * the body stopped asking for cannot keep being promised here. The read-only
 * preset names all four, so its summary is its own body read back.
 *
 * **The read-and-write preset names nothing, so its summary asks the
 * credential the same question the server will.** It runs the platform's own
 * projections over the granted scopes, which is the calculation the server
 * performs when it derives the creator's set, so what is on screen is what
 * will be minted rather than a restatement of what a content key used to get.
 */
function namedPresetSummary(id: PresetId, credential: CredentialReach): string {
  const fields = presetPermissionFields(id, credential);
  const heading = [
    // Named rather than derived, so the empty list reads as the decision it is
    // rather than as a set nobody filled in.
    'Space permissions: none',
    `Default tier: ${fields.default_tier ?? 'library'}`,
  ];
  const reach =
    id === CONTENT_WRITE_PRESET_ID
      ? derivedReachLines(credential)
      : [...reachLines(fields), ...unknownReachNote(credential)];
  return [...heading, ...reach, CLAMP_NOTE].join('\n');
}

/**
 * Why the read-only preset is naming the global wildcard.
 *
 * It names it only when the credential's own reach could not be read, and the
 * set above is then a request rather than a description. Saying which of the
 * two is on screen is the whole of this: a wildcard read as a description
 * claims reach nobody checked, and the same wildcard read as a request is an
 * honest ask the server answers by name.
 */
function unknownReachNote(credential: CredentialReach): string[] {
  if (credential.loading) return ['Reading what this credential holds...'];
  if (credential.staticKey) {
    return [
      "What this credential holds cannot be listed here — a pasted key is stored as a hash, so nothing matches it back to its row. The set above is the widest read there is, resolved by the server against this key's own permissions.",
    ];
  }
  if (credential.granted === undefined) {
    return [
      "What this credential holds cannot be listed here, because the server did not report this sign-in's scopes. The set above is the widest read there is, and the mint will name anything it was not granted.",
    ];
  }
  return [];
}

/** The five families as the form states them, in the order the created-key
 *  screen lists them, so two screens describing one key cannot disagree. */
function reachLines(fields: PresetPermissionFields): string[] {
  return [
    `Types: ${describePermissionMap(fields.type_permissions)}`,
    `Extensions: ${describePermissionMap(fields.extension_permissions)}`,
    `Edges: ${describePermissionMap(fields.edge_permissions)}`,
    `Metadata: ${describePermissionMap(fields.metadata_permissions)}`,
    `Profile: ${describePermissionMap(fields.profile_permissions)}`,
  ];
}

const DERIVES_THE_CONTENT_SET =
  "This asks for no content permission at all, so the key is minted with a copy of this credential's own content set and none of its administrative reach.";

/**
 * What the server will derive for the read-and-write preset.
 *
 * The three credentials that cannot be described say so rather than naming a
 * set, which is the same rule the Everything summary runs on and for the same
 * reason: a pasted key is stored as a hash, so no row on the instance can be
 * matched back to it; a grant the server did not report is not evidence of a
 * narrow one; and a grant still being read is about to become an answer.
 * None of the three is a reason not to mint — the server knows the set even
 * when this screen cannot.
 */
function derivedReachLines(credential: CredentialReach): string[] {
  if (credential.loading) {
    return [DERIVES_THE_CONTENT_SET, 'Reading what this credential holds...'];
  }
  if (credential.staticKey) {
    return [
      DERIVES_THE_CONTENT_SET,
      'What that set is cannot be listed here. A pasted key is stored as a hash, so nothing matches it back to its row.',
    ];
  }
  if (credential.granted === undefined) {
    return [
      DERIVES_THE_CONTENT_SET,
      "What that set is cannot be listed here, because the server did not report this sign-in's scopes.",
    ];
  }
  return [
    DERIVES_THE_CONTENT_SET,
    ...reachLines({
      ...reachFromGrant(credential.granted, 'write'),
      // A sign-in holds no extension namespace, so the derived key holds none
      // either. Stated rather than omitted, because the created-key screen
      // will show the row and a summary that skipped it would read as an
      // oversight rather than as an answer.
      extension_permissions: {},
    }),
  ];
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
