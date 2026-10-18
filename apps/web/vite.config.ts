import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // §user request — reachable from a phone/simulator on the same machine (Android emulator's
    // 10.0.2.2 host alias, or a real device on the LAN), not just the dev machine's own browser.
    host: true,
    proxy: {
      '/trpc': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
})
