// Ship corresponding application and library sources beside the static binary.
// Explicit allowlist prevents accidentally packaging credentials or SDK caches.
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('.build', { recursive: true });
const release = mkdtempSync('.build/release-');
const target = `${release}/talbot`;
mkdirSync(target);
for (const path of [
  'src', 'engine', 'scripts', 'tests', '.github', 'public/THIRD-PARTY-NOTICES.txt',
  'public/licenses', 'LICENSE', 'README.md', 'AGENTS.md', 'Makefile', 'package.json', 'package-lock.json',
  'index.html', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', '.gitignore',
]) cpSync(path, `${target}/${path}`, { recursive: true });
for (const pkg of ['@lichess-org/chessground', 'chess.js']) {
  cpSync(`node_modules/${pkg}`, `${target}/third-party/${pkg}`, { recursive: true });
}
cpSync('vendor/engine/src', `${target}/vendor/engine/src`, { recursive: true });
cpSync('vendor/engine/nets', `${target}/vendor/engine/nets`, { recursive: true });
cpSync('vendor/LICENSE', `${target}/vendor/LICENSE`);
cpSync('vendor/README.md', `${target}/vendor/README.md`);
execFileSync('tar', ['-czf', 'dist/talbot-source.tar.gz', '-C', release, 'talbot']);
console.log('Packaged corresponding source: dist/talbot-source.tar.gz');
