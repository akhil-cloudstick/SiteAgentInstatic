#!/usr/bin/env node
// Renders the v2 markdown references into standalone HTML pages that reuse the
// house template already used by the other pages in this folder.
//
//   node docs/connector/build-v2-html.mjs
//
// The markdown is the source of truth. Edit the .md, re-run this, never hand-edit
// the .html. The converter handles only the subset of markdown these two documents
// use — headings, tables, fenced code, blockquotes, lists, hr, and inline
// code/bold/links. It is deliberately not a general markdown implementation.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const DOCS = [
  {
    md: 'connector-guide-v2.md',
    html: 'connector-guide-v2.html',
    title: 'MMS Connector',
    eyebrow: 'Reference',
    standfirst:
      'A Model Context Protocol server for whole-site work: import a bundle, replace a site, export a snapshot, provision a new instance, publish everything.',
    meta: [
      ['endpoint', '/connector-mcp'],
      ['tools', '34'],
      ['auth', 'One bearer token'],
      ['scopes', 'None — full access'],
    ],
  },
  {
    md: 'mms-mcp-v2.md',
    html: 'mms-mcp-v2.html',
    title: 'MMS MCP',
    eyebrow: 'Reference',
    standfirst:
      'A scoped, revocable Model Context Protocol key for one site, with ten granular permissions — the credential to hand to an agent doing day-to-day content work.',
    meta: [
      ['endpoint', '/mcp/&lt;site-slug&gt;'],
      ['tools', '29'],
      ['auth', 'Per-site key'],
      ['scopes', '10 permissions · 4 presets'],
    ],
  },
]

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline: `code`, **bold**, *em*, [text](href). Escaping happens per-segment so
// that code spans keep their angle brackets literal without double-escaping.
function inline(src) {
  const parts = []
  const re = /`([^`]+)`/g
  let last = 0
  let m
  while ((m = re.exec(src))) {
    parts.push({ code: false, text: src.slice(last, m.index) })
    parts.push({ code: true, text: m[1] })
    last = m.index + m[0].length
  }
  parts.push({ code: false, text: src.slice(last) })

  return parts
    .map((p) => {
      if (p.code) return `<code>${esc(p.text)}</code>`
      let t = esc(p.text)
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      return t
    })
    .join('')
}

// A markdown table row -> cells, tolerating the leading/trailing pipe.
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

function convert(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let i = 0
  let sectionOpen = false
  let footer = ''

  const closeSection = () => {
    if (sectionOpen) {
      out.push('  </section>')
      sectionOpen = false
    }
  }

  // Skip the H1 and the metadata line under it — those become the masthead.
  while (i < lines.length && !/^##\s/.test(lines[i])) {
    const line = lines[i]
    // A leading blockquote before the first section is the "which product" note.
    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(
        `  <div class="note cool"><p class="lede">${inline(quote.join(' ').trim())}</p></div>`
      )
      continue
    }
    i++
  }

  for (; i < lines.length; i++) {
    const line = lines[i]

    if (/^##\s/.test(line)) {
      closeSection()
      const raw = line.replace(/^##\s+/, '')
      const num = raw.match(/^(\d+)\.\s*/)
      const heading = raw.replace(/^\d+\.\s*/, '')
      const label = num ? String(num[1]).padStart(2, '0') : '··'
      out.push('  <section>')
      out.push(
        `    <div class="sec-head"><span class="sec-num">${label}</span><h2>${inline(heading)}</h2></div>`
      )
      sectionOpen = true
      continue
    }

    if (/^###\s/.test(line)) {
      out.push(`    <h3>${inline(line.replace(/^###\s+/, ''))}</h3>`)
      continue
    }

    if (/^```/.test(line)) {
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      const body = buf
        .map((l) =>
          esc(l).replace(/^(\s*)(#|\/\/)(.*)$/, '$1<span class="c">$2$3</span>')
        )
        .join('\n')
      out.push(`    <pre>${body}</pre>`)
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      i--
      out.push(
        `    <div class="note hot"><p class="lede">${inline(quote.join(' ').trim())}</p></div>`
      )
      continue
    }

    // Table: a header row followed by a --- separator row.
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(cells(lines[i]))
        i++
      }
      i--
      const th = head.map((c) => `<th>${inline(c)}</th>`).join('')
      const tb = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('\n          ')
      out.push('    <div class="tbl-wrap">')
      out.push(`      <table>`)
      out.push(`        <thead><tr>${th}</tr></thead>`)
      out.push(`        <tbody>\n          ${tb}\n        </tbody>`)
      out.push('      </table>')
      out.push('    </div>')
      continue
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items = []
      while (
        i < lines.length &&
        (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))
      ) {
        if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ' ' + lines[i].trim()
        } else {
          items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))
        }
        i++
      }
      i--
      const tag = ordered ? 'ol' : 'ul'
      const cls = ordered ? ' class="checks"' : ''
      out.push(`    <${tag}${cls}>`)
      for (const it of items) out.push(`      <li>${inline(it)}</li>`)
      out.push(`    </${tag}>`)
      continue
    }

    if (/^---+\s*$/.test(line)) continue
    if (!line.trim()) continue

    // A lone italic line at the very end is the footer strap.
    if (/^\*[^*].*\*$/.test(line.trim()) && i > lines.length - 6) {
      footer = inline(line.trim().replace(/^\*|\*$/g, ''))
      continue
    }

    out.push(`    <p>${inline(line)}</p>`)
  }

  closeSection()
  return { body: out.join('\n'), footer }
}

// Lift the house stylesheet verbatim, delimiter to delimiter. Index-based rather
// than line-numbered so an edit to the source page cannot silently truncate it.
const template = readFileSync(join(HERE, 'connector-plan.html'), 'utf8')
const styleStart = template.indexOf('<style>')
const styleEnd = template.indexOf('</style>')
if (styleStart < 0 || styleEnd < 0) throw new Error('template stylesheet not found')
const style = template.slice(styleStart, styleEnd + '</style>'.length)

for (const doc of DOCS) {
  const md = readFileSync(join(HERE, doc.md), 'utf8')
  const { body, footer } = convert(md)
  const meta = doc.meta
    .map(([k, v]) => `      <span data-k="${k}"><b>${v}</b></span>`)
    .join('\n')

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.title}</title>

${style}
</head>
<body>

<div class="wrap">

  <header class="masthead">
    <p class="eyebrow">${doc.eyebrow}</p>
    <h1>${doc.title}</h1>
    <p class="standfirst">${doc.standfirst}</p>
    <div class="meta">
${meta}
    </div>
  </header>

${body}

  <footer>
    ${footer || doc.standfirst}
  </footer>

</div>
</body>
</html>
`
  writeFileSync(join(HERE, doc.html), page, 'utf8')
  console.log(`wrote ${doc.html}  (${page.length.toLocaleString()} bytes)`)
}
