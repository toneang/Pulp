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
version="$(node -p "require('./package.json').version")"
case "$(uname -m)" in
  arm64) chip=apple-silicon ;;
  x86_64) chip=intel ;;
  *) echo "Unsupported Mac architecture" >&2; exit 1 ;;
esac
ditto -c -k --sequesterRsrc --keepParent src-tauri/target/release/bundle/macos/Pulp.app "release/Pulp-$version-macos-$chip.app.zip"
for dmg in src-tauri/target/release/bundle/dmg/*.dmg; do
  cp "$dmg" "release/Pulp-$version-macos-$chip.dmg"
done
(
  cd release
  shasum -a 256 "Pulp-$version-macos-$chip.app.zip" "Pulp-$version-macos-$chip.dmg" > "SHA256SUMS-macos-$chip-$version.txt"
)
echo "Packages saved to release/"
