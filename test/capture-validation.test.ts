import { describe, expect, it } from 'vitest';
import { planCaptureForm } from '../src/capture-plan';
import { buildCaptureProperties } from '../src/capture-values';
import { requiredFieldNames } from '../src/schema-fields';
import { toTitleCase } from '../src/schema-fields';
import { schema } from './fixtures';

const f = (over: Record<string, unknown> = {}) => ({ type: 'string', ...over }) as never;

/**
 * A type registered by an integration, with two fields required per field:
 * the form must refuse a capture missing either before it reaches the server.
 */
const PLAYLIST = [
  schema('google.youtube.playlist', {
    label: 'YouTube Playlist',
    display_hints: { title_field: 'title', body_field: 'description' },
    fields: {
      playlist_id: f({ required: true, description: 'YouTube playlist id' }),
      title: f({ required: true }),
      description: f({}),
      item_count: f({ type: 'number' }),
      privacy_status: f({ type: 'enum', enum_values: ['public', 'unlisted', 'private'] }),
    },
  }),
];

const plan = planCaptureForm(PLAYLIST, 'google.youtube.playlist', {
  titleField: 'title',
  bodyField: 'description',
  toTitle: toTitleCase,
});
const build = (values: Record<string, unknown>) =>
  buildCaptureProperties(plan, 'google.youtube.playlist', values);

describe('a capture is refused before it reaches the network', () => {
  it('knows the type requires two fields', () => {
    expect([...requiredFieldNames(PLAYLIST, 'google.youtube.playlist')].sort()).toEqual([
      'playlist_id',
      'title',
    ]);
  });

  it('names each missing field against the field itself', () => {
    const result = build({ playlist_id: 'PL1' });
    expect(result).toEqual({ errors: { title: expect.stringContaining('required') } });
  });

  it('refuses an empty form rather than posting nothing', () => {
    const result = build({});
    expect(result).toEqual({
      errors: {
        playlist_id: expect.stringContaining('required'),
        title: expect.stringContaining('required'),
      },
    });
  });

  it('treats present-but-blank as absent, which is what the server does', () => {
    expect(build({ playlist_id: 'PL1', title: '   ' })).toEqual({
      errors: { title: expect.stringContaining('required') },
    });
  });

  it('accepts a payload carrying everything required', () => {
    expect(build({ playlist_id: 'PL1', title: 'Mix' })).toEqual({
      properties: { playlist_id: 'PL1', title: 'Mix' },
    });
  });

  it('renders the type it was never written for as real controls', () => {
    // The point of the whole change. Nothing in this repository knows what a
    // YouTube playlist is, and it gets a dropdown over the values the server
    // declared rather than a textarea expecting JSON.
    const privacy = plan.primary.find((field) => field.name === 'privacy_status');
    expect(privacy?.kind).toBe('dropdown');
    expect(privacy?.enumValues).toEqual(['public', 'unlisted', 'private']);
    expect(plan.primary.find((field) => field.name === 'item_count')?.kind).toBe('number');
    expect(plan.primary.find((field) => field.name === 'playlist_id')?.info).toBe(
      'YouTube playlist id',
    );
  });
});
