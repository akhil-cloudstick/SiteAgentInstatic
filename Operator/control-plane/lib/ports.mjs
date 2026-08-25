// Loopback port probes. A backend is "up" when its PORT ACCEPTS A CONNECTION —
// which is the only thing the gateway actually needs to know before it dials.
//
// Why a raw TCP probe rather than an HTTP health call: the gateway asks this on
// the request path, and it must be able to tell "nothing is listening" (the
// ECONNREFUSED that used to leak to the browser) from "listening but still
// warming up" without paying for a request/response round trip.
import net from 'node:net';

// True if 127.0.0.1:<port> accepts a TCP connection right now.
export function isPortOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    if (!port) { resolve(false); return; }
    const sock = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

// Poll until the port opens, or the deadline passes. Used to wait out a boot.
export async function waitPortOpen(port, timeoutMs, intervalMs = 800) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isPortOpen(port)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
