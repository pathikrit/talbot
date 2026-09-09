import { Chess } from 'chess.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';
import type { Analysis } from './protocol';
import { settings } from '../settings';

export const SELECTOR_RESERVE_MS = 100;
const values: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const uci = (move: Move) => move.from + move.to + (move.promotion ?? '');

/** Keep only complete, distinct, common-depth sets, never an in-flight mixture. */
export class CandidateSet {
  private depth = 0;
  private pending = new Map<number, Analysis>();
  complete: Analysis[] = [];
  latestBest?: Analysis;

  constructor(private count: number) {}

  add(info: Analysis): void {
    if (info.multipv === 1) this.latestBest = info;
    if (info.depth < this.depth || info.multipv < 1 || info.multipv > this.count) return;
    if (info.depth > this.depth || info.multipv === 1) {
      this.depth = info.depth;
      this.pending.clear();
    }
    this.pending.set(info.multipv, info);
    if (this.pending.size !== this.count) return;
    const batch = [...this.pending.values()].sort((a, b) => a.multipv - b.multipv);
    if (new Set(batch.map(info => info.pv[0])).size === this.count) this.complete = batch;
  }
}

function material(chess: Chess, side: Color): number {
  return chess.board().flat().reduce((sum, piece) => sum + (piece
    ? values[piece.type] * (piece.color === side ? 1 : -1) : 0), 0);
}

export interface ProbeBudget { expires: number; nodes: number }
function tick(budget: ProbeBudget): void {
  if (--budget.nodes < 0 || performance.now() >= budget.expires) throw new Error('Unresolved sacrifice');
}

/** Material-only tactical minimax, NOT a second positional chess engine.
 * Follow captures, promotions, checks and every check evasion. Never classify an
 * unresolved frontier or mate as a material sacrifice. Quiet long-term tactics
 * remain outside this bounded heuristic; Patricia supplies the positional score.
 */
function settle(chess: Chess, side: Color, budget: ProbeBudget, depth = 6,
  alpha = -Infinity, beta = Infinity): number {
  tick(budget);
  const checked = chess.isCheck();
  const moves = chess.moves({ verbose: true });
  if (!moves.length) {
    if (checked) throw new Error('Mate is not a material score');
    return material(chess, side);
  }
  const tactical = checked ? moves : moves.filter(move => move.captured || move.promotion || /[+#]$/.test(move.san));
  if (!tactical.length) return material(chess, side);
  if (!depth) throw new Error('Unresolved tactical frontier');
  const maximizing = chess.turn() === side;
  let best = checked ? (maximizing ? -Infinity : Infinity) : material(chess, side);
  if (maximizing) alpha = Math.max(alpha, best);
  else beta = Math.min(beta, best);
  if (alpha >= beta) return best;
  tactical.sort((a, b) => (values[b.captured ?? 'k'] - values[b.piece]) - (values[a.captured ?? 'k'] - values[a.piece]));
  for (const move of tactical) {
    chess.move(uci(move));
    let value: number;
    try { value = settle(chess, side, budget, depth - 1, alpha, beta); }
    finally { chess.undo(); }
    best = maximizing ? Math.max(best, value) : Math.min(best, value);
    if (maximizing) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/** An immediate, newly created offer whose acceptance leaves a net material
 * loss after tactical recovery. Includes declined offers and exchange sacrifices
 * (rook for minor), but excludes equal trades and already hanging pieces.
 */
export function sacrificeSize(fen: string, pv: string[], budget: ProbeBudget): number {
  const root = new Chess(fen);
  const side = root.turn();
  const opponent = side === 'w' ? 'b' : 'w';
  const baseline = material(root, side);
  const chess = new Chess(fen);
  let largest = 0;
  try {
    tick(budget);
    // Reject truncated/malformed lines rather than inventing a continuation.
    for (const move of pv) chess.move(move);
    while (chess.history().length) chess.undo();
    const offered = chess.move(pv[0]);
    const acceptances = chess.moves({ verbose: true }).filter(move => move.captured);
    for (const capture of acceptances) {
      tick(budget);
      const square = (capture.isEnPassant() ? capture.to[0] + capture.from[1] : capture.to) as Square;
      // A relocated piece is a fresh offer. For pieces left in place, require
      // a newly opened attack rather than counting an old hanging piece.
      if (square !== offered.to && root.isAttacked(square, opponent)) continue;
      chess.move(uci(capture));
      try {
        let loss = baseline - material(chess, side);
        if (loss < 100) continue;
        // If the supplied acceptance PV recovers the investment, do not call
        // it a lasting sacrifice, even if recovery involves quiet moves.
        if (pv[1] === uci(capture)) {
          const continuation = new Chess(chess.fen());
          for (const move of pv.slice(2)) {
            continuation.move(move);
            loss = Math.min(loss, baseline - material(continuation, side));
          }
          if (loss < 100) continue;
        }
        // Rank net investment, not the face value of the piece captured.
        // Cap at the immediate offer to exclude unrelated later material loss.
        loss = Math.min(loss, baseline - settle(chess, side, budget));
        if (loss >= 100) largest = Math.max(largest, loss);
      } catch { /* An unresolved acceptance does not erase a verified one. */
      } finally { chess.undo(); }
    }
  } catch { /* Invalid line, exhausted budget or unresolved tactics: abstain. */ }
  return largest;
}

export function offersSacrifice(fen: string, pv: string[], budget: ProbeBudget): boolean {
  return sacrificeSize(fen, pv, budget) >= 100;
}

/** Shared safety gate for book moves and material-sacrifice selection. */
export function eligibleCandidates(candidates: CandidateSet, fallback: string): Analysis[] {
  const batch = candidates.complete;
  // Mate scores aren't centipawns. Preserve engine mating decisions, including
  // a mate discovered during the next incomplete iteration.
  if (candidates.latestBest?.score.kind === 'mate' || !batch.length || batch[0].depth < 4
    || batch.some(info => info.score.kind !== 'cp') || !batch.some(info => info.pv[0] === fallback)) return [];
  const best = Math.max(...batch.map(info => info.score.value));
  return batch.filter(info => best - info.score.value <= settings.maxSacrificeLossCp)
    .sort((a, b) => b.score.value - a.score.value || a.multipv - b.multipv);
}

export function chooseSacrifice(fen: string, candidates: CandidateSet, fallback: string,
  expires = performance.now() + 80): Analysis | undefined {
  const eligible = eligibleCandidates(candidates, fallback);
  const budget = { expires, nodes: 1500 };
  let selected: Analysis | undefined;
  let largest = 0;
  for (const info of eligible) {
    const size = sacrificeSize(fen, info.pv, budget);
    // Candidates are evaluation-sorted, so equal-sized offers keep the better
    // score (then the original MultiPV order). Retain verified work on timeout.
    if (size > largest) { largest = size; selected = info; }
    if (budget.nodes < 0 || performance.now() >= expires) break;
  }
  return selected;
}
