/**
 * Self-test for R16 — what the console is told about a design studio.
 * Run: `npm run test:studio` (from Operator/). No database, no daemon, no network.
 *
 * The defect this pins down: the console decided a studio's state from
 * `isRunning`, which is true the instant `spawn()` returns and stays true for
 * the whole multi-minute boot — and in fact it rendered the CMS's state, not the
 * studio's at all, so a design-only project read "Stopped" with a "Start" button
 * forever. People were sent to reinstall something that was fine.
 *
 * Four states have to be distinguishable, because four different things are
 * true at different times and each wants a different response:
 *
 *   not-provisioned — no studio here. Nothing is wrong; do nothing.
 *   starting        — coming up. Wait, and see HOW LONG you have been waiting.
 *   ready           — usable now.
 *   failed          — it is not coming, and `why` says what happened.
 *
 * The status function reads only in-process state. That is not a performance
 * nicety: probing each project on a listing opened an owner session inside every
 * one of them, which R5 forbids and `adminAuth.selftest.mjs` guards against.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(resolve(here, rel), 'utf8');

// Importing odRuntime.mjs boots nothing — it only declares state and functions —
// but it does pull in env.mjs, which is safe to load and reads no database.
const odrt = await import('./odRuntime.mjs');

// --- a project with no studio -------------------------------------------------
//
// The most common case on this estate, and the one the old view got worst: with
// no daemon at all it still showed "Stopped" and offered to start one.
check('no port means no studio, not a stopped one',
  odrt.studioStatus('nobody', null).state, 'not-provisioned');
check('no slug is the same answer',
  odrt.studioStatus('', 4601).state, 'not-provisioned');

// --- a studio nobody has asked for yet ----------------------------------------
//
// Provisioned but never started this process lifetime. "Stopped" is the honest
// word: it is not coming up, and nothing has failed.
check('a provisioned but unstarted studio is stopped',
  odrt.studioStatus('coldone', 4601).state, 'stopped');

// --- the shape the console relies on ------------------------------------------
const shapes = ['not-provisioned', 'starting', 'ready', 'failed', 'stopped'];
const runtimeSrc = src('./odRuntime.mjs');
for (const state of shapes) {
  check(`the runtime can report "${state}"`, runtimeSrc.includes(`'${state}'`), true);
}

// --- the constraint that shapes the whole fix ---------------------------------
//
// R5: a listing must not open a session inside every project. So the status
// function is pure in-process lookups — no fetch, no probe, no await.
const fn = runtimeSrc.slice(runtimeSrc.indexOf('export function studioStatus'));
const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
check('deciding a studio status performs no I/O', /fetch\(|isPortOpen|await /.test(body), false);
check('and it is synchronous, so a listing cannot block on it',
  /export function studioStatus/.test(body) && !/export async function studioStatus/.test(body), true);

// --- the start clock ----------------------------------------------------------
//
// "Starting" is reassuring at two minutes and alarming at twenty, and the
// runtime could not tell them apart because nothing recorded when a start began.
check('a start time is recorded', runtimeSrc.includes('startedAt.set(slug, Date.now())'), true);
check('and cleared once the daemon answers', /startedAt\.delete\(slug\)/.test(runtimeSrc), true);
check('a deliberate stop clears it too, so a stopped studio is never "starting for 40m"',
  runtimeSrc.slice(runtimeSrc.indexOf('export function stop(')).includes('startedAt.delete(slug)'), true);

// --- the console ---------------------------------------------------------------
const page = readFileSync(resolve(here, '..', '..', 'ui', 'src', 'pages', 'projects.astro'), 'utf8');
check('the console reads the studio state rather than the CMS runtime',
  page.includes('t.studio') && page.includes('studioOf'), true);
check('Start is not offered to a studio that is already starting',
  /state === 'stopped' && studio\.state !== 'starting'/.test(page), true);
check('the page keeps looking while anything is starting', page.includes('anyStarting'), true);
check('a starting studio reports how long it has been starting', page.includes('forHuman'), true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall studio-status checks passed');
process.exit(0);
