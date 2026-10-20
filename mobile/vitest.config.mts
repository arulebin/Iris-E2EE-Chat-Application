import { defineConfig } from 'vitest/config'

// Adapter tests run in Node against fakes; nothing here imports react-native.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
