import { Chess, DEFAULT_POSITION } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { OpeningBook, openingKey } from '../../src/engine/openings';
import type { BookData } from '../../src/engine/openings';
import { CandidateSet } from '../../src/engine/sacrifice';
import { parseInfo } from '../../src/engine/protocol';
import data from '../../book/opening-book.json';

function fixture(): BookData {
  const positions: string[] = [];
  const entries = [
    ['kings', 'w', 4, 'e2e4 e7e5 f2f4 e5f4 g1f3'],
    ['queens', 'w', 4, 'd2d4 d7d5 c2c4 e7e6 b1c3'],
    ['italian', 'w', 1, 'e2e4 e7e5 g1f3 b8c6 f1c4'],
    ['budapest', 'b', 4, 'd2d4 g8f6 c2c4 e7e5 d4e5 f6g4'],
  ] as const;
  return {
    positions,
    families: entries.map(([id, side, weight]) => ({ id, side, weight, label: id })),
    lines: entries.map(([id, , , sequence]) => {
      const chess = new Chess();
      const moves = sequence.split(' ');
      const path = moves.map(move => {
        const key = openingKey(chess);
        if (!positions.includes(key)) positions.push(key);
        const index = positions.indexOf(key);
        chess.move(move);
        return index;
      });
      return { id, family: id, name: id, moves, path };
    }),
  };
}
function candidates(moves: string[], scores = moves.map(() => 20), depth = 7) {
  const set = new CandidateSet(moves.length);
  moves.forEach((move, i) => set.add(parseInfo(`info depth ${depth} multipv ${i + 1} score cp ${scores[i]} pv ${move}`)!));
  return set;
}
function position(moves: string[] = []) {
  const chess = new Chess();
  moves.forEach(move => chess.move(move));
  return { chess, request: { fen: DEFAULT_POSITION, moves } };
}

describe('compiled book', () => {
  it('contains only named gambits and traps, with no ordinary opening families', () => {
    for (const line of data.lines) expect(line.name).toMatch(/gambit|trap/i);
    for (const id of ['italian', 'sicilian', 'french']) {
      expect(data.families.some(family => family.id === id)).toBe(false);
    }
  });
  it('contains legal, position-indexed lines with explicit playing sides', () => {
    expect(data.lines.length).toBeGreaterThan(100);
    expect(new Set(data.lines.map(line => line.id)).size).toBe(data.lines.length);
    for (const line of data.lines) {
      const chess = new Chess();
      expect(line.path.length).toBe(line.moves.length);
      expect(data.families.find(family => family.id === line.family)?.side).toMatch(/^[wb]$/);
      line.moves.forEach((move, ply) => {
        expect(data.positions[line.path[ply]]).toBe(openingKey(chess));
        chess.move(move);
      });
    }
    for (const family of data.families) expect(family.label).toMatch(/(?:gambit|trap|attack)$/i);
    for (const id of ['alien', 'evans', 'kings', 'queens', 'stafford', 'mortimer', 'noahs-ark']) {
      expect(data.families.some(family => family.id === id)).toBe(true);
    }
  });
});

describe('initial random choice then committed repertoire', () => {
  it('balances distinct opening moves, then weights compatible families', () => {
    const book = new OpeningBook(fixture());
    const { chess, request } = position();
    const set = candidates(['e2e4', 'd2d4', 'g1f3']);
    const counts: Record<string, number> = {};
    for (let move = 0; move < 2; move++) {
      for (let family = 0; family < 5; family++) {
        const draws = [(move + .5) / 2, (family + .5) / 5, 0];
        const chosen = book.choose(chess, request, set, 'e2e4', undefined, () => draws.shift()!)!;
        counts[chosen.lineId] = (counts[chosen.lineId] ?? 0) + 1;
      }
    }
    expect(counts).toEqual({ kings: 4, queens: 5, italian: 1 });
  });
  it('selects only gambit/trap book replies even when ordinary alternatives are searched', () => {
    const { chess, request } = position(['e2e4']);
    const set = candidates(['e7e5', 'c7c5', 'e7e6']);
    const book = new OpeningBook(data);
    const counts: Record<string, number> = {};
    for (let n = 0; n < 70; n++) {
      const draws = [(n + .5) / 70, 0, 0];
      const chosen = book.choose(chess, request, set, 'e7e5', undefined, () => draws.shift()!)!;
      const move = chosen.analysis.pv[0];
      counts[move] = (counts[move] ?? 0) + 1;
      expect(data.families.find(f => f.id === data.lines.find(l => l.id === chosen.lineId)!.family)!.side).toBe('b');
    }
    expect(counts).toEqual({ e7e5: 70 });
    expect(book.choose(chess, request, candidates(['c7c5', 'e7e6']), 'c7c5')).toBeUndefined();
  });
  it('downweights a recently repeated move, family and exact line', () => {
    const book = new OpeningBook(fixture());
    const { chess, request } = position();
    const recent = [{ lineId: 'kings', move: 'e2e4' }];
    let draws = [.2, 0, 0];
    expect(book.choose(chess, request, candidates(['e2e4', 'd2d4']), 'e2e4', undefined,
      () => draws.shift()!, recent)?.lineId).toBe('queens');
    draws = [0, .75, 0];
    expect(book.choose(chess, request, candidates(['e2e4']), 'e2e4', undefined,
      () => draws.shift()!, recent)?.lineId).toBe('italian');
  });
  it('does not increase family probability when duplicate variations are added', () => {
    const source = fixture();
    for (let i = 0; i < 30; i++) source.lines.push({ ...source.lines[0], id: `duplicate-${i}` });
    const { chess, request } = position();
    const chosen = new OpeningBook(source).choose(chess, request, candidates(['e2e4', 'd2d4']), 'e2e4', undefined, () => .6);
    expect(chosen?.lineId).toBe('queens');
  });
  it('follows the chosen gambit without calling random again', () => {
    const { chess, request } = position(['e2e4', 'e7e5']);
    const choice = new OpeningBook(fixture()).choose(chess, request, candidates(['g1f3', 'f2f4'], [30, -20]),
      'g1f3', 'kings', () => { throw new Error('Unexpected rerandomization'); });
    expect(choice?.analysis.pv[0]).toBe('f2f4');
    expect(choice?.lineId).toBe('kings');
  });
  it('accepts a line at a one-pawn loss but abandons it above that', () => {
    const { chess, request } = position(['e2e4', 'e7e5']);
    const book = new OpeningBook(fixture());
    expect(book.choose(chess, request, candidates(['g1f3', 'f2f4'], [30, -70]), 'g1f3', 'kings')?.analysis.pv[0]).toBe('f2f4');
    expect(book.choose(chess, request, candidates(['g1f3', 'f2f4'], [30, -71]), 'g1f3', 'kings')).toBeUndefined();
  });
  it('falls back on deviations, exhausted lines and explicit out-of-book state', () => {
    const book = new OpeningBook(fixture());
    const deviated = position(['e2e4', 'c7c5']);
    expect(book.choose(deviated.chess, deviated.request, candidates(['g1f3']), 'g1f3', 'kings')).toBeUndefined();
    const ended = position(['e2e4', 'e7e5', 'f2f4', 'e5f4', 'g1f3', 'd7d5']);
    expect(book.choose(ended.chess, ended.request, candidates(['e4d5']), 'e4d5', 'kings')).toBeUndefined();
    const initial = position();
    expect(book.choose(initial.chess, initial.request, candidates(['e2e4']), 'e2e4', null)).toBeUndefined();
  });
  it('does not start a fresh random line after the first two moves', () => {
    const { chess, request } = position(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    const book = new OpeningBook(fixture());
    expect(book.choose(chess, request, candidates(['f1c4']), 'f1c4')).toBeUndefined();
    expect(book.choose(chess, request, candidates(['f1c4']), 'f1c4', 'italian')?.analysis.pv[0]).toBe('f1c4');
  });
  it('recognizes a compatible transposition without changing the selected line', () => {
    const { chess, request } = position(['c2c4', 'e7e6', 'd2d4', 'd7d5']);
    const choice = new OpeningBook(fixture()).choose(chess, request, candidates(['b1c3']), 'b1c3', 'queens');
    expect(choice?.lineId).toBe('queens');
    expect(choice?.analysis.pv[0]).toBe('b1c3');
  });
  it('selects the gambit-playing side, never the opponent’s lines', () => {
    const { chess, request } = position(['d2d4']);
    const book = new OpeningBook(fixture());
    const set = candidates(['d7d5', 'g8f6']);
    expect(book.choose(chess, request, set, 'd7d5', undefined, () => 0)?.lineId).toBe('budapest');
    expect(book.choose(chess, request, set, 'd7d5', 'queens')).toBeUndefined();
  });
  it('refuses unsearched, shallow and mate-scored choices or custom starting positions', () => {
    const { chess, request } = position();
    const book = new OpeningBook(fixture());
    expect(book.choose(chess, request, candidates(['g1f3']), 'g1f3')).toBeUndefined();
    expect(book.choose(chess, request, candidates(['e2e4'], [20], 3), 'e2e4')).toBeUndefined();
    const set = candidates(['e2e4']);
    set.add(parseInfo('info depth 8 multipv 1 score mate 5 pv e2e4')!);
    expect(book.choose(chess, request, set, 'e2e4')).toBeUndefined();
    expect(book.choose(chess, { ...request, fen: request.fen.replace('0 1', '0 10') }, candidates(['e2e4']), 'e2e4')).toBeUndefined();
  });
});
