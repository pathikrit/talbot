import type { Color } from 'chess.js';
import type { Analysis } from './engine/protocol';

export type Evaluation = Analysis['score'];

export function whiteEvaluation(score: Evaluation, turn: Color): Evaluation {
  return { kind: score.kind, value: turn === 'w' ? score.value : -score.value };
}

export function evaluationBar(score?: Evaluation): { percent: number; label: string } {
  if (!score) return { percent: 50, label: '—' };
  if (score.kind === 'mate') return { percent: score.value > 0 ? 100 : 0, label: `#${score.value}` };
  const pawns = score.value / 100;
  return {
    percent: Math.max(2, Math.min(98, 50 + 50 * Math.tanh(score.value / 400))),
    label: `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`,
  };
}
