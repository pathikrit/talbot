import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../../src/controller';
import { Game } from '../../src/game';
import { SEARCH_MULTIPV } from '../../src/settings';
import { parseInfo } from '../../src/engine/protocol';
import type { EngineRequest, SearchRequest } from '../../src/engine/protocol';

let requests: EngineRequest[];
let controller: Controller;
const search = () => requests.filter((message): message is SearchRequest => message.type === 'search').at(-1)!;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  requests = [];
  controller = new Controller({ postMessage: message => requests.push(message) }, () => {});
  controller.receive({ type: 'ready' });
});
afterEach(() => { controller.dispose(); vi.useRealTimers(); });

describe('search lifecycle', () => {
  it('emits feedback only for committed moves, with capture and player information', () => {
    controller.dispose();
    const moved = vi.fn();
    controller = new Controller({ postMessage: message => requests.push(message) }, () => {}, undefined, moved);
    controller.receive({ type: 'ready' });
    controller.receive({ type: 'bestmove', id: search().id, move: 'e2e4' });
    expect(moved).not.toHaveBeenCalled();
    controller.play('e2e4');
    expect(moved).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'e2', to: 'e4' }), true);
    controller.receive({ type: 'bestmove', id: search().id, move: 'd7d5' });
    vi.advanceTimersByTime(999); expect(moved).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(moved).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'd7' }), false);
    controller.play('e4d5');
    expect(moved).toHaveBeenLastCalledWith(expect.objectContaining({ captured: 'p' }), true);
    controller.receive({ type: 'bestmove', id: search().id, move: 'd8d5' });
    controller.undo(); controller.redo(); controller.swap(); controller.newGame();
    vi.advanceTimersByTime(1000);
    expect(moved).toHaveBeenCalledTimes(3);
  });
  it('clears pending offers when sides or history change and ignores stale evaluations', () => {
    controller.play('e2e4');
    controller.offerDraw();
    const id = search().id;
    controller.swap();
    controller.receive({ type: 'info', id, analysis: parseInfo('info depth 8 score cp 0 pv e7e5')! });
    expect(controller.drawOffer).toBeUndefined();
    expect(controller.game.over).toBe(false);
    controller.offerDraw();
    controller.undo();
    expect(controller.drawOffer).toBeUndefined();
  });
  it('never uses a speculative ponder score to accept a draw', () => {
    controller.play('e2e4');
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5',
      selected: parseInfo('info depth 8 score cp 200 pv e7e5 g1f3')! });
    vi.advanceTimersByTime(1000);
    controller.receive({ type: 'info', id: search().id, analysis: parseInfo('info depth 12 score cp 0 pv b8c6')! });
    controller.offerDraw();
    expect(controller.game.over).toBe(false);
    expect(controller.drawOffer).toBe('human');
    expect(search().position.moves).toEqual(['e2e4', 'e7e5']);
  });
  it.each(['w', 'b'] as const)('stops when %s is human and White delivers mate', human => {
    const game = new Game('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
    game.human = human;
    controller.dispose();
    controller = new Controller({ postMessage: message => requests.push(message) }, () => {}, game);
    controller.receive({ type: 'ready' });
    if (human === 'w') controller.play('g6g7');
    else {
      controller.receive({ type: 'bestmove', id: search().id, move: 'g6g7' });
      vi.advanceTimersByTime(1000);
    }
    expect(game.ending()).toBe('white wins by checkmate');
    expect(controller.mode).toBe('idle');
    controller.swap();
    expect(game.ending()).toBe('white wins by checkmate');
    controller.undo();
    expect(game.over).toBe(false);
    controller.redo();
    expect(game.over).toBe(true);
  });
  it('rebuilds repetition after undo/redo and stays ended after swapping', () => {
    const game = new Game();
    for (let i = 0; i < 2; i++) for (const move of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) game.play(move);
    controller.dispose();
    controller = new Controller({ postMessage: message => requests.push(message) }, () => {}, game);
    controller.receive({ type: 'ready' });
    expect(controller.mode).toBe('idle');
    controller.undo(); expect(game.over).toBe(false);
    controller.redo(); expect(game.ending()).toBe('Draw by repetition');
    controller.swap(); expect(controller.mode).toBe('idle');
  });
  it('accepts an equal-position offer and cancels a buffered reply', () => {
    controller.play('e2e4');
    const id = search().id;
    controller.receive({ type: 'info', id, analysis: parseInfo('info depth 8 score cp 0 pv e7e5')! });
    controller.receive({ type: 'bestmove', id, move: 'e7e5' });
    controller.offerDraw();
    vi.advanceTimersByTime(6000);
    expect(controller.game.ending()).toBe('Draw by agreement');
    expect(controller.game.cursor).toBe(1);
    expect(controller.mode).toBe('idle');
    controller.swap();
    expect(controller.game.ending()).toBe('Draw by agreement');
    controller.undo();
    expect(controller.game.over).toBe(false);
    controller.newGame();
    expect(controller.drawOffer).toBeUndefined();
  });
  it('declines when ahead and waits for a sufficiently deep actual-root score', () => {
    controller.play('e2e4');
    controller.offerDraw();
    const id = search().id;
    controller.receive({ type: 'info', id, analysis: parseInfo('info depth 4 score cp 0 pv e7e5')! });
    expect(controller.drawOffer).toBe('human');
    controller.receive({ type: 'info', id, analysis: parseInfo('info depth 8 score cp 150 pv e7e5')! });
    expect(controller.drawOffer).toBeUndefined();
    expect(controller.drawNotice).toBe('Talbot declined the draw');
    expect(controller.game.over).toBe(false);
  });
  it('offers a late equal draw, allows decline without ending, and can accept', () => {
    const game = new Game();
    for (let ply = 0; ply < 40; ply++) {
      const candidates = game.chess.moves({ verbose: true });
      for (const move of candidates) {
        const cursor = game.cursor;
        game.play(move.from + move.to + (move.promotion ?? ''));
        if (!game.over) break;
        game.seek(cursor);
      }
    }
    game.human = 'b';
    game.reviewing = false;
    controller.dispose();
    controller = new Controller({ postMessage: message => requests.push(message) }, () => {}, game);
    controller.receive({ type: 'ready' });
    const move = game.chess.moves({ verbose: true })[0];
    const uci = move.from + move.to + (move.promotion ?? '');
    controller.receive({ type: 'bestmove', id: search().id, move: uci,
      selected: parseInfo(`info depth 8 score cp 0 pv ${uci}`)! });
    vi.advanceTimersByTime(1000);
    expect(controller.drawOffer).toBe('engine');
    controller.declineDraw();
    expect(controller.drawOffer).toBeUndefined();
    expect(game.over).toBe(false);
    controller.drawOffer = 'engine';
    controller.acceptDraw();
    expect(game.ending()).toBe('Draw by agreement');
    expect(controller.mode).toBe('idle');
  });
  it.each([
    ['7k/6Q1/5K2/8/8/8/8/8 b - - 0 1', 'white wins by checkmate'],
    ['8/8/8/8/8/5k2/6q1/7K w - - 0 1', 'black wins by checkmate'],
    ['7k/5Q2/5K2/8/8/8/8/8 b - - 0 1', 'Draw by stalemate'],
    ['7k/8/5K2/8/8/8/8/R7 w - - 100 51', 'Draw by the fifty-move rule'],
    ['7k/8/5K2/8/8/8/8/8 w - - 0 1', 'Draw by insufficient material'],
  ])('keeps an ended position idle through swaps: %s', (fen, ending) => {
    controller.dispose();
    controller = new Controller({ postMessage: message => requests.push(message) }, () => {}, new Game(fen));
    controller.receive({ type: 'ready' });
    const before = requests.filter(message => message.type === 'search').length;
    controller.swap(); controller.swap();
    expect(controller.game.ending()).toBe(ending);
    expect(controller.mode).toBe('idle');
    expect(requests.filter(message => message.type === 'search')).toHaveLength(before);
    controller.offerDraw();
    expect(controller.drawOffer).toBeUndefined();
  });
  it('seeks to a clicked move, preserving future history and cancelling replies', () => {
    controller.play('e2e4');
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5' });
    vi.advanceTimersByTime(1000);
    controller.play('g1f3');
    controller.receive({ type: 'bestmove', id: search().id, move: 'b8c6' });
    controller.seek(1);
    vi.advanceTimersByTime(1000);
    expect(controller.game.moves).toEqual(['e2e4']);
    expect(controller.game.history).toHaveLength(3);
    expect(controller.mode).toBe('thinking');
    controller.seek(2);
    expect(controller.game.moves).toEqual(['e2e4', 'e7e5']);
    expect(controller.mode).toBe('pondering');
  });
  it('resigns, cancels buffered replies, and permits undo or a fresh game', () => {
    controller.play('e2e4');
    const id = search().id;
    controller.receive({ type: 'bestmove', id, move: 'e7e5' });
    controller.resign();
    expect(controller.game.ending()).toBe('black wins by resignation');
    expect(controller.mode).toBe('idle');
    controller.receive({ type: 'bestmove', id, move: 'e7e5' });
    vi.advanceTimersByTime(6000);
    expect(controller.game.cursor).toBe(1);
    expect(controller.error).toBe('');
    controller.swap();
    expect(controller.game.ending()).toBe('black wins by resignation');
    expect(controller.mode).toBe('idle');
    controller.undo();
    expect(controller.game.over).toBe(false);
    controller.resign();
    controller.newGame();
    expect(controller.game.over).toBe(false);
  });
  it('records book choices only with committed moves and restores them through undo/redo', () => {
    controller.play('e2e4');
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5', opening: 'stafford-line' });
    vi.advanceTimersByTime(1000);
    controller.undo();
    expect(controller.game.cursor).toBe(0);
    controller.redo();
    controller.play('g1f3');
    expect(search().opening).toBe('stafford-line');
    controller.newGame();
    controller.play('e2e4');
    expect(search().opening).toBeUndefined();
  });
  it('discards future book choices on a branch and never commits a cancelled choice', () => {
    controller.play('e2e4');
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5', opening: 'cancelled' });
    controller.undo();
    vi.advanceTimersByTime(1000);
    controller.play('d2d4');
    expect(search().opening).toBeUndefined();
    controller.receive({ type: 'bestmove', id: search().id, move: 'd7d5', opening: 'old-line' });
    vi.advanceTimersByTime(1000);
    controller.undo();
    controller.play('e2e4');
    expect(search().opening).toBeUndefined();
  });
  it('remembers leaving the book and keeps side-specific choices when swapped', () => {
    controller.play('e2e4');
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5', opening: 'black-line' });
    vi.advanceTimersByTime(1000);
    controller.swap();
    expect(search().opening).toBeUndefined();
    controller.receive({ type: 'bestmove', id: search().id, move: 'g1f3', opening: null });
    vi.advanceTimersByTime(1000);
    controller.swap();
    expect(search().opening).toBe('black-line');
    controller.receive({ type: 'bestmove', id: search().id, move: 'b8c6', opening: null });
    vi.advanceTimersByTime(1000);
    controller.play('f1c4');
    expect(search().opening).toBeNull();
  });
  it('uses internal search breadth during both pondering and timed play', () => {
    expect(search().multipv).toBe(SEARCH_MULTIPV);
    controller.play('e2e4');
    expect(search().multipv).toBe(SEARCH_MULTIPV);
  });
  it('uses the chosen sacrifice score and PV for evaluation and prediction', () => {
    controller.play('e2e4');
    const selected = parseInfo('info multipv 2 depth 7 score cp -25 pv c7c5 g1f3 d7d6')!;
    controller.receive({ type: 'info', id: search().id, analysis: parseInfo('info depth 7 score cp 10 pv e7e5 f2f4')! });
    controller.receive({ type: 'bestmove', id: search().id, move: 'c7c5', selected });
    vi.advanceTimersByTime(999);
    expect(controller.game.cursor).toBe(1);
    vi.advanceTimersByTime(1);
    expect(controller.game.moves).toEqual(['e2e4', 'c7c5']);
    expect(controller.evaluation).toEqual({ kind: 'cp', value: 25 });
    expect(search().position.moves).toEqual(['e2e4', 'c7c5', 'g1f3']);
  });
  it('does not replace the current evaluation with a speculative ponder score', () => {
    controller.play('e2e4');
    controller.receive({ type: 'info', id: search().id, analysis: parseInfo('info depth 7 score cp 50 nodes 100 time 100 pv e7e5 g1f3')! });
    expect(controller.evaluation).toEqual({ kind: 'cp', value: -50 });
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5' });
    vi.advanceTimersByTime(1000);
    controller.receive({ type: 'info', id: search().id, analysis: parseInfo('info depth 10 score cp 900 nodes 1000 time 500 pv b8c6')! });
    expect(controller.evaluation).toEqual({ kind: 'cp', value: -50 });
    controller.newGame();
    expect(controller.evaluation).toBeUndefined();
  });
  it('ponders without committing speculative best moves', () => {
    expect(search().deadline).toBeUndefined();
    controller.receive({ type: 'bestmove', id: search().id, move: 'e2e4' });
    vi.advanceTimersByTime(3000);
    expect(controller.game.cursor).toBe(0);
  });
  it('commits an early result at one second, then ponders a predicted reply', () => {
    controller.play('e2e4');
    const id = search().id;
    controller.receive({ type: 'info', id, analysis: parseInfo('info multipv 1 depth 7 score cp 10 nodes 100 nps 1000 time 100 pv e7e5 g1f3 b8c6')! });
    controller.receive({ type: 'bestmove', id, move: 'e7e5' });
    vi.advanceTimersByTime(999);
    expect(controller.game.cursor).toBe(1);
    vi.advanceTimersByTime(1);
    expect(controller.game.cursor).toBe(2);
    expect(search().position.moves).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(search().deadline).toBeUndefined();
  });
  it('ignores a stale reply and stale info after undo', () => {
    controller.play('e2e4'); const id = search().id;
    controller.undo();
    controller.receive({ type: 'bestmove', id, move: 'e7e5' });
    vi.advanceTimersByTime(2000);
    expect(controller.game.cursor).toBe(0);
    expect(controller.error).toBe('');
  });
  it('cancels an already buffered move when switching sides', () => {
    controller.play('e2e4');
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5' });
    controller.swap(); vi.advanceTimersByTime(1001);
    expect(controller.game.cursor).toBe(1);
    expect(controller.game.human).toBe('b');
    expect(controller.mode).toBe('pondering');
  });
  it('automatically resumes a reply after replaying a pending human move', () => {
    controller.play('e2e4'); controller.undo(); controller.redo();
    expect(controller.mode).toBe('thinking');
    controller.receive({ type: 'bestmove', id: search().id, move: 'e7e5' });
    vi.advanceTimersByTime(1000);
    expect(controller.game.moves).toEqual(['e2e4', 'e7e5']);
  });
  it('pauses when hidden and restarts safely when visible', () => {
    controller.play('e2e4'); const id = search().id;
    controller.visibility(false);
    controller.receive({ type: 'bestmove', id, move: 'e7e5' });
    vi.advanceTimersByTime(2000);
    expect(controller.game.cursor).toBe(1);
    expect(controller.mode).toBe('paused');
    controller.visibility(true);
    expect(controller.mode).toBe('thinking');
  });
  it('resets cached analysis for a new game and ignores old replies', () => {
    controller.play('e2e4'); const id = search().id; controller.newGame();
    expect(requests.some(message => message.type === 'reset')).toBe(true);
    controller.receive({ type: 'bestmove', id, move: 'e7e5' });
    vi.advanceTimersByTime(2000);
    expect(controller.game.cursor).toBe(0);
  });
  it('reports engine failure instead of substituting a random move', () => {
    controller.play('e2e4');
    controller.receive({ type: 'bestmove', id: search().id, move: 'a1a8' });
    vi.advanceTimersByTime(1001);
    expect(controller.mode).toBe('error');
    expect(controller.game.cursor).toBe(1);
  });
  it('stops on game end', () => {
    const game = new Game();
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(move => game.play(move));
    const done = new Controller({ postMessage: message => requests.push(message) }, () => {}, game);
    const before = requests.filter(message => message.type === 'search').length;
    done.receive({ type: 'ready' });
    expect(done.mode).toBe('idle');
    expect(requests.filter(message => message.type === 'search')).toHaveLength(before);
  });
});

describe('MultiPV parsing', () => {
  it('retains candidate indexes, cp/mate scores, and complete PVs', () => {
    expect(parseInfo('info multipv 20 depth 8 score mate -3 nodes 120 nps 1200 time 100 pv e2e4 e7e5')).toMatchObject({
      multipv: 20, depth: 8, score: { kind: 'mate', value: -3 }, pv: ['e2e4', 'e7e5'],
    });
  });
  it('ignores search bounds and malformed output', () => {
    expect(parseInfo('info depth 8 score cp 20 lowerbound pv e2e4')).toBeUndefined();
    expect(parseInfo('bestmove e2e4')).toBeUndefined();
    expect(parseInfo('info depth 8 score cp 10 pv a1a1garbage')).toBeUndefined();
  });
});
