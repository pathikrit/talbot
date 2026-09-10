#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
PATRICIA_COMMIT=f1ee4273c6e6068bd6ec0d53ca91c1c391543f85
PATRICIA_SHA=b3bf3e7572a7588a1f89b165c328a4fb03fe5955225869988c5910039327a14b
mkdir -p .tools vendor
if [ ! -f .tools/patricia.tar.gz ] || \
  ! node scripts/verify-download.mjs .tools/patricia.tar.gz "$PATRICIA_SHA"; then
  echo "Downloading verified Patricia sources (missing or invalid cache)."
  archive_tmp=$(mktemp .tools/patricia.tar.gz.XXXXXX)
  trap 'rm -f "$archive_tmp"' EXIT
  trap 'exit 1' HUP INT TERM
  # HTTP/2 transfers have returned truncated archives on a local network path.
  curl --http1.1 -fL --retry 3 -H 'Cache-Control: no-cache' \
    "https://codeload.github.com/Adam-Kulju/Patricia/tar.gz/$PATRICIA_COMMIT" -o "$archive_tmp"
  node scripts/verify-download.mjs "$archive_tmp" "$PATRICIA_SHA"
  mv "$archive_tmp" .tools/patricia.tar.gz
  trap - EXIT HUP INT TERM
fi
node scripts/verify-download.mjs .tools/patricia.tar.gz "$PATRICIA_SHA"
tar -xzf .tools/patricia.tar.gz --strip-components=1 -C vendor \
  "Patricia-$PATRICIA_COMMIT/engine/src" "Patricia-$PATRICIA_COMMIT/engine/nets" \
  "Patricia-$PATRICIA_COMMIT/LICENSE" "Patricia-$PATRICIA_COMMIT/README.md"
if [ ! -d .tools/emsdk ]; then
  git clone --depth 1 --branch 6.0.9 https://github.com/emscripten-core/emsdk.git .tools/emsdk
fi
.tools/emsdk/emsdk install 6.0.9
.tools/emsdk/emsdk activate 6.0.9
