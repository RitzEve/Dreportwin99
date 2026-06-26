import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single source of truth for the app version: package.json.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

// Emit dist/version.json on every build so already-open tabs can detect a new
// deploy (they fetch /version.json and compare it to the version they were built
// with — see src/components/UpdateBell.jsx). It also carries the "what's new"
// notes (package.json -> "whatsNew") so a stale tab can show what changed in the
// version it doesn't have yet. One JSON file, always in sync with pkg.
function emitVersionJson(version, notes) {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, notes: notes || [] }) });
    },
  };
}

// Plain Vite + React. Builds to static `dist/` so the portal can be hosted on
// any static host (Netlify, Vercel, GitHub Pages, your own server).
export default defineConfig({
  plugins: [react(), emitVersionJson(pkg.version, pkg.whatsNew)],
  // Inject the build-time version so the running tab knows its own version.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, open: true },
});
