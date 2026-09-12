import { Chess } from 'chess.js';
import type { Color, Move } from 'chess.js';
import { Game } from './game';
import { now } from './engine/protocol';
import { whiteEvaluation } from './evaluation';
import { SEARCH_MULTIPV } from './settings';
import type { Evaluation } from './evaluation';
import type { Analysis, EngineRequest, EngineResponse, RecentOpening } from './engine/protocol';

export interface EnginePort { postMessage(message: EngineRequest): void }
export interface OpeningMemoryPort { recent(): RecentOpening[]; remember(entry: RecentOpening): void }
export type EngineMode = 'loading' | 'thinking' | 'pondering' | 'paused' | 'idle' | 'error';
const noOpeningMemory: OpeningMemoryPort = { recent: () => [], remember: () => {} };
const PREDICTED_PONDER_MS = 1500;

export class Controller {
  readonly game: Game;
  ready = false;
  visible = true;
  mode: EngineMode = 'loading';
  error = '';
  analysis?: Analysis;
  evaluation?: Evaluation;
  announcement = '';
  revision = 0;
  drawOffer?: 'human' | 'engine';
  drawNotice = '';
  private lastDrawOffer = -20;
  private prediction?: string;
  private speculative = false;
  private deadline = 0;
  private moveTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private ponderTimer?: ReturnType<typeof setTimeout>;
  private openings: Partial<Record<Color, string | null>>[] = [{}];

  constructor(private engine: EnginePort, private changed: () => void, game = new Game(),
    private moved: (move: Move, human: boolean) => void = () => {},
    private openingMemory: OpeningMemoryPort = noOpeningMemory) {
    this.game = game;
  }

  receive(message: EngineResponse): void {
    if (message.type === 'error') { this.fail(message.message); return; }
    if (message.type === 'ready') {
      this.ready = true;
      this.sync();
      return;
    }
    if (message.id !== this.revision || !this.visible || this.error) return;
    if (message.type === 'info') {
      if (message.analysis.multipv === 1) {
        this.analysis = message.analysis;
        if (!this.speculative) {
          this.evaluation = whiteEvaluation(message.analysis.score, this.game.chess.turn());
          if (this.drawOffer === 'human' && message.analysis.depth >= 8) this.resolveDraw();
        }
      }
      this.changed();
    } else if (this.mode === 'thinking') {
      const revision = this.revision;
      const selected = message.selected;
      const pv = selected?.pv ?? this.analysis?.pv;
      clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => {
        if (revision !== this.revision || this.game.humanTurn || !this.visible || this.error) return;
        try {
          if (selected) {
            this.analysis = selected;
            this.evaluation = whiteEvaluation(selected.score, this.game.chess.turn());
          }
          const side = this.game.chess.turn();
          const assessed = selected ?? this.analysis;
          const offerDraw = this.game.cursor >= 40 && this.game.cursor - this.lastDrawOffer >= 20
            && assessed && assessed.depth >= 8 && assessed.score.kind === 'cp' && Math.abs(assessed.score.value) <= 20;
          const freshOpening = this.openings[this.game.cursor]?.[side] === undefined && message.opening;
          const plans = { ...this.openings[this.game.cursor], [side]: message.opening ?? null };
          this.announcement = this.moveAnnouncement(message, assessed, !!freshOpening);
          const played = this.game.play(message.move);
          if (freshOpening) this.openingMemory.remember({ lineId: freshOpening, move: message.move });
          this.notifyMove(played, false);
          if (this.drawOffer === 'human') this.drawNotice = 'Talbot declined the draw';
          this.drawOffer = undefined;
          if (offerDraw && !this.game.over) {
            this.drawOffer = 'engine';
            this.lastDrawOffer = this.game.cursor;
          }
          this.openings = this.openings.slice(0, this.game.cursor);
          this.openings[this.game.cursor] = plans;
          this.prediction = pv?.[0] === message.move ? pv[1] : undefined;
          this.sync(true);
        } catch { this.fail(`Patricia returned an invalid move (${message.move}). Reload the page to retry.`); }
      }, Math.max(0, this.deadline - now()));
    }
  }

  private cancel(): void {
    this.revision++;
    clearTimeout(this.moveTimer);
    clearTimeout(this.watchdog);
    clearTimeout(this.ponderTimer);
    this.engine.postMessage({ type: 'stop' });
  }

  private notifyMove(move: Move, human: boolean): void {
    try { this.moved(move, human); } catch { /* Optional feedback cannot interrupt the game. */ }
  }

  private moveAnnouncement(message: Extract<EngineResponse, { type: 'bestmove' }>,
    analysis: Analysis | undefined, freshOpening: boolean): string {
    if (analysis?.pv[0] === message.move && analysis.score.kind === 'mate' && analysis.score.value > 0) {
      return `Mate in ${analysis.score.value}!`;
    }
    if (freshOpening && message.decision?.opening) return `Playing the ${message.decision.opening}!`;
    if (message.decision?.sacrifice) {
      let alternative = message.decision.sacrifice.insteadOf;
      try { alternative = new Chess(this.game.chess.fen()).move(alternative).san; }
      catch { /* Valid engine metadata should always describe a legal root move. */ }
      return `Sacking a ${message.decision.sacrifice.piece} instead of ${alternative}!`;
    }
    return '';
  }

  private sync(preserveEvaluation = false): void {
    this.cancel();
    this.analysis = undefined;
    if (!preserveEvaluation) this.evaluation = undefined;
    this.speculative = false;
    const game = this.game;
    if (this.error) this.mode = 'error';
    else if (!this.ready) this.mode = 'loading';
    else if (!this.visible) this.mode = 'paused';
    else if (game.over) this.mode = 'idle';
    else {
      this.mode = game.humanTurn ? 'pondering' : 'thinking';
      const moves = game.moves;
      if (game.humanTurn && this.prediction) {
        const hypothetical = new Chess(game.chess.fen());
        try {
          hypothetical.move(this.prediction);
          if (!hypothetical.isGameOver()) {
            moves.push(this.prediction);
            this.speculative = true;
          }
        } catch { /* An invalid/stale prediction falls back to the real root. */ }
      }
      this.deadline = now() + 1000;
      this.engine.postMessage({
        type: 'search', id: this.revision,
        position: { fen: game.initialFen, moves },
        deadline: game.humanTurn ? undefined : this.deadline,
        multipv: SEARCH_MULTIPV,
        opening: this.openings[game.cursor]?.[game.chess.turn()],
        recentOpenings: this.openingMemory.recent(),
      });
      if (game.humanTurn && this.speculative) {
        const revision = this.revision;
        this.ponderTimer = setTimeout(() => {
          if (revision !== this.revision || !this.visible || this.error
            || !game.humanTurn || game.over) return;
          this.prediction = undefined;
          this.sync(true);
        }, PREDICTED_PONDER_MS);
      }
      if (!game.humanTurn) {
        // Do not leave the user waiting indefinitely after a worker crash/hang.
        this.watchdog = setTimeout(() => this.fail('The engine did not respond. Reload the page to retry.'), 5000);
      }
    }
    this.changed();
  }

  play(uci: string): void {
    if (!this.ready || this.error || !this.visible || !this.game.humanTurn || this.game.over) return;
    this.announcement = '';
    const plans = { ...this.openings[this.game.cursor] };
    const played = this.game.play(uci);
    this.notifyMove(played, true);
    this.clearDraw();
    this.openings = this.openings.slice(0, this.game.cursor);
    this.openings[this.game.cursor] = plans;
    this.prediction = undefined;
    this.sync();
  }
  private clearDraw(): void { this.drawOffer = undefined; this.drawNotice = ''; }
  offerDraw(): void {
    if (!this.ready || this.error || !this.visible || !this.game.active || this.drawOffer) return;
    this.drawOffer = 'human';
    this.drawNotice = 'Draw offered';
    if (!this.speculative && this.analysis && this.analysis.depth >= 8) this.resolveDraw();
    else { this.prediction = undefined; this.sync(); } // Evaluate the actual root.
  }
  private resolveDraw(): void {
    const score = this.evaluation;
    if (!score) return;
    const engineScore = score.value * (this.game.human === 'w' ? -1 : 1);
    if ((score.kind === 'cp' && engineScore <= 20) || (score.kind === 'mate' && engineScore < 0)) {
      this.game.agreeDraw(); this.clearDraw(); this.sync(true);
    } else {
      this.drawOffer = undefined; this.drawNotice = 'Talbot declined the draw'; this.changed();
    }
  }
  acceptDraw(): void {
    if (this.drawOffer !== 'engine' || this.game.over) return;
    this.game.agreeDraw(); this.clearDraw(); this.sync(true);
  }
  declineDraw(): void { if (this.drawOffer === 'engine') { this.clearDraw(); this.changed(); } }
  swap(): void { this.clearDraw(); this.announcement = ''; this.game.swap(); this.prediction = undefined; this.sync(true); }
  resign(): void { this.clearDraw(); this.announcement = ''; this.game.resign(); this.prediction = undefined; this.sync(true); }
  undo(): void { this.clearDraw(); this.announcement = ''; this.game.undo(); this.prediction = undefined; this.sync(); }
  seek(cursor: number): void { this.clearDraw(); this.announcement = ''; this.game.seek(cursor); this.prediction = undefined; this.sync(); }
  redo(): void { this.clearDraw(); this.announcement = ''; this.game.redo(); this.prediction = undefined; this.sync(); }
  newGame(): void {
    this.clearDraw(); this.lastDrawOffer = -20;
    this.announcement = '';
    this.game.reset();
    this.openings = [{}];
    this.prediction = undefined;
    this.engine.postMessage({ type: 'reset' });
    this.sync();
  }
  visibility(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.sync(true);
  }
  fail(message: string): void {
    this.error = message;
    this.cancel();
    this.mode = 'error';
    this.changed();
  }
  dispose(): void { this.cancel(); }
}
