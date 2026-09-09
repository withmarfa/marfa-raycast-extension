import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl } from '../src/auth/authorize-url';

const base = {
  endpoint: 'https://api.example.test/auth/oauth2/authorize',
  clientId: 'client-1',
  redirectUri: 'https://raycast.com/redirect',
  scope: 'openid core.note:read',
  codeChallenge: 'challenge-value',
  state: 'state-value',
};

const params = (url: string) => new URL(url).searchParams;

describe('buildAuthorizeUrl', () => {
  it('asks for consent only when the caller forces it', () => {
    // The whole of reauthorizing is this one parameter. Both of the server's
    // consent gates check it ahead of the stored-consent lookup, so an ordinary
    // sign-in must not carry it or every launch would ask again.
    expect(params(buildAuthorizeUrl(base)).has('prompt')).toBe(false);
    expect(params(buildAuthorizeUrl({ ...base, forceConsent: true })).get('prompt')).toBe(
      'consent',
    );
    expect(params(buildAuthorizeUrl({ ...base, forceConsent: false })).has('prompt')).toBe(false);
  });

  it('carries the PKCE challenge and state from the request it was given', () => {
    // Raycast mints these, and a URL that carries a challenge the later
    // exchange cannot match fails after the browser has already said it
    // connected, which reads as an immediate demand to sign in again.
    const p = params(buildAuthorizeUrl(base));
    expect(p.get('code_challenge')).toBe('challenge-value');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('state-value');
    expect(p.get('redirect_uri')).toBe('https://raycast.com/redirect');
  });

  it('sends the dynamically registered client rather than the placeholder', () => {
    // The reason this URL is hand-built at all: the request is made before the
    // client exists, so the id in it is a placeholder.
    expect(params(buildAuthorizeUrl(base)).get('client_id')).toBe('client-1');
    expect(params(buildAuthorizeUrl(base)).get('response_type')).toBe('code');
  });

  it('keeps a path the server mounts auth under', () => {
    // Self-hosted instances mount auth somewhere else, and the endpoint comes
    // from discovery rather than from here.
    const url = buildAuthorizeUrl({ ...base, endpoint: 'https://self.test/deep/auth/authorize' });
    expect(new URL(url).pathname).toBe('/deep/auth/authorize');
  });

  it('encodes a scope string with spaces in it', () => {
    expect(params(buildAuthorizeUrl(base)).get('scope')).toBe('openid core.note:read');
    expect(buildAuthorizeUrl(base)).toContain('scope=openid+core.note%3Aread');
  });
});
