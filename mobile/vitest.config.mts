import { defineConfig } from 'vitest/config'

// Unit tests cover the platform-neutral call engine only (no React Native runtime).
export default defineConfig({
  oxc: { tsconfig: false } as never,
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
