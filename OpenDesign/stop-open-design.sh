#!/bin/sh
# Stop Open Design (daemon + web) started from S:.
# Kills node processes bound to the daemon/web ports.
for port in 7456 7457; do
  pid=$(netstat -ano 2>/dev/null | grep -E ":$port\b.*LISTENING" | awk '{print $NF}' | head -1)
  [ -n "$pid" ] && { echo "stopping port $port (pid $pid)"; taskkill //F //PID "$pid" >/dev/null 2>&1 || true; }
done
echo "stopped."
