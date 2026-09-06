/**
 * The authorization URL, built by hand.
 *
 * Raycast's own `authorizationRequest` mints the PKCE pair and the redirect URI
 * but cannot carry a dynamically registered client id or an OIDC `prompt`, so
 * the URL is assembled here from that request's values. Pure, because the two
 * things it has to get right are both invisible until a person is standing in
 * front of the wrong screen: a challenge that does not match the verifier, and
 * a consent that was never asked for.
 */
export interface AuthorizeUrlParams {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  state: string;
  /** OIDC `prompt=consent`. Both of this server's consent gates check it ahead
   *  of the stored-consent lookup, which is what makes a standing grant
   *  re-askable without destroying it. */
  forceConsent?: boolean;
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(params.endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  if (params.forceConsent) url.searchParams.set('prompt', 'consent');
  return url.toString();
}
