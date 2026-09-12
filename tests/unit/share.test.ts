import { describe, expect, it } from 'vitest';
import { DEFAULT_POSITION } from 'chess.js';
import { Game } from '../../src/game';
import { gameFromHash, gameHash } from '../../src/share';

describe('shareable game URLs', () => {
  it('round trips complete move history in a compact stable hash', () => {
    const game = new Game();
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'].forEach(move => game.play(move));
    const hash = gameHash(game);
    const restored = gameFromHash(hash)!;
    expect(hash).toBe('#1AAsKFwUNAQ');
    expect(hash.length).toBeLessThan(game.moves.join('').length);
    expect(restored.moves).toEqual(game.moves);
    expect(restored.chess.fen()).toBe(game.chess.fen());
  });

  it('shares the visible cursor rather than abandoned redo history', () => {
    const game = new Game();
    ['e2e4', 'e7e5', 'g1f3'].forEach(move => game.play(move));
    game.seek(1);
    const restored = gameFromHash(gameHash(game))!;
    expect(restored.moves).toEqual(['e2e4']);
    expect(restored.history).toHaveLength(1);
  });

  it('preserves side, agreed draws and resignations', () => {
    const draw = new Game(); draw.play('d2d4'); draw.swap(); draw.agreeDraw();
    const restoredDraw = gameFromHash(gameHash(draw))!;
    expect(restoredDraw.human).toBe('b');
    expect(restoredDraw.ending()).toBe('Draw by agreement');

    const resignation = new Game(); resignation.play('e2e4'); resignation.resigned = 'b';
    const restoredResignation = gameFromHash(gameHash(resignation))!;
    expect(restoredResignation.ending()).toBe('white wins by resignation');
  });

  it('preserves repetition history that FEN alone cannot represent', () => {
    const game = new Game();
    for (let cycle = 0; cycle < 2; cycle++) {
      ['g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach(move => game.play(move));
    }
    const restored = gameFromHash(gameHash(game))!;
    expect(restored.chess.fen()).toBe(DEFAULT_POSITION.replace('0 1', '8 5'));
    expect(restored.ending()).toBe('Draw by repetition');
  });

  it('rejects unsupported, malformed and illegal hashes', () => {
    expect(gameFromHash('')).toBeUndefined();
    expect(gameFromHash('#2AA')).toBeUndefined();
    expect(gameFromHash('#1!')).toBeUndefined();
    expect(gameFromHash('#1_w')).toBeUndefined();
    expect(gameFromHash('#1AA__')).toBeUndefined();
  });
});
