import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';

const commit = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return process.env.GITHUB_SHA ?? ''; }
})();

export default defineConfig({
  base: './',
  define: { __GIT_SHA__: JSON.stringify(commit) },
  // npm ci removes node_modules; keep a live server's optimized modules outside
  // it so an install cannot leave imports pointing at missing cached files.
  cacheDir: '.cache/vite',
  optimizeDeps: { include: ['@lichess-org/chessground', 'chess.js'] },
  server: {
    strictPort: true,
    watch: { ignored: ['**/.build/**', '**/.tools/**', '**/vendor/**', '**/.cache/**'] },
  },
  worker: { format: 'es' },
});
