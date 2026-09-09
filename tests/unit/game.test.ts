import { describe, expect, it } from 'vitest';
import { Game } from '../../src/game';
import { DEFAULT_POSITION } from 'chess.js';

describe('game history', () => {
  it('undoes and replays a whole turn without recomputing a reply', () => {
    const game = new Game();
    game.play('e2e4'); game.play('e7e5');
    const fen = game.chess.fen();
    game.undo();
    expect(game.chess.fen()).toBe(DEFAULT_POSITION);
    expect(game.history).toHaveLength(2);
    game.redo();
    expect(game.chess.fen()).toBe(fen);
  });
  it('undoes only the human move while a reply is pending', () => {
    const game = new Game();
    game.play('d2d4'); game.undo();
    expect(game.cursor).toBe(0);
    game.redo();
    expect(game.cursor).toBe(1);
    expect(game.reviewing).toBe(true);
  });
  it('branches from history and discards the abandoned continuation', () => {
    const game = new Game();
    game.play('e2e4'); game.play('e7e5'); game.undo(); game.play('d2d4');
    game.redo();
    expect(game.moves).toEqual(['d2d4']);
    expect(game.history).toHaveLength(1);
  });
  it('uses the current human color after a side swap', () => {
    const game = new Game();
    ['e2e4', 'e7e5', 'g1f3', 'b8c6'].forEach(move => game.play(move));
    game.swap(); game.undo();
    expect(game.cursor).toBe(3);
    expect(game.humanTurn).toBe(true);
    game.undo();
    expect(game.cursor).toBe(1);
    game.redo();
    expect(game.cursor).toBe(3);
  });
  it('handles the first computer move when playing black', () => {
    const game = new Game(); game.swap(); game.play('e2e4'); game.undo();
    expect(game.cursor).toBe(0);
    expect(game.reviewing).toBe(true);
    game.redo();
    expect(game.humanTurn).toBe(true);
  });
});

describe('legal chess', () => {
  it('rejects illegal moves without modifying history', () => {
    const game = new Game();
    expect(() => game.play('e2e5')).toThrow();
    expect(game.cursor).toBe(0);
    expect(game.chess.fen()).toBe(DEFAULT_POSITION);
  });
  it('preserves castling through undo and redo', () => {
    const game = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    game.play('e1g1'); game.play('e8c8');
    const fen = game.chess.fen(); game.undo(); game.redo();
    expect(game.chess.fen()).toBe(fen);
    expect(game.chess.get('f1')?.type).toBe('r');
    expect(game.chess.get('d8')?.type).toBe('r');
  });
  it('handles en passant and all four promotions', () => {
    const ep = new Game('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    ep.play('e5d6'); expect(ep.chess.get('d5')).toBeUndefined();
    for (const piece of ['q', 'r', 'b', 'n']) {
      const game = new Game('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
      game.play(`a7a8${piece}`);
      expect(game.chess.get('a8')?.type).toBe(piece);
    }
  });
  it('detects mate and repetition after replay', () => {
    const mate = new Game();
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(move => mate.play(move));
    expect(mate.ending()).toBe('black wins by checkmate');
    const draw = new Game();
    [...Array(2)].forEach(() => ['g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach(move => draw.play(move)));
    draw.undo(); draw.redo();
    expect(draw.ending()).toBe('Draw by repetition');
  });
});
