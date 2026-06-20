import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single source of truth for the app version: package.json.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

// Emit dist/version.json on every build so already-open tabs can detect a new
// deploy (they fetch /version.json and compare it to the version they were built
// with — see src/components/Toast.jsx). One JSON file, always in sync with pkg.
function emitVersionJson(version) {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
    },
  };
}

// Plain Vite + React. Builds to static `dist/` so the portal can be hosted on
// any static host (Netlify, Vercel, GitHub Pages, your own server).
export default defineConfig({
  plugins: [react(), emitVersionJson(pkg.version)],
  // Inject the build-time version so the running tab knows its own version.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, open: true },
});
