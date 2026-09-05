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
 * `@raycast/utils` has no alias, and the stub doubles only `Icon` and `Color`,
 * because that is everything the current tests import. The next module to need
 * more brings it, rather than this accumulating a runtime nobody loads.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@raycast/api': fileURLToPath(new URL('./test/stubs/raycast-api.ts', import.meta.url)),
    },
  },
});
