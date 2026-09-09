import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import createPatricia from '../public/engine/patricia.js';

let lines = [];
const engine = await createPatricia({ print: line => lines.push(line) });
const call = (name, type = null, types = [], args = [], options) => engine.ccall(`talbot_${name}`, type, types, args, options);
call('init');
function position(fen, moves = '') {
  call('reset');
  assert.equal(call('position', 'number', ['string', 'string'], [fen, moves]), 1);
  lines = [];
}
const lastInfo = output => output.filter(line => line.startsWith('info ') && !line.includes('bound')).at(-1);
const bestmove = output => output.findLast(line => line.startsWith('bestmove '))?.split(' ')[1];
const native = (fen, depth, moves = '') => execFileSync('.build/patricia-native', ['search', fen, String(depth), moves], { encoding: 'utf8' }).trim().split('\n');
const search = (ms, depth = 0, multipv = 1) => call('search', null, ['number', 'number', 'number'], [ms, depth, multipv], { async: true });
const searchMoves = (ms, depth, moves) => call('search_moves', null,
  ['number', 'number', 'number', 'string'], [ms, depth, moves.length, moves.join(' ')], { async: true });

for (const [name, fen, depth, nodes] of [
  ['start', DEFAULT_POSITION, 4, 197281],
  ['kiwipete / castling', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
  ['endgame / en passant', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
]) {
  position(fen);
  assert.equal(call('perft', 'number', ['number'], [depth]), nodes, name);
  console.log(`PASS perft ${name}: ${nodes}`);
}

const cases = [
  ['start / sacrifice network', DEFAULT_POSITION, ''],
  ['after e4 / black', DEFAULT_POSITION, 'e2e4'],
  ['open gambit', DEFAULT_POSITION, 'e2e4 e7e5 f2f4 e5f4'],
  ['promotion / endgame network', '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', ''],
  ['en passant', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', ''],
];
for (const [name, fen, moves] of cases) {
  position(fen, moves);
  await search(-1, 7);
  const reference = native(fen, 7, moves);
  const info = lastInfo(lines), ref = lastInfo(reference);
  for (const field of ['depth', 'score (?:cp|mate)', 'nodes']) {
    const pattern = new RegExp(`\\b${field} (-?\\d+)`);
    assert.equal(info.match(pattern)?.[1], ref.match(pattern)?.[1], `${name}: ${field}`);
  }
  assert.equal(bestmove(lines), bestmove(reference), `${name}: best move`);
  const chess = new Chess(fen);
  for (const move of moves.split(' ').filter(Boolean)) chess.move(move);
  assert.ok(chess.move(bestmove(lines)), name);
  console.log(`PASS native/WASM parity ${name}: ${bestmove(lines)}`);
}

position(DEFAULT_POSITION);
await search(-1, 4, 20);
const candidates = lines.filter(line => /multipv \d+ depth 4 /.test(line) && !line.includes('bound'));
assert.equal(candidates.length, 20);
assert.equal(new Set(candidates.map(line => line.match(/ pv (\S+)/)?.[1])).size, 20);
console.log('PASS MultiPV: 20 distinct legal first moves');

position(DEFAULT_POSITION);
await searchMoves(-1, 5, ['e2e4', 'd2d4']);
const focused = lines.filter(line => /multipv \d+ depth 5 /.test(line) && !line.includes('bound'));
assert.equal(focused.length, 2);
assert.deepEqual(new Set(focused.map(line => line.match(/ pv (\S+)/)?.[1])), new Set(['e2e4', 'd2d4']));
assert.ok(['e2e4', 'd2d4'].includes(bestmove(lines)));
console.log('PASS focused root search: e2e4 / d2d4 only');

// Match the browser lifecycle: interrupt a ponder, broadly search the played
// position, then continue on a root-restricted finalist set without resetting TT.
position(DEFAULT_POSITION);
let ponderStopped = false;
const ponderTimer = setTimeout(() => { ponderStopped = true; call('stop'); }, 80);
await search(-1, 0, 20);
clearTimeout(ponderTimer);
assert.ok(ponderStopped);
assert.equal(call('position', 'number', ['string', 'string'], [DEFAULT_POSITION, 'e2e4']), 1);
lines = [];
await search(400, 0, 20);
const rootDepth = Math.max(...lines.flatMap(line => Number(line.match(/info multipv 20 depth (\d+)/)?.[1] ?? 0)));
const broadRoots = lines.filter(line => line.includes(`multipv `) && line.includes(`depth ${rootDepth} `)
  && !line.includes('bound')).slice(0, 6).map(line => line.match(/ pv (\S+)/)?.[1]).filter(Boolean);
assert.equal(broadRoots.length, 6);
lines = [];
await searchMoves(500, 0, broadRoots);
assert.ok(broadRoots.includes(bestmove(lines)));
console.log(`PASS staged ponder/broad/focused lifecycle: ${broadRoots.join(' ')}`);

position(DEFAULT_POSITION);
const started = performance.now();
await search(1000);
const elapsed = performance.now() - started;
assert.ok(elapsed >= 900 && elapsed < 1500, `movetime was ${elapsed}ms`);
assert.ok(new Chess().move(bestmove(lines)));
console.log(`PASS one-second search: ${Math.round(elapsed)} ms, ${lastInfo(lines)}`);

for (let i = 0; i < 5; i++) {
  position(DEFAULT_POSITION, i % 2 ? 'e2e4' : '');
  let stoppedAt = 0;
  const timer = setTimeout(() => { stoppedAt = performance.now(); call('stop'); }, 80);
  await search(-1);
  clearTimeout(timer);
  assert.ok(stoppedAt > 0, 'infinite search yielded to the event loop');
  assert.ok(performance.now() - stoppedAt < 250, 'stop promptly unwinds');
  assert.ok(bestmove(lines));
}
console.log('PASS cooperative stop and repeated position replacement');

position('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1');
await search(1000);
assert.equal(bestmove(lines), '0000');
console.log('PASS no-legal-move handling');

if (process.argv.includes('--bench')) {
  position(DEFAULT_POSITION);
  const t = performance.now();
  await search(-1, 12);
  const wasmMs = performance.now() - t;
  const n = performance.now(); native(DEFAULT_POSITION, 12);
  console.log(`BENCH startpos depth 12: WASM ${wasmMs.toFixed(0)} ms, native ${(performance.now() - n).toFixed(0)} ms (includes native startup)`);
}
