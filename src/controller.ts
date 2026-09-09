import { Chess } from 'chess.js';
import { Game } from './game';
import { now } from './engine/protocol';
import { whiteEvaluation } from './evaluation';
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
  private prediction?: string;
  private speculative = false;
  private deadline = 0;
  private moveTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;

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
        if (!this.speculative) this.evaluation = whiteEvaluation(message.analysis.score, this.game.chess.turn());
      }
      this.changed();
    } else if (this.mode === 'thinking') {
      const revision = this.revision;
      const pv = this.analysis?.pv;
      clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => {
        if (revision !== this.revision || this.game.humanTurn || !this.visible || this.error) return;
        try {
          this.game.play(message.move);
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
    else if (game.chess.isGameOver()) this.mode = 'idle';
    else if (game.reviewing && !game.humanTurn) this.mode = 'paused';
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
        multipv: 1,
      });
      if (!game.humanTurn) {
        // Do not leave the user waiting indefinitely after a worker crash/hang.
        this.watchdog = setTimeout(() => this.fail('The engine did not respond. Reload the page to retry.'), 5000);
      }
    }
    this.changed();
  }

  play(uci: string): void {
    if (!this.ready || this.error || !this.visible || !this.game.humanTurn) return;
    this.game.play(uci);
    this.prediction = undefined;
    this.sync();
  }
  swap(): void { this.game.swap(); this.prediction = undefined; this.sync(true); }
  undo(): void { this.game.undo(); this.prediction = undefined; this.sync(); }
  redo(): void { this.game.redo(); this.prediction = undefined; this.sync(); }
  resume(): void { this.game.reviewing = false; this.sync(); }
  newGame(): void {
    this.game.reset();
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
