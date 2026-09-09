# Talbot

A browser-only chess opponent with a taste for complications. Patricia 5.1
compiled to WebAssembly, Chessground for the board, chess.js for the rules.
Static TypeScript/Vite app: no server, account, API key, or remote engine.

## Run it

Install Node.js 24 LTS, npm, Git, curl, tar, Make, and Python 3. On macOS, install
Xcode Command Line Tools (`xcode-select --install`) for native reference tests.
On Linux, install Clang with C++20 support (Ubuntu: `sudo apt install clang make`).

```sh
make bootstrap  # download/verify Patricia, install local Emscripten 6.0.9, npm ci
make dev        # compile WASM if needed, then start Vite
```

Open the URL Vite prints. The first engine compilation takes longer than later
starts. The SDK stays in `.tools/emsdk`; nothing changes your shell profile or
global compiler. GNU Make 3.81 (the macOS default) is supported. Plain `make`
means `make build`, after bootstrap.

```sh
make gh-page       # build static dist/ for GitHub Actions / Pages
make build         # same static output, including source and licenses
make preview       # serve that production build
make test          # unit tests, perft, WASM/native parity, timing, cancellation
make bench         # engine checks plus a depth-12 native/WASM benchmark
npx playwright install chromium firefox webkit
make test-browser  # production build on /talbot/, in three browsers + mobile WebKit
npm run test:dev   # smoke-test an already running dev server on port 5173
make clean         # remove generated builds/tests; keep downloaded dependencies
make help
```

`npm run dev` and `npm run build` assume `make engine` and bootstrap have already
run. Opening `index.html` as a file is not supported; workers/WASM need HTTP(S).

## Playing

- You start as White. Click or drag pieces. Promotions offer queen, rook,
  bishop, or knight. The UI is a header, board, and Moves list.
- A left-hand evaluation bar shows Patricia's score from White's perspective
  (positive favors White, negative favors Black, `#` indicates mate). Speculative
  ponder scores do not overwrite the current position's evaluation. Captured
  pieces are grouped by the capturing side above Moves and follow undo/redo.
- Talbot replies automatically after approximately one second. Browser
  scheduling and very slow devices can introduce small overruns.
- Swap sides at any time, including during a search. You take over the other
  army immediately; the board turns with you. New game retains your chosen side.
- Undo returns to the previous decision point for your current color:
  normally your move plus the reply, or only your move if the reply is pending.
  Redo replays recorded moves without asking the engine to choose again.
- Making a different move after taking back discards the old continuation.
  If history navigation lands on the computer's turn (for example undoing
  White's opening when you play Black), analysis stays paused until you choose
  Continue from here, Redo, or Swap sides.
- Checkmate, stalemate, insufficient material, threefold repetition, and the
  fifty-move rule end the game. Draws are automatic in v1, not claim-based.
- A page refresh starts over. Games are not stored. Once the engine has loaded,
  ongoing play needs no network, but offline reload/PWA installation is not
implemented.

## What “sacrifice mode” means

Patricia has **no upstream aggression slider**. Its style is built into its
evaluation and networks. Talbot uses full-strength search (`Skill_Level=21`,
one thread, 32 MB hash, MultiPV 1), with an **experimental modification**:
retain the Feanor sacrifice network for non-endgame search roots instead of
switching networks after depth six. Below Patricia's original material threshold
it still uses Finarfin, the endgame network. All three upstream networks are
embedded and their hashes are recorded in `public/engine/provenance.json`.

This is not an upstream “maximum aggression” setting, a measured strength claim,
or a guarantee that every game contains a sacrifice. No deliberately weakened
human-skill mode, random sacrifices, book, Stockfish guardrail, or custom move
selector is enabled. Gambit preferences are deferred to a later version.

Patricia supports MultiPV 1–255, capped at the number of legal root moves.
The typed worker interface accepts `multipv` and returns indexed analysis with
depth, cp/mate score, nodes, NPS, and PV. Bound-only output is filtered out. A
future selector must collect a complete common-depth candidate set; the stream
does not imply that all candidates in flight have been searched equally deeply.

## Browser engine architecture

The upstream commit is pinned to
`f1ee4273c6e6068bd6ec0d53ca91c1c391543f85` (Patricia 5.1). Bootstrap checks the
source archive's SHA-256. The original downloaded source is left untouched in
`vendor/`; mechanical patches are applied to `.build/patricia` during compilation.

The adapter bypasses native UCI input and thread creation. Portable aligned
arrays embed the networks; tablebases are disabled; a 32 MB-compatible
multiply-high implementation avoids wasm32's missing `__int128`. Scalar NNUE
is the reference implementation (no x86 or WASM SIMD flags). Asyncify yields
roughly every 12 ms, allowing stop requests without a SharedArrayBuffer,
pthreads, COOP/COEP headers, service workers, or main-thread search.

On your turn, the worker searches a hypothetical predicted reply from the last
PV when one is available, or the current position otherwise. These results
never make real moves. On your move, the old search stops and fully unwinds,
then a timed search starts at the actual position, retaining the transposition
table. This is application-level background analysis, **not native UCI
`ponderhit` support**. Cancellation time counts toward the one-second reply
budget; early results are held until the deadline. Hidden tabs stop analysis
and get a fresh reply budget on return. Background thinking uses a CPU core and
can consume battery while the tab is visible.

Search revisions protect against late replies after undo, swap, or restart.
Only chess.js-approved moves reach the board; failures are visible rather than
silently replaced with another engine. The WASM/native parity test compares
the same Talbot variant on both targets, not unmodified upstream strength.

## GitHub Pages

Push this repository to GitHub, then select **Settings → Pages → Source → GitHub
Actions**. The included workflow runs `make gh-page` to produce the static site,
tests and builds on pushes to `main`/`master`,
tests pull requests without deployment, and deploys only the repository's default
branch. A manual workflow run also supports another default-branch name.

Relative assets work at `https://OWNER.github.io/REPO/` or a custom-domain root.
The browser test server deliberately mounts the production build at `/talbot/`
without URL rewrites or cross-origin-isolation headers. No GitHub remote or
Pages site is automatically created by the local build.

## Open source

The application and adapter are GPL-3.0-only; Patricia is MIT, Chessground is
GPL-3.0-or-later, and chess.js is BSD-2-Clause. The Cburnett pieces use their
GPL-compatible license option. See [notices](public/THIRD-PARTY-NOTICES.txt).
Production builds include full notices/licenses and a corresponding-source
archive (application, adapter, build instructions, Patricia/networks, and the
board/rules dependency sources) alongside the app. No warranty is provided.
