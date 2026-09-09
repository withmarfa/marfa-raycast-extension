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
] as const;

describe('presetPermissionFields', () => {
  it('names no permission at all for Everything', () => {
    // The whole defect in one assertion. Every field here is one the server
    // reads as "this is what the key gets", and any of them present turns a
    // copy of the creator's set into a request measured against it.
    const fields = presetPermissionFields(EVERYTHING_PRESET_ID);
    for (const field of PERMISSION_FIELDS) {
      expect(fields[field]).toBeUndefined();
    }
  });

  it('names no default tier for Everything either', () => {
    // Not a permission, but the same rule reads better applied to the whole
    // request: the preset says nothing, so nothing it did not choose is sent.
    expect(presetPermissionFields(EVERYTHING_PRESET_ID).default_tier).toBeUndefined();
  });

  it('sends the full content maps and no space permission for Content, read and write', () => {
    const fields = presetPermissionFields(CONTENT_WRITE_PRESET_ID);
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
    const fields = presetPermissionFields(CONTENT_READ_PRESET_ID);
    expect(fields.space_permissions).toEqual([]);
    expect(fields.type_permissions).toEqual({ '*': 'read' });
    expect(fields.extension_permissions).toEqual({ '*': 'read' });
    expect(fields.edge_permissions).toEqual({ '*': 'read' });
    expect(fields.metadata_permissions).toEqual({ types: 'read' });
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
