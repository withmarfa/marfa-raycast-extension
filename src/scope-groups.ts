/**
 * A scope list, arranged the way it reads rather than the way it arrives.
 *
 * Almost every scope is `<resource>:<access>`, and the same resource appears
 * once for `read` and once for `write`. Pairing those halves the rows, and the
 * leading segment of the resource sorts what is left into the families a person
 * already thinks in, such as `core`, `edge` or `system`.
 *
 * Pure and free of Raycast, so the arrangement is testable on its own.
 */

/** One resource, and the accesses over it that the caller's list held. */
export interface ScopeGroup {
  /** `core.bookmark`, `edge.*`, or the whole scope when it carries no access. */
  resource: string;
  /** `read`, `write`, and empty for a scope that names no access at all. */
  accesses: string[];
  /** The original scope strings, so a copy action reproduces them exactly. */
  scopes: string[];
}

export interface ScopeFamily {
  name: string;
  /** Ready to render as a section title. */
  label: string;
  groups: ScopeGroup[];
  /** Scopes, not rows. Eighteen permissions are what is missing, however few
   *  rows they pair down to. */
  scopeCount: number;
}

/**
 * `profile` is an OpenID scope here and a resource in `profile:read`, so the
 * scopes carrying no access need a family of their own. Keying on the name
 * alone would merge two unrelated things.
 */
const SIGN_IN_FAMILY = 'sign-in';

/** A Map rather than an object literal, because the key comes from a remote
 *  document and `constructor` would otherwise resolve to something inherited. */
const FAMILY_LABELS = new Map([
  ['*', 'Everything'],
  [SIGN_IN_FAMILY, 'Sign-in'],
]);

/** Identifiers, so a code unit comparison rather than a collator whose answer
 *  depends on the reader's locale. The order also has to agree with what the
 *  copy action produces, and `localeCompare` cannot promise that. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Split at the last colon, so a resource that ever contains one still parses. */
function splitScope(scope: string): { resource: string; access: string | null } {
  const at = scope.lastIndexOf(':');
  if (at <= 0 || at === scope.length - 1) return { resource: scope, access: null };
  return { resource: scope.slice(0, at), access: scope.slice(at + 1) };
}

function familyOf(resource: string, access: string | null): string {
  if (access === null) return SIGN_IN_FAMILY;
  const dot = resource.indexOf('.');
  return dot === -1 ? resource : resource.slice(0, dot);
}

/** Group by family, then by resource, both sorted. Wildcards lead, because `*`
 *  sorts ahead of every letter. */
export function groupScopes(scopes: string[]): ScopeFamily[] {
  const families = new Map<string, Map<string, ScopeGroup>>();

  for (const scope of scopes) {
    // An empty scope would render as a row with no title, which reads as a bug
    // in this list rather than as the server having sent something odd.
    if (scope.trim() === '') continue;
    const { resource, access } = splitScope(scope);
    const familyName = familyOf(resource, access);
    let byResource = families.get(familyName);
    if (!byResource) {
      byResource = new Map();
      families.set(familyName, byResource);
    }
    const group = byResource.get(resource);
    if (group) {
      if (access !== null) group.accesses.push(access);
      group.scopes.push(scope);
    } else {
      byResource.set(resource, {
        resource,
        accesses: access === null ? [] : [access],
        scopes: [scope],
      });
    }
  }

  return [...families.entries()]
    .map(([name, byResource]) => {
      const groups = [...byResource.values()]
        .map((group) => ({
          ...group,
          // `read` before `write` falls out of sorting, and sorting is what
          // keeps a row stable when the server changes the order it advertises.
          accesses: [...group.accesses].sort(byName),
          scopes: [...group.scopes].sort(byName),
        }))
        .sort((a, b) => byName(a.resource, b.resource));
      return {
        name,
        label: FAMILY_LABELS.get(name) ?? name,
        groups,
        scopeCount: groups.reduce((total, group) => total + group.scopes.length, 0),
      };
    })
    .sort((a, b) => byName(a.name, b.name));
}

/** Every scope, in the order the grouped list shows them, so a copy action and
 *  the screen cannot disagree. */
export function flattenScopes(families: ScopeFamily[]): string[] {
  return families.flatMap((family) => family.groups.flatMap((group) => group.scopes));
}
