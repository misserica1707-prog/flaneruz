import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

// The Mini App is a static single-page app. It has no backend of its own: the catalog and the leads come from the
// Flaner backend at VITE_API_BASE_URL (see .env.production and .env.example).

/**
 * A production build must know the backend and reach it over HTTPS: Telegram serves the Mini App over HTTPS, so a plain
 * http backend would be blocked as mixed content. http is accepted for localhost only (local end-to-end testing).
 */
function assertBackendUrl(value: string | undefined): void {
  const url = (value ?? '').trim();
  if (!url) {
    throw new Error('VITE_API_BASE_URL is required for a production build, e.g. https://flaner.onrender.com (see .env.production).');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`VITE_API_BASE_URL is not a valid URL: "${url}"`);
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    throw new Error(`VITE_API_BASE_URL must use https (got "${url}"): the Mini App is served over HTTPS.`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`VITE_API_BASE_URL must be an origin without a path, query or fragment (got "${url}").`);
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    assertBackendUrl(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL);
  }

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
    // `npm start` serves the built files (dist/) on the port the host provides (Render sets PORT).
    preview: {
      host: '0.0.0.0',
      port: Number(process.env.PORT) || 4173,
      strictPort: true,
      // Any public host name is fine: the app is static and public. (Vite would otherwise reject the onrender.com Host header.)
      allowedHosts: true,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        // Telegram Web embeds Mini Apps in an iframe, so framing is allowed for Telegram only (not for arbitrary sites).
        'Content-Security-Policy': "frame-ancestors 'self' https://telegram.org https://*.telegram.org",
      },
    },
  };
});
