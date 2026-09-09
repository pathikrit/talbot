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
  it('replays a pending human move without automatically replacing recorded history', () => {
    controller.play('e2e4'); controller.undo(); controller.redo();
    expect(controller.mode).toBe('paused');
    controller.resume(); expect(controller.mode).toBe('thinking');
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
