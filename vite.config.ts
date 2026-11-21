import { defineConfig } from 'vite';

// A relative base lets the built game be served from any folder: its own host, or the
// Webcam bridge's /play/ mount.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5183 },
});
