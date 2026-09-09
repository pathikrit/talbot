import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
