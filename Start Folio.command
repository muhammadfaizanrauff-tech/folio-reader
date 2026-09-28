#!/bin/zsh
# Double-click this file in Finder to start Folio and open it in your browser.
# Keep this window open while reading; close it (or press Ctrl+C) to stop Folio.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies…"
  npm install || { echo "npm install failed"; read -k1; exit 1; }
fi
if curl -s -o /dev/null --max-time 2 http://localhost:5173/; then
  echo "Folio is already running at http://localhost:5173/"
  open "http://localhost:5173/"
  exit 0
fi
(sleep 3 && open "http://localhost:5173/") &
echo "Starting Folio at http://localhost:5173/  (close this window to stop it)"
npm run dev -- --port 5173 --strictPort
