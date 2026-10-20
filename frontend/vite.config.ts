import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// public/sw.js is copied verbatim; give it a per-build cache name so a deploy
// never serves the previous build's cached shell/assets.
function stampServiceWorker(): Plugin {
  return {
    name: 'iris-stamp-sw',
    apply: 'build',
    writeBundle(options) {
      const file = join(options.dir ?? 'dist', 'sw.js')
      if (!existsSync(file)) return
      const buildId = Date.now().toString(36)
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__BUILD_ID__', buildId))
    },
  }
}

// Dev-only proxy. In production the Vite build is served by nginx, which
// reverse-proxies these paths to the backend container — so the frontend
// code can use relative URLs everywhere, dev and prod alike.
//
// @iris/core (../packages/core) is consumed as TypeScript SOURCE through this alias
// (and the matching tsconfig `paths`), not through npm workspaces: the web app pins
// React 19.2 and the React Native app needs 19.3.0 exactly, and one hoisted
// node_modules would force a single React on both. The alias keeps frontend/ a
// standalone npm project with its own lockfile and node_modules; core's runtime
// deps are resolved from HERE (dedupe), so there is exactly one copy of
// libsignal in the bundle.
export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  resolve: {
    alias: [
      { find: /^@iris\/core$/, replacement: fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url)) },
    ],
    dedupe: ['@privacyresearch/libsignal-protocol-typescript', '@noble/curves', '@noble/hashes'],
  },
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api':  'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/ws':   { target: 'ws://localhost:8080', ws: true },
    },
  },
})
