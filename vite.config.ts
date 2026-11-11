/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/**
 * Génère `sw.js` après le build avec la liste exacte des fichiers à précacher
 * et un nom de cache unique par build (voir src/pwa/sw-template.js).
 */
function serviceWorker(): Plugin {
  let template = '';
  return {
    name: 'calame-service-worker',
    apply: 'build',
    buildStart() {
      template = readFileSync(new URL('./src/pwa/sw-template.js', import.meta.url), 'utf8');
    },
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const statics = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg'];
      const assets = Array.from(new Set([...statics, ...files]));
      const version = Date.now().toString(36);
      const code = template
        .replace('__CALAME_VERSION__', version)
        .replace('__CALAME_ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

/** Politique de sécurité du contenu, ajoutée au build uniquement (le serveur de dev a besoin de scripts inline). */
function contentSecurityPolicy(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'calame-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker(), contentSecurityPolicy()],
  build: { target: 'safari16', sourcemap: true },
  server: { host: true },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
