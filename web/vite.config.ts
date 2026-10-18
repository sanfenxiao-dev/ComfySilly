import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Cargo emits generated HTML while embedding assets. Never reload the UI for those files.
    watch: { ignored: ['**/src-tauri/**', '**/.test-results/**'] },
  },
});
