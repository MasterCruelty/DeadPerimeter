import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the same build works at the site root (Docker /
  // nginx) and under a sub-path (GitHub Pages: /DeadPerimeter/).
  base: './',
  server: {
    host: true,
    port: 5173,
  },
});
