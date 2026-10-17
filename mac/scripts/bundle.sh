#!/usr/bin/env bash
# Builds the app and wraps it as dist/OP-1 Jam.app.
#
# A Swift package builds a bare executable; macOS wants a bundle around it
# before it will show an icon, ask for the mic with our wording, or let the
# person drag it into Applications. This puts the pieces in place and signs
# the result ad hoc, which is enough to run it on this Mac (right-click,
# Open, the first time). Run from anywhere; paths are relative to mac/.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/.." && pwd)"
app="$here/dist/OP-1 Jam.app"
contents="$app/Contents"

cd "$here"
swift build -c release
binary="$(swift build -c release --show-bin-path)/Op1Jam"

rm -rf "$app"
mkdir -p "$contents/MacOS" "$contents/Resources"
cp "$binary" "$contents/MacOS/Op1Jam"
cp "$here/Info.plist" "$contents/Info.plist"
echo -n "APPL????" > "$contents/PkgInfo"

# Resources the package processes (if any) land in a bundle next to the
# binary; carry it along so Bundle.module finds them.
bundle_dir="$(dirname "$binary")"
for resources in "$bundle_dir"/Op1Jam_Op1Jam.bundle; do
  [ -d "$resources" ] && cp -R "$resources" "$contents/Resources/"
done

# The icon: the Electron app's build/icon.png (or .icns) if it is there.
# A .png goes through sips and iconutil to become a .icns; otherwise skip
# and macOS shows the generic app icon.
icon_png="$root/build/icon.png"
icon_icns="$root/build/icon.icns"
if [ -f "$icon_icns" ]; then
  cp "$icon_icns" "$contents/Resources/AppIcon.icns"
elif [ -f "$icon_png" ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
  iconset="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$iconset"
  for size in 16 32 128 256 512; do
    double=$((size * 2))
    sips -z "$size" "$size" "$icon_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    sips -z "$double" "$double" "$icon_png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$contents/Resources/AppIcon.icns"
  rm -rf "$(dirname "$iconset")"
else
  echo "No build/icon.png or icon.icns found; skipping the icon."
fi

# Ad-hoc signature with the entitlements, so the mic permission works and
# the hardened runtime is on. Replace "-" with a Developer ID to notarize.
codesign --force --sign - --options runtime \
  --entitlements "$here/Op1Jam.entitlements" "$app"

echo "Built $app"
