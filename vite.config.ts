/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** Version servie : commit court (CI : GITHUB_SHA) + date de build. Affichée dans Réglages et dans version.json. */
function appVersion(): string {
  const sha = process.env.GITHUB_SHA?.slice(0, 7);
  if (sha) return sha;
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}
const APP_VERSION = appVersion();
const BUILD_TIME = new Date().toISOString();

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
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'version.json');
      const statics = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg'];
      const assets = Array.from(new Set([...statics, ...files]));
      const version = `${APP_VERSION}-${Date.now().toString(36)}`;
      // version.json n'est PAS précaché : il reflète toujours la version réellement servie.
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION, build: BUILD_TIME, sw: version }) });
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
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [react(), serviceWorker(), contentSecurityPolicy()],
  build: { target: 'safari16', sourcemap: true },
  server: { host: true },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
