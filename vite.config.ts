import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// The Mini App is a static single-page app. It has no backend of its own: the catalog and the leads come from the
// Flaner backend at VITE_API_BASE_URL (see .env.example).
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5174,
      strictPort: true,
    },
  };
});
