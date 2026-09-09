/**
 * The dynamic-client-registration body, built by hand.
 *
 * Pure for the same reason `buildAuthorizeUrl` is: what it has to get right is
 * invisible until somebody is standing in front of a screen missing a
 * permission. The server stores a scope ceiling against the client from this
 * body and never updates it, and the authorize surface then *narrows* a
 * request rather than refusing it — a scope outside the ceiling is dropped
 * before the consent screen is drawn. So a registration that omits `scope`
 * does not fail; it silently caps every future sign-in at the server's default
 * bundle expansion, which by design carries no space permission at all.
 *
 * A space permission is the case that bites, because it is the one family no bundle
 * may publish. Asking for `space.keys` from a client registered without
 * it produces a consent screen that never mentions it, a grant that comes back
 * without it, and a refusal much later at a door, with nothing along the way
 * naming the registration as the cause.
 */
export interface RegistrationBodyParams {
  clientName: string;
  redirectUri: string;
  /** Space-delimited, and the same set the sign-in goes on to request. A
   *  ceiling grants nothing on its own — consent still decides — so it is
   *  claimed at the width the client may ask for rather than trimmed. */
  scope: string;
}

export function buildRegistrationBody(params: RegistrationBodyParams): Record<string, unknown> {
  return {
    client_name: params.clientName,
    redirect_uris: [params.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'none',
    scope: params.scope,
  };
}
