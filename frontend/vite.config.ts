import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-only proxy. In production the Vite build is served by nginx, which
// reverse-proxies these paths to the backend container — so the frontend
// code can use relative URLs everywhere, dev and prod alike.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api':  'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/ws':   { target: 'ws://localhost:8080', ws: true },
    },
  },
})
