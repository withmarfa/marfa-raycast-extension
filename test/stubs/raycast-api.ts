/**
 * The runtime Raycast injects, in the smallest form the tests need.
 *
 * `@raycast/api` ships types and no runtime, so a plain Node process cannot
 * import it as a value. `vitest.config.mts` aliases the package here. Only the
 * runtime is substituted: `tsc` still resolves the package name to the real
 * declarations, so nothing here can change what a source file is checked
 * against.
 *
 * **`Icon` and `Color` are proxies, and this is the part a stub cannot keep
 * honest.** Raycast carries several hundred icons and adds more every release,
 * so a hand-written copy of either enum would go stale in exactly the way this
 * extension's display resolver exists to avoid. Returning each member's own
 * name gives a stable distinct value, which is all any comparison here depends
 * on.
 *
 * Two costs, and the second is the one that misleads. A member the platform
 * renames or removes still resolves through the proxy, so a test could keep
 * passing against an icon that no longer exists; `npm run typecheck` catches
 * that, because it reads the real enum rather than this file. And the proxy
 * makes every member distinct when the real enum does not: `Icon.Document`,
 * `Icon.BlankDocument` and `Icon.TextDocument` are all `blank-document-16`
 * there. So an assertion that two types resolve to different members proves the
 * resolver chose differently, and proves nothing about whether a person would
 * see two different glyphs.
 *
 * Nothing else is doubled. The next module to need `LocalStorage` or a hook
 * brings its own double with it, rather than this growing a runtime nobody
 * loads.
 */

function nameKeyedEnum(): Record<string, string> {
  return new Proxy(
    {},
    {
      get: (_target, property) => (typeof property === 'string' ? property : undefined),
    },
  ) as Record<string, string>;
}

export const Icon = nameKeyedEnum();
export const Color = nameKeyedEnum();
