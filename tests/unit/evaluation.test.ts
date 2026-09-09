import { describe, expect, it } from 'vitest';
import { evaluationBar, whiteEvaluation } from '../../src/evaluation';
import { Game } from '../../src/game';

describe('evaluation bar', () => {
  it('converts side-to-move centipawn and mate scores to White', () => {
    expect(whiteEvaluation({ kind: 'cp', value: 125 }, 'b')).toEqual({ kind: 'cp', value: -125 });
    expect(whiteEvaluation({ kind: 'mate', value: -3 }, 'b')).toEqual({ kind: 'mate', value: 3 });
  });
  it('uses a neutral placeholder until evaluation is available', () => {
    expect(evaluationBar()).toEqual({ percent: 50, label: '—' });
    expect(evaluationBar({ kind: 'cp', value: 0 })).toEqual({ percent: 50, label: '0.0' });
  });
  it('fills towards the advantaged side and handles mate', () => {
    expect(evaluationBar({ kind: 'cp', value: 200 }).percent).toBeGreaterThan(50);
    expect(evaluationBar({ kind: 'cp', value: -200 }).percent).toBeLessThan(50);
    expect(evaluationBar({ kind: 'mate', value: 4 })).toEqual({ percent: 100, label: '#4' });
    expect(evaluationBar({ kind: 'mate', value: -2 })).toEqual({ percent: 0, label: '#-2' });
  });
});

describe('captured pieces', () => {
  it('tracks each side and follows undo, redo, and branching', () => {
    const game = new Game();
    ['e2e4', 'd7d5', 'e4d5', 'd8d5'].forEach(move => game.play(move));
    expect(game.captures('w')).toEqual(['p']);
    expect(game.captures('b')).toEqual(['p']);
    game.undo();
    expect(game.captures('w')).toEqual([]);
    expect(game.captures('b')).toEqual([]);
    game.redo();
    expect(game.captures('w')).toEqual(['p']);
    expect(game.captures('b')).toEqual(['p']);
    game.undo(); game.play('e4e5');
    expect(game.captures('w')).toEqual([]);
    expect(game.captures('b')).toEqual([]);
  });
  it('records en passant and the actual captured promoted piece', () => {
    const ep = new Game('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    ep.play('e5d6'); expect(ep.captures('w')).toEqual(['p']);
    const promotion = new Game('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    promotion.play('a7a8q'); promotion.play('b8a8');
    expect(promotion.captures('b')).toEqual(['q']);
  });
});
