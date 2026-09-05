import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Two things here are specific to a Raycast extension and are the reason this
 * config does not simply mirror the sibling packages.
 *
 * **Tests live outside `src/`.** `ray lint` runs ESLint over every file in the
 * source directory, and the Raycast documentation says to keep test files out of
 * it. The sibling repositories colocate tests beside source; none of them is a
 * Raycast extension, so the convention worth copying from them is vitest itself,
 * not where the files sit.
 *
 * The build half of that is not a risk, and it is worth writing down because the
 * documentation does not say either way: `ray build` reports the entry points it
 * compiles and they are exactly the commands the manifest declares, so it would
 * never have bundled a test file wherever it sat. Lint is the half that decides
 * this, and lint alone is enough.
 *
 * **`@raycast/api` is a types-only package.** Its manifest declares `types` and
 * no `main`, `module` or `exports`, because Raycast injects the runtime when it
 * builds the extension. Anything importing it as a value, such as an `Icon`, a
 * `Color` or `LocalStorage`, is therefore unimportable under a plain Node
 * runner, which is most of the logic worth testing. The alias below stands in
 * for that injected runtime. It resolves only here: `tsconfig.json` and
 * `ray build` never see it, so nothing that ships depends on a stub.
 *
 * Types still come from the real package, so substituting the runtime cannot
 * change what any source file is checked against.
 *
 * Each stub doubles only what something under test actually loads. The next
 * module to need more brings it, rather than this accumulating a runtime nobody
 * calls.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Date rendering converts an instant to the reader's own day before it
    // decides what to call it, so an unpinned zone makes those tests report on
    // the machine rather than on the code: a fixture that is yesterday in
    // London is today in UTC, and the suite would pass here and fail in CI.
    // Deliberately not UTC. A zone with a real offset is what exercises the
    // conversion at all, and an implementation that assumed UTC would pass
    // against UTC and be wrong for every reader.
    //
    // The locale is pinned for the same reason and one more: these functions
    // are supposed to render in whatever locale the machine is set to, and an
    // expectation built from the runtime default can only prove that on a
    // machine whose default is not the one the code used to hardcode. Pinning a
    // different one is what makes re-hardcoding `en-US` a failing test rather
    // than a silent pass.
    // The locale half of this works because the default `forks` pool passes the
    // environment when it spawns a worker; ICU fixes its default at process
    // start and does not reread it. Moving to `pool: 'threads'` would silently
    // leave the locale at the runner's own, and the delegation assertions would
    // then pass against a hardcoded literal again. `TZ` survives either way,
    // since Node reacts to assigning it.
    env: { TZ: 'America/New_York', LC_ALL: 'en_GB.UTF-8', LANG: 'en_GB.UTF-8' },
  },
  resolve: {
    alias: {
      '@raycast/api': fileURLToPath(new URL('./test/stubs/raycast-api.ts', import.meta.url)),
      '@raycast/utils': fileURLToPath(new URL('./test/stubs/raycast-utils.ts', import.meta.url)),
    },
  },
});
