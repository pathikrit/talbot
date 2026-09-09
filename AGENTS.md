# Agent learnings

Keep README.md limited to the user's one-liner, build badge, and `make dev`.
Technical documentation belongs in this file.

- Preserve the minimal UI: talbot header, New game / Swap sides, wooden board,
  left-hand evaluation bar and capture strip, Undo / Redo.
  No marketing copy, status cards, footer, or keyboard-entry form.
- Keep Undo/Redo text labels. Left/Right arrow keys trigger the same buttons;
  ignore modified keys, editable fields, and the promotion dialog.
- Black captured pieces disappear on charcoal. Use a muted warm-taupe capture tray.
  Show every capture individually, no count badges; each gets half a board square
  in height. Align type groups across both columns using the larger group's count.
- Derive captures from history through the cursor, not material differences,
  so promotions, en passant, and Undo/Redo work correctly.
- Convert scores from side-to-move to White's perspective exactly once.
  Ignore hypothetical ponder scores for the visible board. Preserve actual-root
  evaluation after engine moves; swap bar orientation without negating its label.
- Guard Chessground updates by FEN, human color, and move permission; analysis
  updates must not interrupt dragging. Invalidate the guard on promotion cancel
  or invalid optimistic moves.
- Chessground move callbacks are asynchronous. Tests should wait for thinking
  status or a changed FEN before recording the position after a click.
- Vite caches dependencies in .cache/vite. Running npm ci with a live Vite
  server previously deleted dependency files, causing 504 Outdated Optimize Dep
  and a blank page. Avoid concurrent dependency installation and dev/build/tests.
- Ignore .build, .tools, vendor, and .cache in Vite's watcher. Source packaging
  creates index.html/tsconfig copies that otherwise trigger spurious reloads.
  Keep bootstrap's explicit startup error fallback. Dev test route patterns
  must handle timestamp queries: **/src/main.ts*.
- Test production at /talbot/, not only /. Playwright covers Chromium, Firefox,
  WebKit, and mobile WebKit. npm run test:dev checks an already-running server
  on both localhost and 127.0.0.1.
- Engine parity checks include startpos depth-4 perft 197281, Kiwipete depth-3
  97862, endgame/en-passant depth-4 43238, MultiPV, timing, and cancellation.
  Benchmark timings are machine-dependent, not guarantees.
- Keep generated binaries, SDK, vendor, licenses, and test/build artifacts out
  of git. Native/WASM builds share generated sources; Make disables parallelism.
- Keep AGENTS.md in scripts/package-source.mjs's allowlist because it contains
  the corresponding-source build instructions.
- GitHub remote is git@github.com:pathikrit/talbot.git; main tracks origin/main.
- Engine build scripts require Bash: Emscripten's environment script cannot
  locate its SDK when sourced through Ubuntu's dash (/bin/sh). Keep Make's
  explicit bash invocation as well as the build script's Bash shebang.
- CI disables the hosted runner's unused Google Chrome apt repository before
  Playwright dependency installation: its stale mirror caused repeated hash
  mismatches. Playwright supplies its own browsers; retain apt verification.

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
  pieces are grouped by capturing side between evaluation and board and follow undo/redo.
- Talbot replies automatically after approximately one second. Browser
  scheduling and very slow devices can introduce small overruns.
- Swap sides at any time, including during a search. You take over the other
  army immediately; the board turns with you. New game retains your chosen side.
- Undo returns to the previous decision point for your current color:
  normally your move plus the reply, or only your move if the reply is pending.
  Redo replays recorded moves without asking the engine to choose again.
- Making a different move after taking back discards the old continuation.
  If history navigation lands on the computer's turn (for example undoing
  White's opening when you play Black), the engine automatically starts a fresh
  one-second reply. Further navigation cancels it; there is no Continue button.
- Checkmate, stalemate, insufficient material, threefold repetition, and the
  fifty-move rule end the game. Draws are automatic in v1, not claim-based.
- A page refresh starts over. Games are not stored. Once the engine has loaded,
  ongoing play needs no network, but offline reload/PWA installation is not
implemented.

## What “sacrifice mode” means

Patricia has **no upstream aggression slider**. Its style is built into its
evaluation and networks. Talbot uses full-strength search (`Skill_Level=21`,
one thread, 32 MB hash, MultiPV 20 by default), with an **experimental modification**:
retain the Feanor sacrifice network for non-endgame search roots instead of
switching networks after depth six. Below Patricia's original material threshold
it still uses Finarfin, the endgame network. All three upstream networks are
embedded and their hashes are recorded in `public/engine/provenance.json`.

This is not an upstream “maximum aggression” setting, a measured strength claim,
or a guarantee that every game contains a sacrifice. No deliberately weakened
human-skill mode, random sacrifices, or Stockfish guardrail is enabled.

Patricia supports MultiPV 1–255, capped at the number of legal root moves.
The typed worker interface accepts `multipv` and returns indexed analysis with
depth, cp/mate score, nodes, NPS, and PV. Bound-only output is filtered out.

### Sacrifice selection

`src/engine/sacrifice.ts` chooses the largest verified net material offer within
50cp of the best candidate by default, breaking size ties by better evaluation
and then MultiPV order. Search requests 20 distinct root moves, capped
at the legal move count, during both timed play and pondering. Only the latest
complete common-depth batch (depth >= 4) is comparable. Partial newer iterations
do not replace it. Mate scores disable selection; an unavailable fallback move,
incomplete batch, or no qualifying offer leaves Patricia's best move unchanged.

Root `settings.json` has one setting: `maxSacrificeLossCp`, the allowed evaluation
loss (nonnegative integer). MultiPV is internal (`SEARCH_MULTIPV` in src/settings.ts),
not another user-facing style parameter. The worker imports validated build-time
settings. Refresh after
editing in dev; rebuild/redeploy for GitHub Pages. No runtime configuration fetch
or UI controls are added. Keep settings.json in the source-package allowlist.
Wider MultiPV reduces search depth within the unchanged one-second budget.

Acceptance is checked separately from the main PV: **declined offers count**.
Require a new immediate legal capture that leaves Talbot at least a pawn worse
in net material relative to the root, accounting for its own initial capture.
This includes rook-for-knight and queen-for-rook sacrifices, not equal trades.
An unrelated move leaving an already attacked piece in place does not qualify.
The supplied acceptance PV must not regain the investment. A bounded material
minimax follows captures, promotions, checks and all check evasions to reject
immediate recovery even when the main PV declines the offer.
Rank the material still given up after recovery, capped at the immediate net
investment; e.g. rook for knight is 180 material points, not 500. Inspect all
acceptances and eligible candidates until the probe budget expires rather than
returning the first sacrifice. Keep the largest verified offer if time runs out.
Unresolved acceptance lines are skipped and do not erase already verified ones.

This is a conservative **heuristic**, not proof of a true long-term sacrifice:
quiet tactics outside the PV and deferred offers are not fully resolved. The
material probe does not establish positional soundness; Patricia's root score
estimates that. A six-ply unresolved tactical frontier, mate, invalid PV or
exhausted probe budget makes that offer unclassified. Do not describe the cp
budget as a guaranteed strength or safety bound.

Reserve 100ms of the existing one-second wall-clock deadline; probing uses at
most 80ms / 1500 nodes across candidates, with time checks between nodes. Browser
scheduling or a costly individual node may overrun slightly. Probing runs only
in the worker after the timed search unwinds. Pondering retains MultiPV/TT work,
but its speculative candidates are never reused as actual-root evidence.
Chosen moves return their own analysis/PV so evaluation and the next ponder
prediction match the move actually played. Cancelled jobs must not select or
emit a result. The controller still holds early replies until the deadline.

### Opening repertoire

`book/opening-book.json` is a checked-in, offline-compiled book: 486 legal lines
in 26 explicitly side-tagged families, with gambits/traps weighted above ordinary
openings. It includes Alien, Evans, King's, Queen's, Stafford, and named traps.
The initial draw selects a family by weight, then a distinct move, then a line;
duplicate source records or prolific families do not increase family probability.
Choose once, on the first available engine turn within the first four plies.
After that, follow that exact line, not a new random branch every move. Compatible
same-position transpositions are supported without rewinding along the line.

Book choices require the same complete, depth >= 4, common-depth MultiPV batch
and configured cp allowance as the sacrifice selector. No mate-score override,
unsearched move, or forced unsound gambit. On a deviation, line end, missing
candidate, or failed evaluation guard, permanently leave the book on that branch
and use largest-sacrifice selection, then Patricia's best move. A book line is
preferred to other sacrifices while it qualifies, including preparatory moves.
Opening lookup is worker-only and local; normal engine thinking and pondering
continue even in book positions. Speculative searches never choose a book line.

The controller stores per-color opening plans with each history cursor, only
when a real move commits. Undo/redo restores plans without rerandomizing recorded
moves; a new branch discards future plans, swaps keep plans attached to their
playing side, and New game clears all plans. Custom starting FENs do not enter
the book. Keep all of this out of the minimal UI and settings.json.

Maintenance: `npm run book:compile` regenerates the book offline;
`npm run book:check` verifies reproducibility and is a CI gate. To deliberately
refresh upstream data, update book/sources.json pins and run
`node scripts/compile-book.mjs --download`, then review source/provenance changes.
Normal make dev/build/bootstrap does not download or regenerate the book.
Source snapshots are compressed under book/sources, and licenses under book/licenses.
Lichess is CC0. From MIT eco.json retain only eco_js and CC0 eco_tsv records;
strip aliases and omit imports from other differently licensed sources even
from archived compiler inputs. book/provenance.json records snapshot hashes,
source revisions, excluded origins, rejected PGNs and per-line attribution.
The explicit family allowlist in book/families.json identifies the gambit/trap
playing side; do not auto-enable every named trap for both sides. Unknown or
ambiguous families stay excluded. Keep book/ in corresponding-source packaging,
ship both license texts in public/licenses, and leave README edits to the user.

## Browser engine architecture

Sounds are unmodified Chess.com default MP3s from the Orivoir mirror, pinned
in src/assets/sound with notices and SHA-256 provenance. The mirror has no public
license; the project owner confirmed redistribution permission on 2026-09-09.
Do not describe these assets as GPL/OSS or grant downstream reuse rights.
Do not synthesize substitute sounds or change playback pitch.
Only controller-committed human/engine moves emit sound; capture includes en passant.
Six clips: move-self, move-opponent, capture, castle, move-check, promote.
One sound per move: check/mate > promotion > castle > capture > self/opponent.
No countdown/result/UI sounds; checkmate uses the check clip, not a defeat sound.
Undo/redo/seek/ponder/cancelled replies stay silent. Audio unlocks on user gestures,
does not queue blocked sounds, and failures never block chess. A small header toggle
mutes sound for the session. Vite bundles six MP3s (30,198 bytes total); preload
locally at startup, decode after gesture unlock, and never fetch third-party URLs.

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

The header's version link embeds the build-time Git HEAD SHA (GITHUB_SHA fallback
for builds without Git metadata). It links directly to that GitHub commit; local
uncommitted edits are not represented by the SHA. Restart dev after changing HEAD.
The move-list toolbar has no visible heading and holds five controls in order: New game/Resign, Offer/Accept draw,
Swap sides, Undo, Redo. New game becomes Resign after a
move or while the engine starts as White. Resigning records the current human
color, cancels searches and buffered replies, and locks play; swapping does not
change the result. Undo/redo navigation clears resignation to allow exploration.
Agreement draws behave the same way. All messaging (status, results, draw offers,
and errors) belongs centered beneath the board, not in Moves.
Draw negotiation is an application policy, not a native Patricia/UCI offer:
use actual-root depth >= 8 evaluation, accepting if engine score <= 20cp or
it faces a forced mate. Unknown/shallow scores wait; speculative ponder scores
never decide offers. An engine move may offer after 40 plies if its score is
within ±20cp, at least 20 plies since its last offer. Accept/Decline appears inline beneath the board;
Escape declines. Swaps/history changes/new moves clear pending offers. Draw
agreement cancels buffered replies and searches. Fifty-move and threefold draws
remain automatic app adjudication (not tournament claim UI); checkmate takes
precedence over the fifty-move rule. Do not advertise full FIDE claim handling.
Captured pieces sit between evaluation and board in two aligned columns, ordered
queen/rook/bishop/knight/pawn with individual icons and a warm-taupe tray.
ResizeObserver sizes capture rows to board width / 16; exceptionally more aligned
rows (from promotions) shrink proportionally to fit without overflowing the material badge.
The bottom of the capture strip shows Even or the leading color and +N material.
Calculate White-minus-Black from the current board, not capture totals, so promotions
work: pawn 1, bishop/knight 3, rook 5, queen 9, king 0. Keep separate from engine eval.
Omit a type's row when neither side has captured it, avoiding empty gaps above pawns.
Move-list buttons seek to the position immediately after that move, preserving
future history for replay. Controller.seek cancels stale searches; computer-turn
positions automatically restart the reply timer, while human-turn positions allow branching.

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
