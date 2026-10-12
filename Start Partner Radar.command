#!/bin/bash
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed yet. Opening the download page..."
  echo "Install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close"
  exit 1
fi
if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo "Install Codex or Claude Code and sign in for live research. The dashboard has setup help and a demo."
fi
if [ ! -d node_modules/express ] || ! cmp -s package-lock.json node_modules/.partner-radar-lock; then
  echo "Installing current dependencies, one moment..."
  npm ci --omit=dev || exit 1
  cp package-lock.json node_modules/.partner-radar-lock
fi
echo ""
echo "Partner Radar is running at http://localhost:4747"
echo "Keep this window open. Close it to stop."
(sleep 2; open "http://localhost:4747") &
node server.js
