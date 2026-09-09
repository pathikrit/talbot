#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f vendor/engine/src/search.h ]; then
  echo "Run make bootstrap first (downloads pinned Patricia and Emscripten)." >&2
  exit 1
fi
# Rebuild only when source/build inputs have changed; caches are never source.
MODE=${1:-wasm}
OUTPUT=public/engine/patricia.js
if [ "$MODE" = native ]; then OUTPUT=.build/patricia-native; fi
if [ -f "$OUTPUT" ] && { [ "$MODE" = native ] || [ -f public/engine/patricia.wasm ]; } && [ -f public/engine/provenance.json ] && [ -f public/engine/PATRICIA-LICENSE.txt ] && [ -z "$(find engine scripts/prepare-engine.mjs scripts/build-engine.sh vendor/engine/src vendor/engine/nets -type f -newer "$OUTPUT" -print -quit)" ]; then
  exit 0
fi
node scripts/prepare-engine.mjs
if [ "$MODE" = native ]; then
  "${CXX:-clang++}" engine/bridge.cpp -Iengine -I.build/patricia/src \
    -std=c++20 -O3 -DNDEBUG -pthread -o .build/patricia-native
else
  if [ ! -f .tools/emsdk/emsdk_env.sh ]; then
    echo "Run make bootstrap to install the pinned Emscripten SDK." >&2
    exit 1
  fi
  . .tools/emsdk/emsdk_env.sh
  em++ engine/bridge.cpp -Iengine -I.build/patricia/src \
    -std=c++20 -O3 -DNDEBUG --no-entry \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPatricia \
    -sENVIRONMENT=web,worker,node -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=262144 \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=536870912 \
    -sSTACK_SIZE=4194304 -sFILESYSTEM=0 \
    '-sEXPORTED_RUNTIME_METHODS=["ccall"]' \
    -o public/engine/patricia.js
fi
