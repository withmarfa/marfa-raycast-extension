/**
 * Turning the configured server URL into the issuer identifier everything else
 * keys off.
 *
 * **Its own module because three unrelated things need the same answer**: the
 * storage keys that scope a client registration to an instance, the ones that
 * scope a grant record, and the base URL the SDK is pointed at. A second copy
 * anywhere would be a second answer to "which instance is this", and the two
 * would disagree the first time somebody typed a trailing slash.
 */

/** Trailing slashes are invisible to the person typing them and load-bearing
 *  to a storage key, so `https://marfa.so/` and `https://marfa.so` must not
 *  become two instances holding two client registrations. */
export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Accept a host typed without a scheme (e.g. "api.marfa.so"). Node's
 *  fetch/URL parser rejects scheme-less URLs with "Failed to parse URL",
 *  which the browser silently tolerates, so the sign-in page would open and
 *  consent succeed, yet every fetch() this extension makes (registration,
 *  token exchange, refresh, SDK data calls) would throw. Default a
 *  scheme-less value to https and strip any trailing slash. */
export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return stripTrailingSlash(withScheme);
}
