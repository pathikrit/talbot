// Mechanical transformations are applied only to generated build copies.
// The downloaded, pinned upstream tree remains unchanged and auditable.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

mkdirSync('.build/patricia', { recursive: true });
cpSync('vendor/engine/src', '.build/patricia/src', { recursive: true });
function patch(file, from, to) {
  const path = `.build/patricia/src/${file}`;
  const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  if (!source.includes(from)) throw new Error(`Upstream patch no longer applies: ${file}`);
  writeFileSync(path, source.replace(from, to));
}

patch('utils.h', 'typedef unsigned __int128 uint128_t;', '// Talbot: portable multiply-high below; Hash is limited to 32 MB.');
patch('utils.h', '  std::vector<RootMoveInfo> root_moves;',
  '  std::vector<RootMoveInfo> root_moves;\n  std::vector<Move> talbot_root_filter;');
patch('utils.h', 'return (uint128_t(hash) * uint128_t(TT_size)) >> 64;',
  'return ((hash >> 32) * TT_size + (((hash & 0xffffffffULL) * TT_size) >> 32)) >> 32;');
// With a single search thread these barriers have no work to synchronize.
const utils = readFileSync('.build/patricia/src/utils.h', 'utf8');
const barrier = utils.slice(utils.indexOf('class Barrier {'), utils.indexOf('Barrier reset_barrier'));
patch('utils.h', barrier, 'class Barrier { public: Barrier(int64_t) {} void reset(int64_t) {} void arrive_and_wait() {} };\n\n');
patch('search.h', '#include "fathom/src/tbprobe.h"',
  '#include "talbot-platform.h"\nconstexpr uint32_t TB_RESULT_FAILED = 0xffffffffU;\nconstexpr uint32_t TB_LOSS = 0, TB_WIN = 4;');
const search = readFileSync('.build/patricia/src/search.h', 'utf8');
patch('search.h', search.slice(search.indexOf('TbResult probe_tb('), search.indexOf('bool out_of_time(')),
  'TbResult probe_tb(Position &) { return TB_RESULT_FAILED; }\n\n');
patch('search.h', 'bool out_of_time(ThreadInfo &thread_info) {',
  'bool out_of_time(ThreadInfo &thread_info) {\n  talbot_poll();');
// Experimental Talbot style: keep Feanor for non-endgame search roots.
patch('search.h', 'if (depth >= 6 && total_mat(position) >= PhaseBound) {',
  'if (false && depth >= 6 && total_mat(position) >= PhaseBound) {');
patch('search.h', '    for (int i = 0; i < nmoves; i++) {\n      thread_info.root_moves.push_back({raw_root_moves[i], 0});\n    }',
  '    for (int i = 0; i < nmoves; i++) {\n' +
  '      bool allowed = thread_info.talbot_root_filter.empty();\n' +
  '      for (Move move : thread_info.talbot_root_filter) allowed |= move == raw_root_moves[i];\n' +
  '      if (allowed) thread_info.root_moves.push_back({raw_root_moves[i], 0});\n' +
  '    }');
patch('search.h', '    // skip various excluded moves\n    if (root) {',
  '    // Talbot: a focused stage may restrict legal root moves.\n' +
  '    if (root && !find_root_move(thread_info, move)) continue;\n\n' +
  '    // skip various excluded moves\n    if (root) {');
// Guarantee a legal answer even when stopped before the first completed depth.
patch('search.h', 'Move prev_best = MoveNone;',
  'if (thread_info.root_moves.empty()) { printf("bestmove 0000\\n"); return; }\n' +
  '  thread_info.best_moves[0] = thread_info.root_moves[0].move;\n\n  Move prev_best = MoveNone;');

patch('nnue.h', 'INCBIN(nnue, "nets/fingolfin.nnue");\nINCBIN(nnue2, "nets/finarfin.nnue");\nINCBIN(nnue3, "nets/feanor.nnue");', '#include "talbot-nets.h"');
patch('nnue.h', '#include "incbin.h"', '// Talbot embeds portable aligned arrays instead of native assembler.');
// Portable, aligned, compile-time embedded weights: no filesystem or network
// fetches at runtime, and identical bytes in native/WASM reference builds.
let header = '#pragma once\n#include <cstdint>\n';
const nets = [];
for (const [i, name] of ['fingolfin', 'finarfin', 'feanor'].entries()) {
  const data = readFileSync(`vendor/engine/nets/${name}.nnue`);
  if (data.length !== 1579010) throw new Error(`Unexpected network size: ${name}`);
  nets.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  const values = Array.from({ length: data.length / 2 }, (_, j) => data.readInt16LE(j * 2));
  header += `alignas(64) const int16_t g_nnue${i === 0 ? '' : i + 1}Data[] = {\n`;
  for (let j = 0; j < values.length; j += 32) header += values.slice(j, j + 32).join(',') + ',\n';
  header += '};\n';
}
writeFileSync('.build/patricia/src/talbot-nets.h', header);
mkdirSync('public/engine', { recursive: true });
writeFileSync('public/engine/provenance.json', JSON.stringify({
  engine: 'Patricia 5.1 — Talbot sacrifice-network variant',
  commit: 'f1ee4273c6e6068bd6ec0d53ca91c1c391543f85', emscripten: '6.0.9', nets,
}, null, 2) + '\n');
cpSync('vendor/LICENSE', 'public/engine/PATRICIA-LICENSE.txt');
