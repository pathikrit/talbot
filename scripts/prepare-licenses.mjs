import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/licenses', { recursive: true });
for (const [from, name] of [
  ['LICENSE', 'GPL-3.0.txt'],
  ['node_modules/@lichess-org/chessground/LICENSE', 'CHESSGROUND-LICENSE.txt'],
  ['node_modules/chess.js/LICENSE', 'CHESS-JS-LICENSE.txt'],
  ['vendor/LICENSE', 'PATRICIA-LICENSE.txt'],
  ['.tools/emsdk/upstream/emscripten/LICENSE', 'EMSCRIPTEN-LICENSE.txt'],
  ['book/licenses/lichess.txt', 'OPENINGS-LICHESS-CC0.txt'],
  ['book/licenses/eco.txt', 'OPENINGS-ECO-MIT.txt'],
]) cpSync(from, `public/licenses/${name}`);
