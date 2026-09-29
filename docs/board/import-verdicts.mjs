/**
 * Import the checking side's acceptance verdicts into the board.
 *
 *   node docs/board/import-verdicts.mjs <VERDICTS.json>   (from S:\SiteAgentHub)
 *   node docs/board/import-verdicts.mjs <VERDICTS.json> --dry-run
 *
 * WHY THIS EXISTS.
 *
 * The board has carried a `verified` column on all 56 acceptance criteria since it
 * was generated, and `build-board.mjs` renders it as pass / fail / not-yet. What it
 * never had was an INPUT: nothing could write a verdict in, so every criterion read
 * `pending` for ever and we reported "0 of 56 verified" as though nothing had been
 * run. That was wrong, and it was wrong in the worst direction — it under-reported
 * the other side's work and hid two real failures.
 *
 * THE VERDICT COLUMN IS NOT OURS TO AUTHOR. It records what the checking side
 * found, so this reads their file and nothing else. It does not infer a verdict
 * from our own test results, and it will not accept one typed in by hand from a
 * chat message — a `verified` value we made up is worse than an empty one, because
 * it looks like evidence.
 *
 * WHAT IT REFUSES, rather than silently tolerating:
 *   - a criterion id the board does not have (a typo would otherwise vanish)
 *   - a verdict that is not exactly pass / fail / pending
 *   - a `fail` with no evidence, because a failure nobody can reproduce is not a
 *     finding yet
 * Any of those aborts the whole import and writes nothing. A half-applied verdict
 * file would leave the board describing a state that never existed.
 *
 * ACCEPTED SHAPES. Their file, whichever of these it is:
 *   { "AC-A1.1": "pass", … }
 *   { "AC-A1.1": { "verdict": "pass", "evidence": "…", "at": "…" }, … }
 *   { "verdicts": { … } }                       (wrapped)
 *   { "verdicts": [ { "id": "AC-A1.1", "verdict": "pass", … } ] }   (list)
 * Written permissively on purpose: the shape is theirs to choose, and refusing a
 * file over its envelope would be a round trip about nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [fileArg, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!fileArg) {
  console.error('Usage: node docs/board/import-verdicts.mjs <VERDICTS.json> [--dry-run]');
  process.exit(1);
}

const BOARD = resolve('docs/board/board.json');
const board = JSON.parse(readFileSync(BOARD, 'utf8'));

/** Every criterion on the board, by id. */
const criteria = new Map();
for (const mod of board.modules) {
  for (const task of mod.tasks) {
    for (const sub of task.subtasks ?? []) {
      if (sub.id) criteria.set(sub.id, { sub, task: task.id });
    }
  }
}

// --- read their file, whichever envelope it uses -----------------------------

let raw;
try {
  raw = JSON.parse(readFileSync(resolve(fileArg), 'utf8'));
} catch (err) {
  console.error(`Could not read ${fileArg}: ${err.message}`);
  process.exit(1);
}

/**
 * Their file carries judged criteria under `verdicts` and unjudged ones under a
 * sibling `notJudged` block. Reading only the first silently dropped the second,
 * which is the worst way to handle it: the board would look complete while a
 * criterion nobody had run sat there as `pending` for a different reason than the
 * file said. Both are read, and the `notJudged` entries carry their own verdict
 * so the normaliser below maps them to `pending`.
 */
const notJudgedBlock = raw.notJudged ?? raw.not_judged ?? null;
const inner = raw.verdicts ?? (notJudgedBlock ? {} : raw);
/** Normalised to a list of { id, verdict, evidence, at }. */
const incoming = [];
if (Array.isArray(inner)) {
  for (const row of inner) {
    incoming.push({
      id: String(row.id ?? row.criterion ?? ''),
      verdict: String(row.verdict ?? row.status ?? row.result ?? ''),
      evidence: row.evidence ?? row.note ?? row.detail ?? '',
      at: row.at ?? row.checkedAt ?? '',
    });
  }
} else if (inner && typeof inner === 'object') {
  for (const [id, value] of Object.entries(inner)) {
    if (typeof value === 'string') {
      incoming.push({ id, verdict: value, evidence: '', at: '' });
    } else if (value && typeof value === 'object') {
      incoming.push({
        id,
        verdict: String(value.verdict ?? value.status ?? value.result ?? ''),
        evidence: value.evidence ?? value.note ?? value.detail ?? '',
        at: value.at ?? value.checkedAt ?? '',
      });
    }
  }
} else {
  console.error('The file is neither an object nor a list of verdicts.');
  process.exit(1);
}

// The unjudged block, merged in so those criteria are recorded as `pending`
// deliberately rather than by never having been mentioned.
if (notJudgedBlock && typeof notJudgedBlock === 'object') {
  for (const [id, value] of Object.entries(notJudgedBlock)) {
    const v = value && typeof value === 'object' ? value : {};
    incoming.push({
      id,
      verdict: typeof value === 'string' ? value : String(v.verdict ?? 'notJudged'),
      evidence: v.evidence ?? v.note ?? '',
      at: v.at ?? v.checkedAt ?? '',
    });
  }
}

if (incoming.length === 0) {
  console.error('The file carried no verdicts. Nothing to import.');
  process.exit(1);
}

// --- validate the whole file BEFORE changing anything ------------------------

const ALLOWED = new Set(['pass', 'fail', 'pending']);

/**
 * Their spellings for "we have not judged this yet".
 *
 * Their file groups unjudged criteria under a `notJudged` block and asked
 * whether this importer would reject it. It would have — the verdict was not one
 * of the three — so it is mapped here instead of sending them back to reformat a
 * file that was already clear. `pending` is exactly what the board's own legend
 * calls that state ("Not yet run by the other party"), so nothing is lost.
 */
const NOT_JUDGED = new Set(['notjudged', 'not_judged', 'not judged', 'unjudged', 'none', '']);

const problems = [];
for (const row of incoming) {
  let verdict = row.verdict.trim().toLowerCase();
  if (NOT_JUDGED.has(verdict)) verdict = 'pending';
  if (!row.id) problems.push('a verdict with no criterion id');
  else if (!criteria.has(row.id)) problems.push(`unknown criterion "${row.id}" — the board has no such id`);
  if (!ALLOWED.has(verdict)) {
    problems.push(`"${row.id}" has verdict "${row.verdict}" — expected pass, fail or pending`);
  }
  // A failure with nothing attached cannot be acted on, and recording it bare
  // would make the board assert something it cannot show.
  if (verdict === 'fail' && !String(row.evidence).trim()) {
    problems.push(`"${row.id}" is a fail with no evidence — not importable`);
  }
  row.verdict = verdict;
}

if (problems.length > 0) {
  console.error(`Refusing the import — ${problems.length} problem(s), and nothing was written:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// --- apply -------------------------------------------------------------------

const changes = [];
for (const row of incoming) {
  const entry = criteria.get(row.id);
  const before = entry.sub.verified ?? 'pending';
  if (before === row.verdict) continue;
  changes.push({ id: row.id, task: entry.task, from: before, to: row.verdict });
  if (!dryRun) {
    entry.sub.verified = row.verdict;
    // Their words, kept beside the verdict, so a `fail` on the board carries the
    // reason rather than sending a reader back to the relay to find it.
    if (String(row.evidence).trim()) entry.sub.verifiedEvidence = String(row.evidence).trim();
    if (String(row.at).trim()) entry.sub.verifiedAt = String(row.at).trim();
  }
}

const counts = { pass: 0, fail: 0, pending: 0 };
for (const { sub } of criteria.values()) {
  const v = dryRun ? (sub.verified ?? 'pending') : (sub.verified ?? 'pending');
  counts[v] = (counts[v] ?? 0) + 1;
}

if (!dryRun && changes.length > 0) {
  writeFileSync(BOARD, `${JSON.stringify(board, null, 2)}\n`);
}

console.log(`${incoming.length} verdict(s) read from ${fileArg}`);
for (const c of changes) console.log(`  ${c.id} (${c.task}): ${c.from} -> ${c.to}`);
if (changes.length === 0) console.log('  (no change — the board already agreed)');
console.log(
  `\nBoard now: ${counts.pass ?? 0} passed, ${counts.fail ?? 0} failed, ${counts.pending ?? 0} not yet run` +
    ` (of ${criteria.size}).`,
);
if (dryRun) console.log('Dry run — nothing was written.');
