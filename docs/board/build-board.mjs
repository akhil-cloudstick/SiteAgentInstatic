/**
 * Render `board.json` into a self-contained `index.html`.
 *
 * The board is read by another party over the tailnet, so the page carries no
 * scripts it does not need, no external requests, and no build step: one file,
 * openable from disk or served by any static route.
 *
 * Run from `S:\SiteAgentHub`:
 *   node docs/board/build-board.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const board = JSON.parse(readFileSync(resolve(HERE, 'board.json'), 'utf8'))

// "Awaiting owner" exists because "Blocked" was answering the wrong question.
// A board is read to find out WHOSE MOVE IT IS, and those are different answers:
// blocked means something is stuck and needs solving, while awaiting-owner means
// the work is finished here and is waiting on an action only the owner can take
// — a Cloudflare deploy, say. Reporting the second as the first makes finished
// work look like a problem; reporting it as "in progress" would be worse, since
// that hides the fact that the next move is not ours.
const STATUS_LABEL = {
  todo: 'Not started',
  doing: 'In progress',
  built: 'Built',
  'awaiting-owner': 'Awaiting owner',
  blocked: 'Blocked',
}
const VERIFY_LABEL = { pending: 'Not yet verified', pass: 'Verified', fail: 'Failed' }

function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: resolve(HERE, '../..') }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const escape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const allTasks = board.modules.flatMap((m) => m.tasks)
const allSubtasks = allTasks.flatMap((t) => t.subtasks)
const count = (items, key, value) => items.filter((i) => i[key] === value).length

const tally = (items, key, labels) =>
  Object.keys(labels)
    .map((k) => ({ k, n: count(items, key, k) }))
    .filter(({ n }) => n > 0)
    .map(({ k, n }) => `<span class="chip ${k}">${n} ${escape(labels[k].toLowerCase())}</span>`)
    .join(' ')

function subtaskRow(sub) {
  return `        <tr>
          <td class="id">${escape(sub.id)}</td>
          <td>${escape(sub.text)}</td>
          <td><span class="chip ${sub.status}">${escape(STATUS_LABEL[sub.status] ?? sub.status)}</span></td>
          <td><span class="chip v-${sub.verified}">${escape(VERIFY_LABEL[sub.verified] ?? sub.verified)}</span></td>
        </tr>`
}

function taskBlock(task) {
  const depends = task.dependsOn?.length ? `<p class="depends">Depends on ${task.dependsOn.map(escape).join(', ')}</p>` : ''
  const note = task.note ? `<p class="note">${escape(task.note)}</p>` : ''
  return `    <details class="task" ${task.status === 'doing' || task.status === 'built' ? 'open' : ''}>
      <summary>
        <span class="id">${escape(task.id)}</span>
        <span class="task-title">${escape(task.title)}</span>
        <span class="chip ${task.status}">${escape(STATUS_LABEL[task.status] ?? task.status)}</span>
        <span class="counts">${tally(task.subtasks, 'status', STATUS_LABEL)}</span>
      </summary>
      ${depends}${note}
      <table>
        <thead><tr><th>Acceptance</th><th>Pass means</th><th>Build</th><th>Acceptance run</th></tr></thead>
        <tbody>
${task.subtasks.map(subtaskRow).join('\n')}
        </tbody>
      </table>
    </details>`
}

function moduleBlock(module) {
  return `  <section class="module">
    <h2><span class="id">${escape(module.id)}</span> ${escape(module.title)}</h2>
    <p class="summary">${escape(module.summary)}</p>
    <p class="counts">${tally(module.tasks, 'status', STATUS_LABEL)}</p>
${module.tasks.map(taskBlock).join('\n')}
  </section>`
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(board.title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfaf7; --fg: #1a1a1a; --muted: #5d5d5d; --line: #e2ded6; --card: #fff;
    --todo: #8a8a8a; --doing: #c47f17; --built: #1f7a4d; --blocked: #b3261e; --pending: #6b6b6b;
    /* Finished here, waiting on a person outside this repo — not a failure, so not red. */
    --awaiting: #2f6f9f;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14161a; --fg: #f2f2f0; --muted: #a6a6a6; --line: #2c3037; --card: #1b1e24; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--fg);
         font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1040px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  h2 { font-size: 18px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .meta, .summary, .note, .depends { color: var(--muted); }
  .meta { font-size: 13px; margin: 0 0 20px; }
  .meta code { font-size: 12px; }
  .legend { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 0 0 28px; font-size: 13px; }
  .legend p { margin: 4px 0; }
  .module { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin: 0 0 18px; }
  .summary { margin: 0 0 10px; font-size: 14px; }
  .counts { margin: 0 0 12px; }
  details.task { border-top: 1px solid var(--line); padding: 10px 0 4px; }
  details.task summary { cursor: pointer; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  details.task summary::-webkit-details-marker { display: none; }
  .task-title { font-weight: 600; flex: 1 1 auto; min-width: 200px; }
  .id { font: 600 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--muted); }
  .note, .depends { font-size: 13px; margin: 8px 0 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 6px; font-size: 13.5px; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  td.id { white-space: nowrap; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600;
          border: 1px solid currentColor; white-space: nowrap; }
  .todo { color: var(--todo); } .doing { color: var(--doing); } .built { color: var(--built); } .blocked { color: var(--blocked); }
  .awaiting-owner { color: var(--awaiting); }
  .v-pending { color: var(--pending); } .v-pass { color: var(--built); } .v-fail { color: var(--blocked); }
  @media (max-width: 560px) { body { padding: 20px 14px 48px; } table { font-size: 13px; } }
</style>
</head>
<body>
<main>
  <h1>${escape(board.title)}</h1>
  <p class="meta">
    Modules are the phases of <code>${escape(board.source)}</code>, tasks are its requirements, subtasks its acceptance criteria — ids unchanged.<br>
    Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC from commit <code>${escape(commit())}</code>.
  </p>
  <div class="legend">
    <p><strong>Build</strong> is ours: ${Object.entries(STATUS_LABEL).map(([k, v]) => `<span class="chip ${k}">${escape(v)}</span>`).join(' ')}</p>
    <p><strong>Acceptance run</strong> is yours, and we never set it: ${Object.entries(VERIFY_LABEL).map(([k, v]) => `<span class="chip v-${k}">${escape(v)}</span>`).join(' ')}</p>
    <p>${escape(board.note)}</p>
    <p>Totals — tasks: ${tally(allTasks, 'status', STATUS_LABEL)} &nbsp;·&nbsp; acceptance criteria: ${tally(allSubtasks, 'status', STATUS_LABEL)}</p>
  </div>
${board.modules.map(moduleBlock).join('\n')}
</main>
</body>
</html>
`

writeFileSync(resolve(HERE, 'index.html'), html)
console.log(`board written: ${resolve(HERE, 'index.html')}`)
console.log(`modules ${board.modules.length}, tasks ${allTasks.length}, acceptance criteria ${allSubtasks.length}`)
