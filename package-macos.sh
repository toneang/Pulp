#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Please run this script on macOS."
  exit 1
fi
pnpm install --frozen-lockfile
pnpm tauri build --bundles app,dmg
mkdir -p release
chip="$(uname -m)"
ditto -c -k --sequesterRsrc --keepParent src-tauri/target/release/bundle/macos/Pulp.app "release/Pulp-macos-${chip}.app.zip"
cp src-tauri/target/release/bundle/dmg/*.dmg release/
echo "Packages saved to release/"
