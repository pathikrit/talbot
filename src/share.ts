import { Chess, DEFAULT_POSITION } from 'chess.js';
import { Game, moveUci } from './game';

const VERSION = '1';
const PREFIX = `#${VERSION}`;
const MAX_PLIES = 20_000;

const legalMoves = (chess: Chess): string[] => chess.moves({ verbose: true })
  .map(moveUci)
  .sort();

function encodeBytes(bytes: number[]): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBytes(value: string): number[] | undefined {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return;
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '='));
    return Array.from(binary, character => character.charCodeAt(0));
  } catch { return; }
}

/**
 * Compact, self-contained URL state. Each ply is one byte: its index in the
 * lexically sorted legal UCI moves for that position. The header stores the
 * human side and non-board result; the hash prefix versions the ordering.
 */
export function gameHash(game: Game): string {
  let outcome = 0;
  if (game.agreedDraw) outcome = 1;
  else if (game.resigned === 'w') outcome = 2;
  else if (game.resigned === 'b') outcome = 3;
  const bytes = [(outcome << 1) | Number(game.human === 'b')];
  const chess = new Chess(DEFAULT_POSITION);
  for (const move of game.moves) {
    const choices = legalMoves(chess);
    const index = choices.indexOf(move);
    if (index < 0 || index > 255) throw new Error(`Cannot share move ${move}.`);
    bytes.push(index);
    chess.move(move);
  }
  if (bytes.length === 1 && bytes[0] === 0) return '';
  return PREFIX + encodeBytes(bytes);
}

/** Returns undefined for absent, malformed, unsupported or illegal game data. */
export function gameFromHash(hash: string): Game | undefined {
  if (!hash.startsWith(PREFIX)) return;
  const bytes = decodeBytes(hash.slice(PREFIX.length));
  if (!bytes?.length || bytes.length > MAX_PLIES + 1 || bytes[0] > 7) return;
  const header = bytes[0];
  const outcome = header >> 1;
  const game = new Game();
  try {
    for (const index of bytes.slice(1)) {
      const move = legalMoves(game.chess)[index];
      if (!move) return;
      game.play(move);
    }
  } catch { return; }
  if (outcome && game.chess.isGameOver()) return;
  game.human = header & 1 ? 'b' : 'w';
  if (outcome === 1) game.agreedDraw = true;
  else if (outcome === 2) game.resigned = 'w';
  else if (outcome === 3) game.resigned = 'b';
  return game;
}
