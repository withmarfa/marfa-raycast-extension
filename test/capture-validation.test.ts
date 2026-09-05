import { describe, expect, it } from 'vitest';
import { parseCustomPropertiesJson } from '../src/capture-utils';
import { requiredFieldNames } from '../src/schema-fields';
import { schema } from './fixtures';

const field = (over: Record<string, unknown> = {}) => ({ type: 'string', ...over }) as never;
const NONE: ReadonlySet<string> = new Set();

/** The live shape, which is where this went wrong: two fields marked required
 *  per-field, and no top-level array anywhere. */
const PLAYLIST = [
  schema('google.youtube.playlist', {
    label: 'YouTube Playlist',
    fields: {
      playlist_id: field({ required: true }),
      title: field({ required: true }),
      description: field(),
    },
  }),
];

describe('a capture is refused before it reaches the network', () => {
  const required = requiredFieldNames(PLAYLIST, 'google.youtube.playlist');

  it('names the field that is missing', () => {
    const result = parseCustomPropertiesJson('{"playlist_id":"PL1"}', required);
    expect(result).toEqual({
      error: { field: 'propertiesJson', message: 'Missing required property: title' },
    });
  });

  it('refuses an empty editor, which is where the check used to be skipped', () => {
    // The early return for empty input sat before the loop, so clearing the box
    // or resuming a draft that had stored an empty string submitted nothing and
    // let the server refuse it instead.
    for (const raw of ['', '   ', undefined, '{}']) {
      expect(parseCustomPropertiesJson(raw, required)).toHaveProperty('error');
    }
  });

  it('refuses a required field present but blank', () => {
    // Present-and-empty is not provided. The server would reject it, and the
    // round trip is the thing worth saving.
    expect(parseCustomPropertiesJson('{"playlist_id":"PL1","title":"  "}', required)).toHaveProperty(
      'error',
    );
    expect(parseCustomPropertiesJson('{"playlist_id":"PL1","title":null}', required)).toHaveProperty(
      'error',
    );
  });

  it('accepts a payload that carries everything required', () => {
    expect(parseCustomPropertiesJson('{"playlist_id":"PL1","title":"Mix"}', required)).toEqual({
      properties: { playlist_id: 'PL1', title: 'Mix' },
    });
  });

  it('allows an empty payload for a type that requires nothing', () => {
    expect(parseCustomPropertiesJson('', NONE)).toEqual({ properties: {} });
    expect(parseCustomPropertiesJson('{}', NONE)).toEqual({ properties: {} });
  });
});

describe('the JSON itself', () => {
  it('refuses what is not an object, before asking about fields', () => {
    expect(parseCustomPropertiesJson('not json', NONE)).toHaveProperty('error');
    expect(parseCustomPropertiesJson('[1,2]', NONE)).toHaveProperty('error');
    expect(parseCustomPropertiesJson('null', NONE)).toHaveProperty('error');
    expect(parseCustomPropertiesJson('"a string"', NONE)).toHaveProperty('error');
  });
});

describe('what a subtype inherits, and what it can lift', () => {
  it('requires what a parent requires', () => {
    const registry = [
      schema('acme.deal', { fields: { deal_name: field({ required: true }) } }),
      schema('acme.deal.enterprise', { parent: 'acme.deal', fields: { seats: field() } }),
    ];
    const required = requiredFieldNames(registry, 'acme.deal.enterprise');
    expect(parseCustomPropertiesJson('{"seats":"10"}', required)).toHaveProperty('error');
  });

  it('lets a subtype make an inherited field optional by re-declaring it', () => {
    // Checked against the platform: re-declaring without the flag resolves to
    // `required: undefined` there, so accumulating requirements across the
    // chain would refuse a capture the server accepts.
    const registry = [
      schema('acme.deal', { fields: { deal_name: field({ required: true }) } }),
      schema('acme.deal.lite', { parent: 'acme.deal', fields: { deal_name: field() } }),
    ];
    expect([...requiredFieldNames(registry, 'acme.deal.lite')]).toEqual([]);
    expect(parseCustomPropertiesJson('{}', requiredFieldNames(registry, 'acme.deal.lite'))).toEqual({
      properties: {},
    });
  });

  it('resolves a chain deeper than any small fixed bound', () => {
    // A depth counter picked by hand truncates a legal chain, and a field never
    // seen is a requirement never enforced, which is this module's own bug
    // pointed at a different input.
    const depth = 20;
    const registry = [
      schema('deep.0', { fields: { root_field: field({ required: true }) } }),
      ...Array.from({ length: depth }, (_, i) =>
        schema(`deep.${String(i + 1)}`, {
          parent: `deep.${String(i)}`,
          fields: { [`f${String(i + 1)}`]: field() },
        }),
      ),
    ];
    expect([...requiredFieldNames(registry, `deep.${String(depth)}`)]).toEqual(['root_field']);
  });
});
