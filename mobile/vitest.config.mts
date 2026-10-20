import { defineConfig } from 'vitest/config'

// Pure-TS unit tests only (no React Native runtime). Native modules are never imported by tested files.
export default defineConfig({
  oxc: { tsconfig: false } as never,
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
