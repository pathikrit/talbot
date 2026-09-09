// Talbot adapter for Patricia 5.1 (MIT). No native UCI reader or threads.
#include <atomic>
#include "search.h"
#include <iostream>
#include <memory>
#include <sstream>

static std::unique_ptr<ThreadInfo> info;
static Position board;
static bool busy = false;

extern "C" {
TALBOT_EXPORT void talbot_init() {
  setvbuf(stdout, nullptr, _IONBF, 0);
  init_LMR();
  init_bbs();
  info = std::make_unique<ThreadInfo>();
  resize_TT(32);
  new_game(*info, TT);
  thread_data.num_threads = 1;
  info->is_human = false; // Skill_Level=21: no deliberate strength reduction.
}

TALBOT_EXPORT void talbot_stop() { thread_data.stop = true; }

TALBOT_EXPORT void talbot_reset() {
  if (!busy) new_game(*info, TT);
}

// FEN plus complete reversible history preserves repetition information.
// The JS caller validates the FEN with chess.js before crossing this boundary.
TALBOT_EXPORT int talbot_position(const char *fen, const char *moves) {
  if (busy) return 0;
  info->game_ply = 6;
  info->search_ply = 0;
  std::memset(&info->game_hist, 0, sizeof(info->game_hist));
  set_board(board, *info, fen);
  calculate(board);
  std::istringstream stream(moves);
  std::string uci;
  while (stream >> uci) {
    if (info->game_ply >= GameSize - MaxSearchDepth - 8) return 0;
    std::array<Move, ListSize> legal;
    const int count = legal_movegen(board, legal);
    Move chosen = MoveNone;
    for (int i = 0; i < count; ++i) {
      if (internal_to_uci(board, legal[i]) == uci) chosen = legal[i];
    }
    if (!chosen) return 0;
    ss_push(board, *info, chosen);
    make_move(board, chosen);
  }
  return 1;
}

TALBOT_EXPORT void talbot_search(int milliseconds, int depth, int multipv) {
  if (busy) return;
  busy = true;
  info->max_iter_depth = depth > 0 ? std::clamp(depth, 1, MaxSearchDepth) : MaxSearchDepth;
  info->multipv = std::clamp(multipv, 1, 255);
  info->max_nodes_searched = UINT64_MAX / 2;
  info->opt_nodes_searched = UINT64_MAX / 2;
  info->max_time = milliseconds < 0 ? INT32_MAX / 2 : std::max(1, milliseconds);
  info->opt_time = INT32_MAX / 2;
  info->start_time = std::chrono::steady_clock::now();
  search_position(board, *info, TT);
  busy = false;
}

uint64_t count_nodes(Position &position, int depth) {
  if (depth == 0) return 1;
  std::array<Move, ListSize> legal;
  int count = legal_movegen(position, legal);
  if (depth == 1) return count;
  uint64_t nodes = 0;
  for (int i = 0; i < count; ++i) {
    Position child = position;
    make_move(child, legal[i]);
    nodes += count_nodes(child, depth - 1);
  }
  return nodes;
}

TALBOT_EXPORT double talbot_perft(int depth) {
  return !busy && depth >= 0 && depth <= 5 ? count_nodes(board, depth) : -1;
}
}

#ifndef __EMSCRIPTEN__
// Deterministic scalar reference executable used by the parity/bench tests.
int main(int argc, char **argv) {
  if (argc < 4) return 1;
  talbot_init();
  if (!talbot_position(argv[2], argc > 4 ? argv[4] : "")) return 2;
  if (std::string(argv[1]) == "perft") std::cout << talbot_perft(std::atoi(argv[3])) << '\n';
  else talbot_search(-1, std::atoi(argv[3]), 1);
}
#endif
