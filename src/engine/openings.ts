import { Chess, DEFAULT_POSITION } from 'chess.js';
import data from '../../book/opening-book.json';
import type { Analysis, PositionRequest } from './protocol';
import { CandidateSet, eligibleCandidates } from './sacrifice';

export interface BookLine {
  id: string;
  family: string;
  name: string;
  moves: string[];
  path: number[];
}
export interface BookData {
  families: { id: string; side: string; weight: number }[];
  positions: string[];
  lines: BookLine[];
}
export interface BookChoice { analysis: Analysis; lineId: string }
export const openingKey = (chess: Chess): string => chess.fen().split(' ').slice(0, 4).join(' ');

export class OpeningBook {
  private positions: Map<string, number>;
  private lines: Map<string, BookLine>;
  private families: Map<string, BookData['families'][number]>;
  private index = new Map<number, Map<string, Map<string, BookLine[]>>>();

  constructor(private book: BookData) {
    this.positions = new Map(book.positions.map((fen, id) => [fen, id]));
    this.lines = new Map(book.lines.map(line => [line.id, line]));
    this.families = new Map(book.families.map(family => [family.id, family]));
    for (const line of book.lines) {
      const side = this.families.get(line.family)?.side;
      line.path.forEach((position, ply) => {
        if (book.positions[position].split(' ')[1] !== side) return;
        const families = this.index.get(position) ?? new Map<string, Map<string, BookLine[]>>();
        const moves = families.get(line.family) ?? new Map<string, BookLine[]>();
        const lines = moves.get(line.moves[ply]) ?? [];
        if (!lines.some(existing => existing.id === line.id)) lines.push(line);
        moves.set(line.moves[ply], lines);
        families.set(line.family, moves);
        this.index.set(position, families);
      });
    }
  }

  choose(position: Chess, request: PositionRequest, candidates: CandidateSet, fallback: string,
    lineId?: string | null, random: () => number = Math.random): BookChoice | undefined {
    if (lineId === null || request.fen !== DEFAULT_POSITION) return;
    const positionId = this.positions.get(openingKey(position));
    if (positionId === undefined) return;
    const eligible = new Map(eligibleCandidates(candidates, fallback).map(info => [info.pv[0], info]));
    if (!eligible.size) return;
    if (lineId !== undefined) {
      const line = this.lines.get(lineId);
      if (!line || this.families.get(line.family)?.side !== position.turn()) return;
      // A compatible transposition is OK, but never rewind to an earlier part
      // of a line or introduce random branches after committing to it.
      const ply = line.path.indexOf(positionId, request.moves.length);
      const analysis = ply < 0 ? undefined : eligible.get(line.moves[ply]);
      return analysis ? { analysis, lineId } : undefined;
    }
    // Fresh choices are limited to each side's first two moves. Once attempted,
    // the controller records either the chosen line or permanent fallback.
    if (request.moves.length >= 4) return;
    const choices = [...(this.index.get(positionId) ?? [])].map(([id, moves]) => ({
      family: this.families.get(id)!,
      moves: [...moves].filter(([move]) => eligible.has(move)),
    })).filter(choice => choice.moves.length && choice.family.side === position.turn());
    if (!choices.length) return;
    // Families, then distinct moves, then lines: source duplication and families
    // with hundreds of named variations must not dominate the random draw.
    let ticket = random() * choices.reduce((sum, choice) => sum + choice.family.weight, 0);
    let chosen = choices.at(-1)!;
    for (const choice of choices) {
      ticket -= choice.family.weight;
      if (ticket < 0) { chosen = choice; break; }
    }
    const [move, lines] = chosen.moves[Math.floor(random() * chosen.moves.length)];
    const line = lines[Math.floor(random() * lines.length)];
    return { analysis: eligible.get(move)!, lineId: line.id };
  }
}

export const openingBook = new OpeningBook(data);
