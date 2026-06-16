import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plain Vite + React. Builds to static `dist/` so the portal can be hosted on
// any static host (Netlify, Vercel, GitHub Pages, your own server).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
});
