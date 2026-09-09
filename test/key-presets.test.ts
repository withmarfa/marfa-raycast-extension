import { grantCoversScope } from '@withmarfa/shared';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_READ_PRESET_ID,
  CONTENT_WRITE_PRESET_ID,
  CUSTOM_PRESET_ID,
  EVERYTHING_PRESET_ID,
  KEY_PRESETS,
  isPresetId,
  presetPermissionFields,
  presetSummary,
} from '../src/key-presets';
import type { CredentialReach, PresetPermissionFields } from '../src/key-presets';

/**
 * What a preset puts on the wire, and what the form says it will do.
 *
 * **"Everything" is a claim about the credential in hand, not a list.** A key's
 * permissions are bounded by its creator's, and a request naming no permission
 * at all takes the creator's whole set, so the way to ask for everything the
 * signed-in credential holds is to ask for nothing. Naming the eleven space
 * permissions instead asks for a set no sign-in has ever held, and the server
 * refuses it on the first one the credential is missing.
 */

const PERMISSION_FIELDS = [
  'space_permissions',
  'type_permissions',
  'extension_permissions',
  'edge_permissions',
  'metadata_permissions',
  'profile_permissions',
] as const;

/**
 * The two credentials a create form can be holding, because half of what a
 * preset sends is now a question about which one it is.
 */
const SIGNED_IN: CredentialReach = {
  staticKey: false,
  granted: 'openid core.note:read core.note:write space.keys',
};
const PASTED_KEY: CredentialReach = { staticKey: true, granted: undefined };

const CONTENT_PRESETS = [CONTENT_WRITE_PRESET_ID, CONTENT_READ_PRESET_ID] as const;

describe('presetPermissionFields', () => {
  it('names no permission at all for Everything', () => {
    // The whole defect in one assertion. Every field here is one the server
    // reads as "this is what the key gets", and any of them present turns a
    // copy of the creator's set into a request measured against it.
    const fields = presetPermissionFields(EVERYTHING_PRESET_ID, SIGNED_IN);
    for (const field of PERMISSION_FIELDS) {
      expect(fields[field]).toBeUndefined();
    }
    // Absent, not present-and-undefined. `JSON.stringify` drops the second on
    // its way to the wire, so the two agree today and would stop agreeing the
    // moment anything between here and the request reads the keys instead of
    // the values.
    expect(Object.keys(fields)).toEqual([]);
    // The credential decides what the other two presets send and decides
    // nothing here, because asking for nothing is already the question "what
    // does this credential hold" asked of the only thing that can answer it.
    expect(presetPermissionFields(EVERYTHING_PRESET_ID, PASTED_KEY)).toEqual(fields);
  });

  it('names no default tier for Everything either', () => {
    // Not a permission, but the same rule reads better applied to the whole
    // request: the preset says nothing, so nothing it did not choose is sent.
    expect(presetPermissionFields(EVERYTHING_PRESET_ID, SIGNED_IN).default_tier).toBeUndefined();
  });

  it('names the empty space list and nothing else for Content, read and write', () => {
    const fields = presetPermissionFields(CONTENT_WRITE_PRESET_ID, PASTED_KEY);
    // Empty rather than absent, and the difference is the whole preset: an
    // absent list takes the creator's space permissions, which is the one thing
    // a content-only key must not do.
    expect(fields.space_permissions).toEqual([]);
    // The content half is the creator's, derived by the server from a body
    // that names none of the five families. A pasted key derives from its own
    // maps and a sign-in from what its grant projects to, so one body is right
    // for both and neither can ask for more than it holds.
    expect(Object.keys(fields).sort()).toEqual(['default_tier', 'space_permissions']);
  });

  it('sends read maps and no space permission for Content, read only', () => {
    const fields = presetPermissionFields(CONTENT_READ_PRESET_ID, PASTED_KEY);
    expect(fields.space_permissions).toEqual([]);
    expect(fields.type_permissions).toEqual({ '*': 'read' });
    expect(fields.extension_permissions).toEqual({ '*': 'read' });
    expect(fields.edge_permissions).toEqual({ '*': 'read' });
    expect(fields.metadata_permissions).toEqual({ types: 'read' });
  });

  it('sends no extension map from a sign-in, which can hold no namespace', () => {
    // The same defect as the eleven space permissions, reached through a
    // different family. No scope names an extension namespace, so the server
    // has nothing to measure a session's request against and refuses any
    // non-empty map outright — ahead of every other axis, so both content
    // presets were refused on every OAuth sign-in before anything else was
    // even looked at.
    for (const id of CONTENT_PRESETS) {
      const fields = presetPermissionFields(id, SIGNED_IN);
      expect(fields.extension_permissions).toBeUndefined();
      // Absent rather than present-and-undefined, for the same reason the
      // Everything preset is asserted that way.
      expect(Object.keys(fields)).not.toContain('extension_permissions');
    }
  });

  it('still sends one from a pasted key naming a set, which can hold namespaces', () => {
    // A key carries extension namespaces on its own row, so the creator
    // ceiling compares map against map and the family is checked rather than
    // refused. Dropping it would narrow a key a static credential is entitled
    // to make. Only the read-only preset names a set at all — the other one
    // derives, and a derive copies the namespaces without being asked.
    expect(
      presetPermissionFields(CONTENT_READ_PRESET_ID, PASTED_KEY).extension_permissions,
    ).toEqual({
      '*': 'read',
    });
  });

  it('names the profile map whenever it names any family at all', () => {
    // The server reads "names no reach" as all five families or none, so a
    // request naming types gets `{}` on every family it stayed silent about.
    // A content key that said nothing about the profile therefore could not
    // read the profile rows even when its creator held them.
    //
    // Read rather than the preset's own level. `profile:write` is in no
    // shipped bundle — the server keeps the write half opt-in by name — so a
    // sign-in never holds it, and naming it would refuse the mint for exactly
    // the reason this whole preset table was rewritten. The profile is the
    // account rather than content, which is the same line the `content` scope
    // category already draws.
    expect(presetPermissionFields(CONTENT_READ_PRESET_ID, PASTED_KEY).profile_permissions).toEqual({
      '*': 'read',
    });
    expect(presetPermissionFields(CONTENT_READ_PRESET_ID, SIGNED_IN).profile_permissions).toEqual(
      {},
    );
    // The read-and-write preset names none of the five, so the profile arrives
    // through the derive rather than through the request.
    expect(Object.keys(presetPermissionFields(CONTENT_WRITE_PRESET_ID, SIGNED_IN))).not.toContain(
      'profile_permissions',
    );
  });
});

describe('the preset names', () => {
  it('says what each one means rather than what it once was', () => {
    expect(KEY_PRESETS.map((preset) => preset.label)).toEqual([
      'Everything you hold',
      'Content, read and write',
      'Content, read only',
    ]);
  });
});

describe('presetSummary', () => {
  const KEYS_AND_NOTES = 'openid core.note:read core.note:write space.keys';
  const WEBHOOKS_AND_BOOKMARKS = 'openid core.bookmark:read space.webhooks';

  it('reads Everything from the credential rather than from a constant', () => {
    // The acceptance in one test: two sign-ins, two summaries. A constant
    // cannot do this, and a constant is what told the operator he was about to
    // create a key holding eleven permissions his sign-in had never held.
    const withKeys = presetSummary(EVERYTHING_PRESET_ID, {
      staticKey: false,
      granted: KEYS_AND_NOTES,
    });
    const withWebhooks = presetSummary(EVERYTHING_PRESET_ID, {
      staticKey: false,
      granted: WEBHOOKS_AND_BOOKMARKS,
    });

    expect(withKeys).toContain('space.keys');
    expect(withKeys).not.toContain('space.webhooks');
    expect(withWebhooks).toContain('space.webhooks');
    expect(withWebhooks).not.toContain('space.keys');
    expect(withKeys).not.toEqual(withWebhooks);
  });

  it('names the content the sign-in holds, not the eleven it does not', () => {
    const summary = presetSummary(EVERYTHING_PRESET_ID, {
      staticKey: false,
      granted: KEYS_AND_NOTES,
    });
    expect(summary).toContain('core.note');
    // `openid` says nothing about what a key would be able to reach, and a
    // summary listing it invites somebody to read it as content.
    expect(summary).not.toContain('openid');
  });

  it('says a sign-in holding no space permission holds none', () => {
    // Distinct from "not reported": this credential was asked and answered.
    const summary = presetSummary(EVERYTHING_PRESET_ID, {
      staticKey: false,
      granted: 'openid core.note:read',
    });
    expect(summary).toMatch(/space permissions: none/i);
  });

  it('declines to guess when the server reported no scopes', () => {
    // An unreported grant is not a narrow one. The same rule the whole auth
    // surface runs on, and the summary is the one place where guessing would
    // read as fact.
    const summary = presetSummary(EVERYTHING_PRESET_ID, { staticKey: false, granted: undefined });
    expect(summary).toMatch(/not reported|cannot be listed/i);
    expect(summary).not.toMatch(/space permissions: none/i);
  });

  it('declines to guess for a pasted key, which reports nothing about itself', () => {
    // Nothing on the instance answers "what does the credential I am holding
    // hold": there is no route for it, and a pasted key cannot be matched to a
    // row because only its hash is stored. Saying so beats inventing a set.
    const summary = presetSummary(EVERYTHING_PRESET_ID, {
      staticKey: true,
      granted: 'core.note:read space.keys',
    });
    expect(summary).toMatch(/cannot be listed/i);
    // The tokens of an earlier browser sign-in survive in storage after a key
    // is pasted, so reading them here would describe a credential no request
    // is using.
    expect(summary).not.toContain('space.keys');
  });

  it('states the content presets exactly, because they name what they send', () => {
    const summary = presetSummary(CONTENT_READ_PRESET_ID, {
      staticKey: false,
      granted: KEYS_AND_NOTES,
    });
    expect(summary).toMatch(/space permissions: none/i);
    expect(summary).toContain('read');
    // A named set is still clamped to the creator's, and a summary that did
    // not say so would promise reach the server may refuse.
    expect(summary).toMatch(/clamped|no more than/i);
  });

  it('names the profile beside the other families', () => {
    // The created-key screen lists it, and two screens describing one key
    // differing on a family is how somebody concludes the mint did something
    // other than what the form said it would.
    for (const id of CONTENT_PRESETS) {
      expect(presetSummary(id, SIGNED_IN)).toMatch(/^Profile: /m);
    }
  });

  it('separates a grant reported as empty from one never reported', () => {
    // `CredentialReach.granted` documents `undefined` as "the server reported
    // none" and a string as what it reported, so an empty string is a reported
    // grant of nothing. A truthiness check collapses the two and says "cannot
    // be listed" about the one credential the server described exactly.
    const summary = presetSummary(EVERYTHING_PRESET_ID, { staticKey: false, granted: '' });
    expect(summary).toMatch(/space permissions: none/i);
    expect(summary).not.toMatch(/did not report/i);
  });

  it('reports what a sign-in gets on the extension family, matching what it sends', () => {
    // The summary is derived from the request rather than restated, so the
    // screen cannot promise namespaces the body no longer asks for. A sign-in
    // holds no namespace on either preset: the read-only one sends no map and
    // the derived one copies a set that has none in it.
    expect(presetSummary(CONTENT_WRITE_PRESET_ID, SIGNED_IN)).toMatch(/^Extensions: none$/m);
    expect(presetSummary(CONTENT_READ_PRESET_ID, SIGNED_IN)).toMatch(/^Extensions: none$/m);
    // A pasted key still asks for them where the preset names a set at all.
    expect(presetSummary(CONTENT_READ_PRESET_ID, PASTED_KEY)).toMatch(/^Extensions: \*: read$/m);
  });
});

describe('isPresetId', () => {
  it('accepts every preset the form offers and nothing else', () => {
    // The form holds the selection as a plain string because a dropdown does,
    // and this is what turns it back into the closed set the request builder
    // takes. Custom is deliberately not one: it means "no preset decides this".
    for (const preset of KEY_PRESETS) {
      expect(isPresetId(preset.id)).toBe(true);
    }
    expect(isPresetId(CUSTOM_PRESET_ID)).toBe(false);
    expect(isPresetId('')).toBe(false);
    expect(isPresetId('everything-you-hold')).toBe(false);
  });
});

describe('presetSummary while the grant is still being read', () => {
  it('says it is reading rather than that nothing was reported', () => {
    // Both arrive as "nothing known" and they mean opposite things: a grant
    // being read is about to become an answer, one the server never reported
    // never will. Collapsing them puts a false statement on screen for the
    // frame before the real set lands.
    const summary = presetSummary(EVERYTHING_PRESET_ID, {
      staticKey: false,
      granted: undefined,
      loading: true,
    });
    expect(summary).toMatch(/reading/i);
    expect(summary).not.toMatch(/did not report/i);
  });
});

/**
 * The content presets, measured the way the server measures them.
 *
 * Both used to send `type_permissions: {"*": <access>}`, the global wildcard,
 * which reaches every registered type including the system namespace. No
 * permission bundle confers it, so `POST /keys` refused every mint from a
 * browser sign-in on the type axis — the same defect as the eleven space
 * permissions, reached through a third family.
 */

/**
 * A maximal browser sign-in: every bundle the instance advertises expanded,
 * default-off ones included, unioned with the scopes this extension asks for
 * unconditionally and with the one space permission it names.
 *
 * Read from a live instance's authorization-server document on 9 September
 * 2026 rather than composed by hand, because a hand-written grant is a guess
 * about what a person can be given and this is the whole question. No
 * narrower sign-in can hold more than this, so a request this grant does not
 * cover is a request no sign-in can make.
 */
const MAXIMAL_SIGN_IN = [
  'core.bookmark:read core.bookmark:write core.entity.person:read core.entity.person:write',
  'core.entity.place:read core.entity.place:write core.entity:read core.entity:write',
  'core.event:read core.event:write core.file.audio:read core.file.audio:write',
  'core.file.image:read core.file.image:write core.file.video:read core.file.video:write',
  'core.file:read core.file:write core.highlight:read core.highlight:write',
  'core.media.album:read core.media.album:write core.media.article:read core.media.article:write',
  'core.media.book:read core.media.book:write core.media.episode:read core.media.episode:write',
  'core.media.film:read core.media.film:write core.media.series:read core.media.series:write',
  'core.media.song:read core.media.song:write core.media:read core.media:write',
  'core.message:read core.message:write core.note:read core.note:write',
  'core.task:read core.task:write edge.*:read edge.*:write email',
  'google.calendar.event:read google.contacts.contact:read google.drive.file:read',
  'google.tasks.task:read google.youtube.channel:read google.youtube.playlist:read',
  'google.youtube.video:read marfa.captured_email:read marfa.podcast.episode:read',
  'marfa.podcast.show:read metadata.types:read metadata:read metadata:write',
  'offline_access openid profile profile:read raindrop.collection:read',
  'raindrop.raindrop:read readwise.book:read readwise.document:read readwise.highlight:read',
  'space.keys system.connection:read todoist.task:read user.*:read user.*:write',
].join(' ');

const MAXIMAL: CredentialReach = { staticKey: false, granted: MAXIMAL_SIGN_IN };

/**
 * The scope literal one permission-map entry asks for.
 *
 * **A restatement of the server's `scopeForEntry`, and the only one in this
 * file.** The extension cannot import the server, so the spelling per family
 * is written out here; everything the spelling is then compared against is
 * `grantCoversScope`, which is the platform's own answer rather than a second
 * copy of the grammar. A `none` entry is a denial rather than a request and
 * names no literal, exactly as the server skips it.
 */
function scopeForEntry(
  family: 'type' | 'edge' | 'metadata' | 'profile',
  key: string,
  level: string,
): string | null {
  if (level === 'none') return null;
  if (family === 'type') return `${key}:${level}`;
  if (family === 'edge') return `edge.${key}:${level}`;
  if (family === 'profile') return key === '*' ? `profile:${level}` : `profile.${key}:${level}`;
  return key === '*' ? `metadata:${level}` : `metadata.${key}:${level}`;
}

/**
 * The first thing a request asks for that the grant does not cover, or null
 * when the grant covers all of it. The server's own mint check, which is what
 * turns "the body looks right" into "the mint is not refused".
 */
function firstUncovered(granted: string, fields: PresetPermissionFields): string | null {
  const held = granted.split(/\s+/).filter(Boolean);
  const families = [
    ['type', fields.type_permissions],
    ['edge', fields.edge_permissions],
    ['metadata', fields.metadata_permissions],
    ['profile', fields.profile_permissions],
  ] as const;
  for (const [family, map] of families) {
    for (const [key, level] of Object.entries(map ?? {})) {
      const scope = scopeForEntry(family, key, level);
      if (scope === null) continue;
      if (!grantCoversScope(held, scope)) return scope;
    }
  }
  return null;
}

describe('the rule that made this findable', () => {
  it('refuses the global wildcard against a grant no sign-in can exceed', () => {
    // Why the old constant was wrong, stated as the server states it. Nothing
    // in the bundle set confers `*`, `content:*` or `core.*:*` — every content
    // bundle names concrete types — so a preset naming the global wildcard
    // asks for a set no sign-in has ever held.
    expect(firstUncovered(MAXIMAL_SIGN_IN, { type_permissions: { '*': 'write' } })).toBe('*:write');
    expect(firstUncovered(MAXIMAL_SIGN_IN, { type_permissions: { '*': 'read' } })).toBe('*:read');
  });

  it('covers a concrete type the grant names, which is what a preset may ask for', () => {
    expect(firstUncovered(MAXIMAL_SIGN_IN, { type_permissions: { 'core.note': 'read' } })).toBe(
      null,
    );
  });
});

describe('Content, read and write', () => {
  it('names no content family at all, so the server derives the creator set', () => {
    // The honest shape: a body naming `space_permissions: []` and nothing else
    // takes the creator's whole content set with the administrative half
    // stripped. `namesNoReach` on the server reads all five families, so any
    // one of them present turns a copy into a request measured against the
    // grant.
    for (const credential of [MAXIMAL, PASTED_KEY]) {
      const fields = presetPermissionFields(CONTENT_WRITE_PRESET_ID, credential);
      expect(fields.space_permissions).toEqual([]);
      for (const family of [
        'type_permissions',
        'edge_permissions',
        'metadata_permissions',
        'profile_permissions',
        'extension_permissions',
      ] as const) {
        expect(Object.keys(fields)).not.toContain(family);
      }
    }
  });

  it('leaves the coverage check nothing to measure, which is the point of it', () => {
    // **Not a coverage result, and naming it one would be the vacuous test.**
    // The check walks the families the body names and this body names none, so
    // `null` here is the absence of a question rather than an answer to it.
    // What it does state is the consequence worth stating: this preset cannot
    // be refused on reach, whatever the credential holds, because it asks for
    // none.
    const fields = presetPermissionFields(CONTENT_WRITE_PRESET_ID, MAXIMAL);
    expect(Object.keys(fields).sort()).toEqual(['default_tier', 'space_permissions']);
    expect(firstUncovered(MAXIMAL_SIGN_IN, fields)).toBe(null);
  });

  it('shows a set the credential holds, since the screen names what the body will not', () => {
    // The body says nothing, so the summary is the only place the derived set
    // appears — and a summary naming reach the grant does not cover would be
    // the same defect this ticket fixed, moved from the wire to the screen.
    const summary = presetSummary(CONTENT_WRITE_PRESET_ID, MAXIMAL);
    const types = /^Types: (.+)$/m.exec(summary);
    const entries = (types?.[1] ?? '')
      .split(', ')
      .map((entry) => entry.split(': '))
      .filter(([, access]) => access !== 'none');
    // Named before the loop, so a summary whose Types line stopped parsing
    // fails here rather than passing with nothing to iterate.
    expect(entries.length).toBeGreaterThan(10);
    const held = MAXIMAL_SIGN_IN.split(' ');
    for (const [pattern, access] of entries) {
      expect({ pattern, covered: grantCoversScope(held, `${pattern}:${access}`) }).toEqual({
        pattern,
        covered: true,
      });
    }
  });
});

describe('Content, read only', () => {
  it('is the sign-in grant narrowed to read, not a constant', () => {
    const fields = presetPermissionFields(CONTENT_READ_PRESET_ID, MAXIMAL);
    expect(fields.space_permissions).toEqual([]);
    // Concrete types, because that is what the bundles name.
    expect(fields.type_permissions?.['core.note']).toBe('read');
    expect(fields.type_permissions?.['user.*']).toBe('read');
    // Nothing at write, whatever the grant holds at write.
    expect(Object.values(fields.type_permissions ?? {})).not.toContain('write');
    expect(fields.edge_permissions).toEqual({ '*': 'read' });
    expect(fields.metadata_permissions?.types).toBe('read');
    expect(fields.profile_permissions).toEqual({ '*': 'read' });
  });

  it('is covered on every axis the server checks', () => {
    expect(
      firstUncovered(MAXIMAL_SIGN_IN, presetPermissionFields(CONTENT_READ_PRESET_ID, MAXIMAL)),
    ).toBe(null);
  });

  it('changes with the credential rather than being the same body twice', () => {
    // The acceptance in one assertion. A constant cannot do this.
    const notes = presetPermissionFields(CONTENT_READ_PRESET_ID, {
      staticKey: false,
      granted: 'core.note:write space.keys',
    });
    const bookmarks = presetPermissionFields(CONTENT_READ_PRESET_ID, {
      staticKey: false,
      granted: 'core.bookmark:read space.keys',
    });
    expect(notes.type_permissions).toEqual({ 'core.note': 'read' });
    expect(bookmarks.type_permissions).toEqual({ 'core.bookmark': 'read' });
  });

  it('drops the scopes that name no reach a permission map can carry', () => {
    // `openid`, `email` and `offline_access` say who signed in and how long
    // for; `space.keys` is administrative and the preset names the empty list
    // for that family. None of them belongs in a content map, and a projection
    // that admitted one would name a pattern the server cannot measure.
    const fields = presetPermissionFields(CONTENT_READ_PRESET_ID, {
      staticKey: false,
      granted: 'openid email offline_access space.keys core.note:read',
    });
    expect(fields.type_permissions).toEqual({ 'core.note': 'read' });
    expect(fields.edge_permissions).toEqual({});
    expect(fields.metadata_permissions).toEqual({});
    expect(fields.profile_permissions).toEqual({});
  });
});

describe('neither content preset names a global wildcard for a sign-in', () => {
  it('holds for both presets against the widest grant a sign-in can hold', () => {
    for (const id of CONTENT_PRESETS) {
      const fields = presetPermissionFields(id, MAXIMAL);
      expect(fields.type_permissions?.['*']).toBeUndefined();
      expect(fields.extension_permissions).toBeUndefined();
    }
  });
});

describe('the summary under the form', () => {
  it('reads the read-and-write preset from the credential rather than a constant', () => {
    const notes = presetSummary(CONTENT_WRITE_PRESET_ID, {
      staticKey: false,
      granted: 'core.note:write space.keys',
    });
    const bookmarks = presetSummary(CONTENT_WRITE_PRESET_ID, {
      staticKey: false,
      granted: 'core.bookmark:read space.keys',
    });
    expect(notes).toContain('core.note');
    expect(notes).not.toContain('core.bookmark');
    expect(bookmarks).toContain('core.bookmark');
    expect(notes).not.toEqual(bookmarks);
  });

  it('shows the read-only preset as the set the body carries', () => {
    const summary = presetSummary(CONTENT_READ_PRESET_ID, {
      staticKey: false,
      granted: 'core.note:write edge.*:write space.keys',
    });
    expect(summary).toContain('core.note: read');
    expect(summary).not.toContain('core.note: write');
  });

  it('says so when the credential reach is unknown rather than naming a set', () => {
    // An unreported grant is not a narrow one, and the server's refusal is
    // legible now, so the honest move is to say the set cannot be listed and
    // let the mint answer.
    for (const id of CONTENT_PRESETS) {
      const summary = presetSummary(id, { staticKey: false, granted: undefined });
      expect(summary).toMatch(/not report|cannot be listed/i);
    }
  });
});
