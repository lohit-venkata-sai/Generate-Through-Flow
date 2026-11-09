import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from "node:url";
import manifest, { APP_VERSION } from "./manifest.config.ts"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  // Version shown in the app footer, inlined at build time. It comes from
  // manifest.config.ts — the value chrome://extensions displays — so the
  // footer can never drift from the installed extension version.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
