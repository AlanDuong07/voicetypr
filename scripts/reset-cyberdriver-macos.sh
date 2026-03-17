#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This reset script is intended for macOS only."
  exit 1
fi

shopt -s nullglob

echo "Quitting running app instances..."
osascript -e 'quit app "Cyberdriver"' >/dev/null 2>&1 || true
osascript -e 'quit app "Voicetypr"' >/dev/null 2>&1 || true

# Wait briefly for graceful shutdown so the app can't rewrite state after we delete it.
for _ in {1..20}; do
  if ! pgrep -if "Cyberdriver.app/Contents/MacOS|Voicetypr.app/Contents/MacOS|/voicetypr($| )|/Cyberdriver($| )" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

# Force kill any stragglers.
pkill -if "Cyberdriver.app/Contents/MacOS" >/dev/null 2>&1 || true
pkill -if "Voicetypr.app/Contents/MacOS" >/dev/null 2>&1 || true
pkill -x voicetypr >/dev/null 2>&1 || true
pkill -x Cyberdriver >/dev/null 2>&1 || true

# Confirm processes are really gone before deleting state.
for _ in {1..20}; do
  if ! pgrep -if "Cyberdriver.app/Contents/MacOS|Voicetypr.app/Contents/MacOS|/voicetypr($| )|/Cyberdriver($| )" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo "Removing local app state..."
PATHS=(
  "$HOME/.cyberdriver"
  "$HOME/.config/.cyberdriver"
  "$HOME/Library/Application Support/io.cyberdesk.cyberdriver"
  "$HOME/Library/Application Support/io.cyberdesk.cyberdriver.dev"
  "$HOME/Library/Application Support/com.ideaplexa.voicetypr"
  "$HOME/Library/Application Support/com.ideaplexa.voicetypr.dev"
  "$HOME/Library/Saved Application State/io.cyberdesk.cyberdriver.savedState"
  "$HOME/Library/Saved Application State/io.cyberdesk.cyberdriver.dev.savedState"
  "$HOME/Library/Saved Application State/com.ideaplexa.voicetypr.savedState"
  "$HOME/Library/Saved Application State/com.ideaplexa.voicetypr.dev.savedState"
)

for path in "${PATHS[@]}"; do
  rm -rf "$path" >/dev/null 2>&1 || true
done

for pattern in \
  "$HOME/Library/Application Support/CrashReporter/"*cyberdriver*.plist \
  "$HOME/Library/Application Support/CrashReporter/"*voicetypr*.plist \
  "$HOME/Library/Preferences/"*cyberdriver* \
  "$HOME/Library/Preferences/"*voicetypr* \
  "$HOME/Library/Caches/"*cyberdriver* \
  "$HOME/Library/Caches/"*voicetypr* \
  "$HOME/Library/LaunchAgents/"*cyberdriver* \
  "$HOME/Library/LaunchAgents/"*voicetypr*
do
  rm -rf "$pattern" >/dev/null 2>&1 || true
done

echo "Resetting macOS TCC permissions for known bundle IDs..."
BUNDLE_IDS=(
  "io.cyberdesk.cyberdriver"
  "io.cyberdesk.cyberdriver.dev"
  "com.ideaplexa.voicetypr"
  "com.ideaplexa.voicetypr.dev"
)

SERVICES=(
  "Accessibility"
  "Microphone"
  "ScreenCapture"
  "AppleEvents"
)

for bundle in "${BUNDLE_IDS[@]}"; do
  for service in "${SERVICES[@]}"; do
    tccutil reset "$service" "$bundle" >/dev/null 2>&1 || true
  done
done

echo "Done."
echo
echo "What this did:"
echo "- Quit Cyberdriver and any legacy app variants if running"
echo "- Deleted known local app state, preferences, caches, launch agents, and crash reporter entries"
echo "- Reset Accessibility, Microphone, Screen Recording, and Apple Events permissions for known bundle IDs"
echo
echo "What this did NOT do:"
echo "- Delete your source repository"
echo "- Delete built app bundles under src-tauri/target"
echo
echo "Next step:"
echo "Rebuild and relaunch Cyberdriver to simulate a fresh local first-run experience."
