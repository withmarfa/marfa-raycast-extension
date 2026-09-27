import { defineConfig } from 'vitest/config';

/**
 * Tests live outside `src/`, because `ray lint` runs ESLint over every file in
 * the source directory and the Raycast documentation says to keep tests out of
 * it. `ray build` compiles only the manifest's entry points, so where the
 * tests sit never reaches the build.
 *
 * Only modules that never import `@raycast/api` are tested: that package ships
 * types and no runtime, since Raycast injects one when it builds. Anything
 * worth testing is written as a pure function in a module of its own.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
