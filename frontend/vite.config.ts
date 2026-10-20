import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  server: {
    proxy: {
      '/api':  'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/ws':   { target: 'ws://localhost:8080', ws: true },
    },
  },
})
