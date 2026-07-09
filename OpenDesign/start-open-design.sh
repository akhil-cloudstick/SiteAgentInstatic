#!/bin/sh
# Start Open Design from the S: network share (Git Bash).
#
# Why this script instead of `pnpm tools-dev run web`:
#   S: is an SMB network share (\\ZAISERVER\dev_projects). Three things do NOT
#   work over SMB and are worked around here:
#     1. Symlinks/junctions  -> we run the daemon + web from their REAL folders
#        (node_modules holds real-dir copies of the workspace packages).
#     2. SQLite file locking  -> the daemon DATA dir is placed on local disk via
#        OD_DATA_DIR (this is throwaway runtime data — the DB, artifacts, logs —
#        NOT your code; all code stays on S:).
#     3. Next.js native file-watching -> we force polling (WATCHPACK_POLLING).
#
# Usage:  sh start-open-design.sh
# Then open:  http://127.0.0.1:7457/   (web UI)
# Stop:   Ctrl+C, or run  sh stop-open-design.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
# Include the local package bins AND the npm global bin (where the OpenCode CLI
# lives) so open-design can detect OpenCode as the generation agent.
export PATH="$ROOT/node_modules/.bin:/c/Users/itsinfra/AppData/Roaming/npm:$PATH"

# Runtime data (SQLite/artifacts/logs) on local disk — SQLite can't run on SMB.
export OD_DATA_DIR="${OD_DATA_DIR:-C:/Users/itsinfra/AppData/Local/Temp/od-data}"
mkdir -p "$OD_DATA_DIR"

DAEMON_PORT="${OD_DAEMON_PORT:-7456}"
WEB_PORT="${OD_WEB_PORT:-7457}"

echo "[open-design] data dir : $OD_DATA_DIR"
echo "[open-design] daemon   : http://127.0.0.1:$DAEMON_PORT  (API)"
echo "[open-design] web UI   : http://127.0.0.1:$WEB_PORT   <-- open this"
echo "[open-design] starting daemon (first boot scans plugins/brands over SMB — ~30s)..."

# The daemon rejects cross-origin API calls unless it's told to trust the web
# origin. tools-dev does this via OD_WEB_PORT; we set it plus OD_ALLOWED_ORIGINS.
# Both the daemon AND the Next.js web (allowedDevOrigins) read OD_ALLOWED_ORIGINS.
# The tailscale funnel domain is included so the public share URL works.
export OD_WEB_PORT="$WEB_PORT"
FUNNEL_ORIGIN="https://siteagent.tailbbb0d2.ts.net:8443,https://siteagent.tailbbb0d2.ts.net"
export OD_ALLOWED_ORIGINS="http://127.0.0.1:$WEB_PORT,http://localhost:$WEB_PORT,$FUNNEL_ORIGIN"

# Point the daemon at OpenCode's REAL .exe. npm only puts an opencode.cmd wrapper
# on PATH, and Node 24 refuses to spawn .cmd files ("Could not start OpenCode").
# The real binary lives in the opencode-ai package.
OC_EXE="C:/Users/itsinfra/AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode.exe"
[ -f "$OC_EXE" ] && export OPENCODE_BIN="$OC_EXE"

# 1) Daemon (API) — run from its real folder so relative imports resolve.
( cd "$ROOT/apps/daemon" && OD_WEB_PORT="$WEB_PORT" OD_ALLOWED_ORIGINS="$OD_ALLOWED_ORIGINS" OPENCODE_BIN="$OPENCODE_BIN" node bin/od.mjs --port "$DAEMON_PORT" --no-open ) &
DAEMON_PID=$!

# Wait for the daemon health endpoint before starting the web.
i=0
until curl -s -o /dev/null "http://127.0.0.1:$DAEMON_PORT/api/health" 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 60 ] && { echo "daemon failed to start"; kill $DAEMON_PID 2>/dev/null; exit 1; }
  sleep 2
done
echo "[open-design] daemon ready. starting web UI (first compile ~60s over SMB)..."

# 2) Web UI (Next.js) — polling watcher for SMB; proxies /api to the daemon.
cd "$ROOT/apps/web"
export OD_PORT="$DAEMON_PORT" WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true
node ../../node_modules/next/dist/bin/next dev --port "$WEB_PORT" &
WEB_PID=$!

# Pre-warm the routes so the FIRST browser visit is already compiled.
# (On the SMB drive the first compile + Turbopack cache build can briefly 404
#  the "/" route; warming it here avoids that.)
(
  until curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/onboarding" 2>/dev/null; do sleep 2; done
  # Warm every route that does a server-side data fetch, so the FIRST real visit
  # never races the daemon (which would 404 or throw "Unexpected end of JSON input").
  for route in "/" "/onboarding" "/projects"; do
    curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT$route" 2>/dev/null
  done
  echo ""
  echo "======================================================================"
  echo "  ✅ OPEN DESIGN IS READY  ->  open   http://127.0.0.1:$WEB_PORT/"
  echo "======================================================================"
) &

wait $WEB_PID
