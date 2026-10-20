import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Only pure TS (src/state, src/ui/lib) is unit tested here; no React Native runtime.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  oxc: { tsconfig: false } as never,
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
