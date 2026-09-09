import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import { Game } from './game';
import { now } from './engine/protocol';
import { whiteEvaluation } from './evaluation';
import { SEARCH_MULTIPV } from './settings';
import type { Evaluation } from './evaluation';
import type { Analysis, EngineRequest, EngineResponse } from './engine/protocol';

export interface EnginePort { postMessage(message: EngineRequest): void }
export type EngineMode = 'loading' | 'thinking' | 'pondering' | 'paused' | 'idle' | 'error';

export class Controller {
  readonly game: Game;
  ready = false;
  visible = true;
  mode: EngineMode = 'loading';
  error = '';
  analysis?: Analysis;
  evaluation?: Evaluation;
  revision = 0;
  drawOffer?: 'human' | 'engine';
  drawNotice = '';
  private lastDrawOffer = -20;
  private prediction?: string;
  private speculative = false;
  private deadline = 0;
  private moveTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private openings: Partial<Record<Color, string | null>>[] = [{}];

  constructor(private engine: EnginePort, private changed: () => void, game = new Game()) {
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
          const plans = { ...this.openings[this.game.cursor], [side]: message.opening ?? null };
          this.game.play(message.move);
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
    this.engine.postMessage({ type: 'stop' });
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
      });
      if (!game.humanTurn) {
        // Do not leave the user waiting indefinitely after a worker crash/hang.
        this.watchdog = setTimeout(() => this.fail('The engine did not respond. Reload the page to retry.'), 5000);
      }
    }
    this.changed();
  }

  play(uci: string): void {
    if (!this.ready || this.error || !this.visible || !this.game.humanTurn || this.game.over) return;
    const plans = { ...this.openings[this.game.cursor] };
    this.game.play(uci);
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
  swap(): void { this.clearDraw(); this.game.swap(); this.prediction = undefined; this.sync(true); }
  resign(): void { this.clearDraw(); this.game.resign(); this.prediction = undefined; this.sync(true); }
  undo(): void { this.clearDraw(); this.game.undo(); this.prediction = undefined; this.sync(); }
  seek(cursor: number): void { this.clearDraw(); this.game.seek(cursor); this.prediction = undefined; this.sync(); }
  redo(): void { this.clearDraw(); this.game.redo(); this.prediction = undefined; this.sync(); }
  newGame(): void {
    this.clearDraw(); this.lastDrawOffer = -20;
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
