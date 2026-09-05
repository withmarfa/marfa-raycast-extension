import { describe, expect, it } from 'vitest';
import { typeReadableBySession } from '../src/auth/discovery';

const OAUTH_GRANT = 'openid core.note:read core.note:write core.task:read';

describe('typeReadableBySession', () => {
  it('makes no claim about a static-key session', () => {
    // A key wins outright in the client, but the tokens from an earlier browser
    // sign-in stay in storage after one is pasted. Reading them here answered
    // about a credential no request was using, and reported every type as
    // unshared while the calls behind the filters returned them normally.
    const withStaleTokens = { staticKey: true, granted: 'openid' };
    expect(typeReadableBySession(withStaleTokens, 'core.note')).toBe(true);
    expect(typeReadableBySession(withStaleTokens, 'core.highlight')).toBe(true);
    expect(typeReadableBySession(withStaleTokens, 'anything.at.all')).toBe(true);
  });

  it('makes no claim when the server reported no scopes', () => {
    // An unknown grant is not evidence of a narrow one, and guessing would put
    // a lock icon in front of someone for no reason.
    expect(typeReadableBySession({ staticKey: false, granted: undefined }, 'core.note')).toBe(true);
    expect(typeReadableBySession({ staticKey: false, granted: '' }, 'core.note')).toBe(true);
  });

  it('answers from the grant when there is one to read', () => {
    const session = { staticKey: false, granted: OAUTH_GRANT };
    expect(typeReadableBySession(session, 'core.note')).toBe(true);
    expect(typeReadableBySession(session, 'core.task')).toBe(true);
    expect(typeReadableBySession(session, 'core.highlight')).toBe(false);
  });

  it('reads a wildcard grant as covering its subtree', () => {
    // Coverage rather than set difference. A token holding `core.*:read`
    // genuinely covers `core.note:read`, and treating it as short would put a
    // lock on content the session can see.
    const session = { staticKey: false, granted: 'core.*:read' };
    expect(typeReadableBySession(session, 'core.note')).toBe(true);
    expect(typeReadableBySession(session, 'core.media.book')).toBe(true);
    expect(typeReadableBySession(session, 'user.recipe')).toBe(false);
  });

  it('treats a write grant as covering the read', () => {
    expect(typeReadableBySession({ staticKey: false, granted: 'core.note:write' }, 'core.note')).toBe(
      true,
    );
  });

  it('puts the static-key rule ahead of the grant, not beside it', () => {
    // Both branches are reachable with the same input, so their order is a
    // decision rather than an accident. A key session with a genuinely narrow
    // grant in storage must still claim nothing.
    expect(typeReadableBySession({ staticKey: true, granted: 'core.note:read' }, 'core.task')).toBe(
      true,
    );
    expect(typeReadableBySession({ staticKey: false, granted: 'core.note:read' }, 'core.task')).toBe(
      false,
    );
  });
});
