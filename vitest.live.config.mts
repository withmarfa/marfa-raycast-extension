import { defineConfig } from 'vitest/config';

/** The live suite, which needs a throwaway server: see `live/marfa.live.test.ts`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['live/**/*.test.ts'],
    testTimeout: 30_000,
    env: { TZ: 'America/New_York', LC_ALL: 'en_GB.UTF-8', LANG: 'en_GB.UTF-8' },
  },
});
