import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@excalidraw/excalidraw',
        replacement: resolve(__dirname, 'tests/helpers/excalidraw-mock.tsx'),
      },
      { find: 'motion/react', replacement: resolve(__dirname, 'tests/helpers/motion-mock.tsx') },
      /**
       * `@open-design/components` resolves through its `development` export to
       * raw `.tsx`, but the installed copy under `node_modules` is a real
       * directory (not a symlink) on this workspace, so Vite treats it as a
       * dependency and transforms it with the CLASSIC JSX runtime — every
       * component in it then throws `ReferenceError: React is not defined` the
       * moment a test renders one.
       *
       * Pointing the bare specifier at the workspace source makes it project
       * code, which gets the automatic runtime the rest of the app uses.
       * Anchored so subpath imports (`@open-design/components/styles.css`)
       * still resolve through the package's own exports map.
       */
      {
        find: /^@open-design\/components$/,
        replacement: resolve(__dirname, '../../packages/components/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup/jsdom-lexical.ts'],
  },
});
