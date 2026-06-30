// dev.mjs — starts all SiteAgent services with one command: node dev.mjs
import { spawn } from 'node:child_process';

const CYAN   = '\x1b[36m';
const MAGENTA= '\x1b[35m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';

const services = [
  { label: 'control-plane', color: CYAN,    cmd: 'node operator/control-plane/server.mjs' },
  { label: 'console-ui   ', color: MAGENTA, cmd: 'npm --prefix operator/ui run dev' },
  { label: 'board        ', color: YELLOW,  cmd: 'node .serve/server.cjs' },
];

console.log(`\n${DIM}Starting SiteAgent dev services...${RESET}\n`);

const procs = services.map(({ label, color, cmd }) => {
  const prefix = `${color}[${label}]${RESET} `;
  const proc = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

  const print = (chunk) =>
    chunk.toString().split('\n').filter(l => l.trim()).forEach(l => process.stdout.write(prefix + l + '\n'));

  proc.stdout.on('data', print);
  proc.stderr.on('data', print);
  proc.on('exit', code => process.stdout.write(`${prefix}${DIM}exited (${code})${RESET}\n`));

  return proc;
});

process.on('SIGINT', () => {
  console.log('\nShutting down all services...');
  procs.forEach(p => { try { p.kill('SIGTERM'); } catch {} });
  process.exit(0);
});
