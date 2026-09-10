export interface PositionRequest { fen: string; moves: string[] }
export interface RecentOpening { lineId: string; move: string }
export type SacrificedPiece = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';
export interface MoveDecision {
  opening?: string;
  sacrifice?: { piece: SacrificedPiece; insteadOf: string };
}
export interface SearchRequest {
  type: 'search';
  id: number;
  position: PositionRequest;
  /** Absolute performance.timeOrigin + performance.now(); absent = ponder. */
  deadline?: number;
  multipv?: number;
  /** undefined = may choose early; string = committed line; null = out of book. */
  opening?: string | null;
  /** Bounded browser-local history used only to downweight repeated choices. */
  recentOpenings?: RecentOpening[];
}
export type EngineRequest =
  | { type: 'init'; assetBase: string }
  | SearchRequest
  | { type: 'stop' }
  | { type: 'reset' };

export interface Analysis {
  depth: number;
  multipv: number;
  score: { kind: 'cp' | 'mate'; value: number };
  nodes: number;
  nps: number;
  time: number;
  pv: string[];
}
export type EngineResponse =
  | { type: 'ready' }
  | { type: 'info'; id: number; analysis: Analysis }
  | { type: 'bestmove'; id: number; move: string; selected?: Analysis; opening?: string | null; decision?: MoveDecision }
  | { type: 'error'; message: string };

export function parseInfo(line: string): Analysis | undefined {
  if (!line.startsWith('info ') || /\b(?:upperbound|lowerbound)\b/.test(line)) return;
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = line.match(/\bpv (.+)/)?.[1].trim().split(/\s+/);
  const number = (key: string) => Number(line.match(new RegExp(`\\b${key} (\\d+)`))?.[1] ?? 0);
  if (!score || !pv?.length || !pv.every(move => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) return;
  return {
    depth: number('depth'), multipv: number('multipv') || 1,
    score: { kind: score[1] as 'cp' | 'mate', value: Number(score[2]) },
    nodes: number('nodes'), nps: number('nps'), time: number('time'), pv,
  };
}

export const now = (): number => performance.timeOrigin + performance.now();
