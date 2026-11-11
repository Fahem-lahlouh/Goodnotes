// Vérifie qu'aucun secret évident n'est présent dans le dépôt suivi par git ni dans le bundle (dist/).
// Ce contrôle est un filet de sécurité, pas une garantie : ne commitez jamais de secret.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const patterns = [
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'jeton GitHub'],
  [/github_pat_[A-Za-z0-9_]{40,}/, 'jeton GitHub (fine-grained)'],
  [/sk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/, 'clé API (sk-…)'],
  [/AKIA[0-9A-Z]{16}/, 'clé AWS'],
  [/AIza[0-9A-Za-z_-]{35}/, 'clé API Google'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'clé privée'],
  [/service_role/i, 'clé de service Supabase'],
  [/eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT'],
];
const ignore = [/^package-lock\.json$/, /\.png$/, /\.map$/, /^scripts\/check-secrets\.mjs$/];

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
if (existsSync('dist')) files.push(...walk('dist'));

let bad = 0;
for (const f of files) {
  if (ignore.some((r) => r.test(f)) || !existsSync(f)) continue;
  const text = readFileSync(f, 'utf8');
  for (const [re, label] of patterns) {
    if (re.test(text)) {
      console.error(`✗ ${label} possible dans ${f}`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log(`✓ aucun secret détecté (${files.length} fichiers)`);
