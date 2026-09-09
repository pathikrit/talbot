import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';

export const other = (color: Color): Color => color === 'w' ? 'b' : 'w';
export const colorName = (color: Color): 'white' | 'black' => color === 'w' ? 'white' : 'black';
export const moveUci = (move: Move): string => move.from + move.to + (move.promotion ?? '');

export class Game {
  chess: Chess;
  readonly initialFen: string;
  human: Color = 'w';
  history: Move[] = [];
  cursor = 0;
  reviewing = false;

  constructor(fen = DEFAULT_POSITION) {
    this.initialFen = fen;
    this.chess = new Chess(fen);
  }

  get humanTurn(): boolean { return this.chess.turn() === this.human; }
  get moves(): string[] { return this.history.slice(0, this.cursor).map(moveUci); }

  captures(by: Color): PieceSymbol[] {
    const order = 'qrbnp';
    return this.history.slice(0, this.cursor)
      .filter(move => move.color === by && move.captured)
      .map(move => move.captured!)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  play(uci: string): Move {
    if (this.chess.isGameOver()) throw new Error('The game has ended.');
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Use a move like e2e4 or e7e8q.');
    const move = this.chess.move({
      from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4],
    });
    this.history = this.history.slice(0, this.cursor);
    this.history.push(move);
    this.cursor++;
    this.reviewing = false;
    return move;
  }

  private seek(cursor: number): void {
    this.chess = new Chess(this.initialFen);
    this.cursor = cursor;
    for (const move of this.history.slice(0, cursor)) this.chess.move(moveUci(move));
    this.reviewing = true;
  }

  undo(): void {
    if (!this.cursor) return;
    let target = this.cursor - 1;
    while (target > 0 && this.history[target].color !== this.human) target--;
    this.seek(target);
  }

  redo(): void {
    if (this.cursor >= this.history.length) return;
    let target = this.cursor + 1;
    while (target < this.history.length && this.history[target].color !== this.human) target++;
    this.seek(target);
  }

  swap(): void { this.human = other(this.human); this.reviewing = false; }

  reset(): void {
    this.chess = new Chess(this.initialFen);
    this.history = [];
    this.cursor = 0;
    this.reviewing = false;
  }

  destinations(): Map<Square, Square[]> {
    const result = new Map<Square, Square[]>();
    for (const move of this.chess.moves({ verbose: true })) {
      const destinations = result.get(move.from) ?? [];
      if (!destinations.includes(move.to)) destinations.push(move.to);
      result.set(move.from, destinations);
    }
    return result;
  }

  ending(): string | undefined {
    if (this.chess.isCheckmate()) return `${colorName(other(this.chess.turn()))} wins by checkmate`;
    if (this.chess.isStalemate()) return 'Draw by stalemate';
    if (this.chess.isThreefoldRepetition()) return 'Draw by repetition';
    if (this.chess.isInsufficientMaterial()) return 'Draw by insufficient material';
    if (this.chess.isDrawByFiftyMoves()) return 'Draw by the fifty-move rule';
    return undefined;
  }
}
