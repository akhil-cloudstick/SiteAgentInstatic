// Turnkey public gateway: open the single Tailscale funnel port AFTER the gated
// control-plane is listening, and close it on shutdown. Doing it here (not by
// hand) means one `npm run dev` brings the whole gated flow live, and the funnel
// never points at a not-yet-gated server. Best-effort: any tailscale failure is
// logged and ignored — it must never take the control-plane down.
import { spawn } from 'node:child_process';
import config from '../lib/env.mjs';

const isWin = process.platform === 'win32';

function run(args) {
  return new Promise((resolve) => {
    const child = spawn('tailscale', args, { shell: isWin, windowsHide: true });
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
    child.on('error', (err) => resolve({ code: -1, out: String(err?.message ?? err) }));
  });
}

export async function openFunnel() {
  if (!config.gatewayFunnelEnabled) {
    console.log('[gateway] funnel auto-open disabled (GATEWAY_FUNNEL=0)');
    return;
  }
  const target = `http://127.0.0.1:${config.controlPlanePort}`;
  const { code, out } = await run(['funnel', '--bg', `--https=${config.gatewayPort}`, target]);
  if (code === 0) {
    console.log(`[gateway] funnel LIVE: ${config.gatewayOrigin} -> ${target}`);
  } else {
    console.error(`[gateway] funnel open failed (code ${code}): ${out.trim().slice(0, 300)}`);
    console.error(`[gateway] open it manually: tailscale funnel --bg --https=${config.gatewayPort} ${target}`);
  }
}

export async function closeFunnel() {
  if (!config.gatewayFunnelEnabled) return;
  await run(['funnel', `--https=${config.gatewayPort}`, 'off']);
}
