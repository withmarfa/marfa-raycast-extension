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
import type { CredentialReach } from '../src/key-presets';

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

  it('sends the full content maps and no space permission for Content, read and write', () => {
    const fields = presetPermissionFields(CONTENT_WRITE_PRESET_ID, PASTED_KEY);
    // Empty rather than absent, and the difference is the whole preset: an
    // absent list takes the creator's space permissions, which is the one thing
    // a content-only key must not do.
    expect(fields.space_permissions).toEqual([]);
    expect(fields.type_permissions).toEqual({ '*': 'write' });
    expect(fields.extension_permissions).toEqual({ '*': 'write' });
    expect(fields.edge_permissions).toEqual({ '*': 'write' });
    expect(fields.metadata_permissions).toEqual({ types: 'write' });
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

  it('still sends one from a pasted key, which can hold namespaces', () => {
    // A key carries extension namespaces on its own row, so the creator
    // ceiling compares map against map and the family is checked rather than
    // refused. Dropping it for every credential would narrow a key a static
    // credential is entitled to make.
    expect(presetPermissionFields(CONTENT_WRITE_PRESET_ID, PASTED_KEY).extension_permissions).toEqual(
      { '*': 'write' },
    );
    expect(presetPermissionFields(CONTENT_READ_PRESET_ID, PASTED_KEY).extension_permissions).toEqual({
      '*': 'read',
    });
  });

  it('names the profile map, because naming any family derives the rest empty', () => {
    // The server reads "names no reach" as all five families or none, so a
    // request naming types gets `{}` on every family it stayed silent about.
    // A content key that said nothing about the profile therefore could not
    // read the profile rows even when its creator held them.
    //
    // Read on both presets rather than the preset's own level. `profile:write`
    // is in no shipped bundle — the server keeps the write half opt-in by name
    // — so a sign-in never holds it, and naming it would refuse the mint for
    // exactly the reason this whole preset table was rewritten. The profile is
    // the account rather than content, which is the same line the `content`
    // scope category already draws.
    for (const id of CONTENT_PRESETS) {
      for (const credential of [SIGNED_IN, PASTED_KEY]) {
        expect(presetPermissionFields(id, credential).profile_permissions).toEqual({ '*': 'read' });
      }
    }
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
    // screen cannot promise namespaces the body no longer asks for.
    expect(presetSummary(CONTENT_WRITE_PRESET_ID, SIGNED_IN)).toMatch(/^Extensions: none$/m);
    expect(presetSummary(CONTENT_WRITE_PRESET_ID, PASTED_KEY)).toMatch(
      /^Extensions: \*: write$/m,
    );
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
