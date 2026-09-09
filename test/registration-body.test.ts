import { describe, expect, it } from 'vitest';
import { buildRegistrationBody } from '../src/auth/registration-body';

const base = {
  clientName: 'Marfa for Raycast',
  redirectUri: 'https://raycast.com/redirect?packageName=Extension',
  scope: 'openid offline_access core.*:read space.keys',
};

describe('buildRegistrationBody', () => {
  it('declares the scope the sign-in will request', () => {
    // The assertion that would have caught this shipping without it. A
    // registration omitting `scope` is capped at the server's default bundle
    // expansion, and the authorize surface then drops anything above that
    // silently — so the failure surfaces as a missing permission much later,
    // with nothing naming the registration.
    expect(buildRegistrationBody(base).scope).toBe(base.scope);
  });

  it('registers a public client for the code flow with a refresh token', () => {
    const body = buildRegistrationBody(base);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
  });

  it('sends the redirect URI verbatim, query string included', () => {
    // It has to match what Raycast puts on the authorize URL exactly, and
    // Raycast's carries a `packageName` parameter.
    expect(buildRegistrationBody(base).redirect_uris).toEqual([base.redirectUri]);
  });
});
