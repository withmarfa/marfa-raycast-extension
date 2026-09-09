/**
 * Whether a short grant is one that registering again can repair.
 *
 * **Almost none of them are, and getting this wrong is expensive in a way
 * nothing reports.** A stored scope ceiling is not simply frozen: the server's
 * authorize hook catches it up in place, on the same request, for any scope
 * its permission bundles publish. That is what makes the ordinary shortfall
 * self-healing — an operator registers a type, the bundles widen, the next
 * sign-in asks for the new scope and the row is widened to admit it, server
 * side, for free.
 *
 * Capabilities are the one family excluded from that catch-up, deliberately:
 * admitting one would let an unauthenticated request write a space permission into a
 * stored registration. So they are the only scopes a client has to re-register
 * to obtain, and the only ones this should answer true for.
 *
 * Renewing for the rest would abandon a client row on the server every time an
 * operator adds a type, per user, forever — with no route this extension can
 * call to clean one up. A refused sign-in is loud; an orphaned client is not.
 */
import { isSpacePermission } from '@withmarfa/shared';

export function needsClientRenewal(missing: readonly string[]): boolean {
  return missing.some((scope) => isSpacePermission(scope));
}

/**
 * Whether a registration claiming `claimed` still covers everything `needed`
 * asks for.
 *
 * Exact membership, because the server compares its stored ceiling exactly —
 * every reader of a ceiling is a plain membership test, and treating a
 * wildcard here as covering a literal would disagree with the surface that
 * decides.
 *
 * This is what makes a renewal idempotent. Without it, an explicit "fix my
 * permissions" that the person cancels at the consent screen mints and
 * abandons a client on every retry, because nothing records that the client
 * already standing has claimed what is being asked for.
 */
export function claimCovers(claimed: string | undefined, needed: string): boolean {
  if (claimed === undefined) return false;
  const held = new Set(claimed.split(/\s+/).filter(Boolean));
  return needed
    .split(/\s+/)
    .filter(Boolean)
    .every((scope) => held.has(scope));
}
