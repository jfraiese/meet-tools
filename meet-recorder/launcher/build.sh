#!/bin/bash
# Build the Chrome launcher that makes auto-recording possible.
#
#   meet-recorder/launcher/build.sh ["App name"]
#
# Writes ~/Applications/<App name>.app (default "Chrome (auto-record)") with
# Chrome's icon. Put it in the Dock in place of Chrome.
#
# An unpacked extension's id is derived from its folder's absolute path, so it
# is computed here instead of being written down. Move the checkout and the id
# changes, so rebuild.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd -P)"
ext_dir="$(cd "$here/.." && pwd -P)"
name="${1:-Chrome (auto-record)}"
app="$HOME/Applications/$name.app"
chrome="/Applications/Google Chrome.app"

# Chrome's rule: sha256 of the path, first 32 hex digits, each mapped 0-f -> a-p.
ext_id="$(printf '%s' "$ext_dir" | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sed -e "s/__EXTENSION_ID__/$ext_id/" -e "s/__APP_NAME__/$name/" "$here/launcher.applescript" > "$tmp/launcher.applescript"

mkdir -p "$HOME/Applications"
rm -rf "$app"
osacompile -o "$app" "$tmp/launcher.applescript"

# Chrome's icon. osacompile's asset catalog wins over applet.icns, so it goes.
cp "$chrome/Contents/Resources/app.icns" "$app/Contents/Resources/applet.icns"
rm -f "$app/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$app/Contents/Info.plist" 2>/dev/null || true
codesign --force --deep -s - "$app" >/dev/null 2>&1
touch "$app"

echo "Built $app for extension $ext_id"
