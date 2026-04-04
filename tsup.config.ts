import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/status.ts', 'src/commit.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
