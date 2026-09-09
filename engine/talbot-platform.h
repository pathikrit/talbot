#pragma once
#include <chrono>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define TALBOT_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define TALBOT_EXPORT
#endif

inline void talbot_poll() {
#ifdef __EMSCRIPTEN__
  // Cheap node counter; consult the clock at most once per 64 probes.
  // Asyncify unwinds the stack so worker messages can request a stop.
  static unsigned checks = 0;
  static double last_yield = 0;
  if ((++checks & 63) == 0) {
    const double now = emscripten_get_now();
    if (now - last_yield >= 12) {
      emscripten_sleep(0);
      last_yield = emscripten_get_now();
    }
  }
#endif
}
