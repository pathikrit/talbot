import { Chess } from 'chess.js';
import { now, parseInfo } from './protocol';
import { CandidateSet, chooseSacrifice, shortlistCandidates, SELECTOR_RESERVE_MS } from './sacrifice';
import { openingBook } from './openings';
import type { EngineRequest, EngineResponse, SearchRequest } from './protocol';

interface PatriciaModule {
  ccall(name: string, result: string | null, types: string[], args: unknown[], options?: { async: boolean }): unknown;
}
const send = (message: EngineResponse) => postMessage(message);
let engine: PatriciaModule | undefined;
let pending: SearchRequest | undefined;
let active: SearchRequest | undefined;
let resetPending = false;
let draining = false;
let initializing = false;
let failed = false;
let candidates: CandidateSet | undefined;
let bestmove: string | undefined;
const FINALIST_MULTIPV = 6;
const BROAD_SEARCH_SHARE = 0.45;

function stop(): void { engine?.ccall('talbot_stop', null, [], []); }
function fail(error: unknown): void {
  failed = true;
  pending = undefined;
  stop();
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}

interface SearchOutput { candidates: CandidateSet; bestmove?: string }
async function searchStage(position: Chess, milliseconds: number, multipv: number,
  roots?: string[]): Promise<SearchOutput> {
  candidates = new CandidateSet(Math.min(multipv, roots?.length ?? position.moves().length));
  bestmove = undefined;
  const timer = milliseconds < 0 ? undefined : setTimeout(stop, milliseconds);
  try {
    if (roots) {
      await engine!.ccall('talbot_search_moves', null, ['number', 'number', 'number', 'string'],
        [milliseconds, 0, multipv, roots.join(' ')], { async: true });
    } else {
      await engine!.ccall('talbot_search', null, ['number', 'number', 'number'],
        [milliseconds, 0, multipv], { async: true });
    }
    return { candidates, bestmove };
  } finally { clearTimeout(timer); }
}

async function drain(): Promise<void> {
  if (!engine || draining || failed) return;
  draining = true;
  try {
    // Never re-enter an Asyncify search: stop only sets a flag; all position
    // changes wait until the old asynchronous C++ call has fully unwound.
    while (pending || resetPending) {
      if (resetPending) {
        resetPending = false;
        engine.ccall('talbot_reset', null, [], []);
      }
      const job = pending;
      pending = undefined;
      if (!job) continue;
      active = job;
      const position = new Chess(job.position.fen);
      for (const move of job.position.moves) position.move(move);
      const accepted = engine.ccall('talbot_position', 'number', ['string', 'string'],
        [job.position.fen, job.position.moves.join(' ')]);
      if (accepted !== 1) throw new Error('Patricia rejected the move history.');
      try {
        if (job.deadline === undefined) {
          const ponder = await searchStage(position, -1, job.multipv ?? 1);
          if (ponder.bestmove && active === job) send({ type: 'bestmove', id: job.id, move: ponder.bestmove });
          continue;
        }
        const available = Math.max(1, Math.floor(job.deadline - now() - SELECTOR_RESERVE_MS));
        const broad = await searchStage(position, Math.max(1, Math.floor(available * BROAD_SEARCH_SHARE)),
          job.multipv ?? 1);
        if (!broad.bestmove || active !== job || pending || resetPending) continue;
        const broadBook = openingBook.choose(position, job.position, broad.candidates, broad.bestmove,
          job.opening, undefined, job.recentOpenings);
        const roots = shortlistCandidates(position.fen(), broad.candidates, broad.bestmove,
          FINALIST_MULTIPV, broadBook?.analysis.pv[0]);
        const focusedTime = Math.max(0, Math.floor(job.deadline - now() - SELECTOR_RESERVE_MS));
        const focused = focusedTime > 0
          ? await searchStage(position, focusedTime, roots.length, roots)
          : broad;
        if (!focused.bestmove || active !== job || pending || resetPending) continue;
        const book = broadBook && openingBook.choose(position, job.position, focused.candidates,
          focused.bestmove, broadBook.lineId);
        const selected = book?.analysis ?? chooseSacrifice(position.fen(), focused.candidates, focused.bestmove,
          performance.now() + Math.max(0, Math.min(80, job.deadline - now() - 5)));
        send({ type: 'bestmove', id: job.id, move: selected?.pv[0] ?? focused.bestmove,
          selected, opening: book?.lineId ?? null });
      } finally { active = undefined; }
    }
  } catch (error) { fail(error); }
  finally { draining = false; }
}

onmessage = (event: MessageEvent<EngineRequest>) => {
  const message = event.data;
  if (failed) return;
  if (message.type === 'init') {
    if (initializing) return;
    initializing = true;
    const url = new URL('patricia.js', message.assetBase).href;
    import(/* @vite-ignore */ url).then(async ({ default: createPatricia }) => {
      engine = await createPatricia({
        locateFile: (name: string) => new URL(name, message.assetBase).href,
        print: (line: string) => {
          if (!active) return;
          const analysis = parseInfo(line);
          if (analysis) {
            candidates?.add(analysis);
            send({ type: 'info', id: active.id, analysis });
          }
          const move = line.match(/^bestmove (\S+)/)?.[1];
          if (move) bestmove = move;
        },
        printErr: (line: string) => console.error('[Patricia]', line),
      });
      engine!.ccall('talbot_init', null, [], []);
      send({ type: 'ready' });
      void drain();
    }).catch(fail);
  } else if (message.type === 'search') {
    pending = message;
    active = undefined;
    stop();
    void drain();
  } else {
    pending = undefined;
    active = undefined;
    if (message.type === 'reset') resetPending = true;
    stop();
    void drain();
  }
};
