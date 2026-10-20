import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Only pure TS (src/**) is unit tested here; no React Native runtime. Adapter tests run against fakes.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  oxc: { tsconfig: false } as never,
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
