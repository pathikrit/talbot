import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { CandidateSet, chooseSacrifice, lineSacrificeSize, offersSacrifice, sacrificePotential,
  sacrificeSize, shortlistCandidates } from '../../src/engine/sacrifice';
import { parseInfo } from '../../src/engine/protocol';
import { settings } from '../../src/settings';

const pawnOffer = 'k7/8/8/3p4/8/4P3/8/7K w - - 0 1';
const info = (index: number, move: string, score = 20, depth = 7) =>
  parseInfo(`info depth ${depth} multipv ${index} score cp ${score} pv ${move}`)!;
const probe = (fen: string, pv: string[]) => offersSacrifice(fen, pv, { expires: performance.now() + 2000, nodes: 10000 });

describe('lasting material offers', () => {
  it('recognizes an accepted pawn gambit', () => {
    expect(probe(pawnOffer, ['e3e4', 'd5e4', 'h1g1', 'a8b8'])).toBe(true);
  });
  it('also inspects acceptance when the PV declines the offer', () => {
    expect(probe(pawnOffer, ['e3e4', 'a8b8', 'h1g1'])).toBe(true);
  });
  it('rejects equal trades and immediate recaptures', () => {
    expect(probe('k7/8/8/3p4/8/3PP3/8/7K w - - 0 1', ['e3e4', 'd5e4', 'd3e4'])).toBe(false);
    // Recapture is found even if Patricia's PV declines the exchange.
    expect(probe('k7/8/8/3p4/8/3PP3/8/7K w - - 0 1', ['e3e4', 'a8b8'])).toBe(false);
  });
  it('recognizes a bishop for a pawn, accounting for the initial capture', () => {
    expect(probe('k7/8/4p3/3p4/8/8/6B1/7K w - - 0 1', ['g2d5', 'e6d5', 'h1g1'])).toBe(true);
  });
  it('counts declined offers of rook for knight and queen for rook', () => {
    expect(probe('k7/8/4p3/3n4/8/8/8/3R3K w - - 0 1', ['d1d5', 'a8b8'])).toBe(true);
    expect(probe('k7/8/4p3/3r4/8/8/8/3Q3K w - - 0 1', ['d1d5', 'a8b8'])).toBe(true);
  });
  it('does not attribute a pre-existing hanging piece to an unrelated move', () => {
    expect(probe('k7/8/8/3p4/4P3/8/8/7K w - - 0 1', ['h1g1', 'd5e4'])).toBe(false);
  });
  it('uses new material loss rather than an existing material deficit', () => {
    expect(probe('k7/p7/8/3p4/8/3PP3/8/7K w - - 0 1', ['e3e4', 'd5e4', 'd3e4'])).toBe(false);
  });
  it('handles black offers and en passant acceptance', () => {
    expect(probe('k7/8/4p3/8/3P4/8/8/7K b - - 0 1', ['e6e5', 'd4e5'])).toBe(true);
    expect(probe('k7/8/8/8/3p4/8/4P3/7K w - - 0 1', ['e2e4', 'd4e3'])).toBe(true);
  });
  it('recognizes an actual King’s Gambit offer', () => {
    const chess = new Chess();
    chess.move('e4'); chess.move('e5');
    expect(probe(chess.fen(), ['f2f4', 'e5f4', 'g1f3', 'd7d6'])).toBe(true);
  });
  it('abstains on illegal lines, exhausted budgets and unresolved tactics', () => {
    expect(probe(pawnOffer, ['e3e4', 'a8a1'])).toBe(false);
    expect(offersSacrifice(pawnOffer, ['e3e4'], { expires: Infinity, nodes: 0 })).toBe(false);
    expect(offersSacrifice(pawnOffer, ['e3e4'], { expires: 0, nodes: 10000 })).toBe(false);
  });
});

describe('candidate ranking', () => {
  it('waits for a complete distinct common-depth set', () => {
    const set = new CandidateSet(2);
    set.add(info(1, 'h1g1', 50));
    expect(set.complete).toHaveLength(0);
    set.add(info(2, 'e3e4', 20));
    expect(set.complete.map(row => row.depth)).toEqual([7, 7]);
    set.add(info(1, 'h1g1', 80, 8));
    expect(set.complete.map(row => row.depth)).toEqual([7, 7]);
    set.add(info(2, 'h1g1', 70, 8));
    expect(set.complete.map(row => row.depth)).toEqual([7, 7]);
  });
  it('breaks equal-size sacrifice ties by better evaluation', () => {
    const set = new CandidateSet(3);
    const fen = 'k7/8/8/3p1p2/8/4P1P1/8/7K w - - 0 1';
    set.add(info(1, 'h1g1', 50));
    set.add(info(2, 'e3e4', 30));
    set.add(info(3, 'g3g4', 20));
    expect(chooseSacrifice(fen, set, 'h1g1', performance.now() + 2000)?.pv[0]).toBe('e3e4');
  });
  it('prefers a larger sacrifice even with a worse evaluation, within the allowance', () => {
    const fen = 'k7/8/8/p7/3p4/8/1P4N1/7K w - - 0 1';
    const set = new CandidateSet(3);
    set.add(info(1, 'h1g1', 50));
    set.add(info(2, 'b2b4 a8b8', 40));
    set.add(info(3, 'g2e3 a8b8', 50 - settings.maxSacrificeLossCp));
    expect(chooseSacrifice(fen, set, 'h1g1', performance.now() + 2000)?.pv[0]).toBe('g2e3');
    set.add(info(1, 'h1g1', 50, 8));
    set.add(info(2, 'b2b4 a8b8', 40, 8));
    set.add(info(3, 'g2e3 a8b8', 49 - settings.maxSacrificeLossCp, 8));
    expect(chooseSacrifice(fen, set, 'h1g1', performance.now() + 2000)?.pv[0]).toBe('b2b4');
  });
  it('finds and verifies a sacrifice after a quiet setup move', () => {
    const quiet = ['h1g1', 'a8b8', 'e3e4', 'b8a8'];
    expect(sacrificePotential(pawnOffer, quiet)).toBe(100);
    expect(lineSacrificeSize(pawnOffer, quiet, { expires: performance.now() + 2000, nodes: 10000 })).toBe(100);
    const set = new CandidateSet(2);
    set.add(info(1, 'h1h2 a8b8', 50));
    set.add(info(2, quiet.join(' '), 0));
    expect(shortlistCandidates(pawnOffer, set, 'h1h2', 2)).toEqual(['h1h2', 'h1g1']);
    expect(chooseSacrifice(pawnOffer, set, 'h1h2', performance.now() + 2000)?.pv[0]).toBe('h1g1');
  });
  it('measures net material rather than the captured piece face value', () => {
    const budget = () => ({ expires: performance.now() + 2000, nodes: 10000 });
    expect(sacrificeSize('k7/8/4p3/3n4/8/8/8/3R3K w - - 0 1', ['d1d5', 'a8b8'], budget())).toBe(180);
    expect(sacrificeSize('k7/8/4p3/3r4/8/8/8/3Q3K w - - 0 1', ['d1d5', 'a8b8'], budget())).toBe(400);
  });
  it('enforces the configured cp budget with inclusive boundary', () => {
    const set = new CandidateSet(2);
    set.add(info(1, 'h1g1', 21 + settings.maxSacrificeLossCp)); set.add(info(2, 'e3e4', 20));
    expect(chooseSacrifice(pawnOffer, set, 'h1g1')).toBeUndefined();
    set.add(info(1, 'h1g1', 20 + settings.maxSacrificeLossCp, 8)); set.add(info(2, 'e3e4', 20, 8));
    expect(chooseSacrifice(pawnOffer, set, 'h1g1')?.pv[0]).toBe('e3e4');
  });
  it('preserves mate decisions, including newer incomplete search results', () => {
    const set = new CandidateSet(2);
    set.add(info(1, 'h1g1', 50)); set.add(info(2, 'e3e4', 20));
    set.add({ ...info(1, 'h1g1', 0, 8), score: { kind: 'mate', value: 3 } });
    expect(chooseSacrifice(pawnOffer, set, 'h1g1')).toBeUndefined();
    set.add({ ...info(1, 'h1g1', 0, 9), score: { kind: 'mate', value: -3 } });
    expect(chooseSacrifice(pawnOffer, set, 'h1g1')).toBeUndefined();
  });
  it('falls back for shallow, incomplete or unavailable best-move sets', () => {
    const set = new CandidateSet(2);
    set.add(info(1, 'h1g1', 50, 3)); set.add(info(2, 'e3e4', 20, 3));
    expect(chooseSacrifice(pawnOffer, set, 'h1g1')).toBeUndefined();
    set.add(info(1, 'h1g1', 50, 4));
    expect(chooseSacrifice(pawnOffer, set, 'h1g1')).toBeUndefined();
    set.add(info(2, 'e3e4', 20, 4));
    expect(chooseSacrifice(pawnOffer, set, 'h1h2')).toBeUndefined();
  });
});
