/**
 * MMS Connector CLI.
 *
 * Mirrors Instatic's plugin-sdk CLI in shape — raw .ts run by Bun, hand-rolled
 * argument parsing — with one deliberate difference: no `import.meta.main`
 * guard.
 *
 * On this UNC-mapped checkout Bun reports `import.meta.path` as
 * `\zaiserver\...` while `process.argv[1]` is `\ZAISERVER\...`. The comparison
 * is case-sensitive, so `import.meta.main` is ALWAYS false and a guarded
 * entrypoint exits 0 having done nothing. (Instatic's own plugin CLI has this
 * problem here too.) So `main` is exported and `src/main.ts` calls it
 * unconditionally.
 */

import { resolve } from 'node:path'
import { runDoctor, DoctorFailedError } from './env/doctor'
import { serveMcp } from './mcp/serve'

interface ParsedArgs {
  command: string
  flags: Record<string, string | boolean>
  positional: string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = rest[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }

  return { command, flags, positional }
}

const HELP = `
mms-connector — scripted migration for Instatic CMS

  doctor [--fixture <dir>]      Prove the conversion environment works
  serve  [--port N] [--host H]  Run the MCP server so a remote client can
                                drive the connector over Tailscale
  help                          Show this message

The release path is not exposed over MCP by design: it stays in the CLI behind
the approval bindings. See docs/connector/connector-mcp.html.
`.trimStart()

export async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2))

  switch (command) {
    case 'doctor': {
      const fixture =
        typeof flags.fixture === 'string'
          ? resolve(flags.fixture)
          : resolve(import.meta.dir, '../fixtures/doctor')

      console.log(`doctor: converting fixture at ${fixture}`)
      try {
        const report = await runDoctor(fixture)
        console.log(`  nodes ............ ${report.nodeCount}`)
        console.log(`  roots ............ ${report.rootIdCount}`)
        console.log(`  style rules ...... ${report.styleRuleCount}`)
        console.log(`  module ids ....... ${report.moduleIds.join(', ')}`)
        console.log(`  warnings ......... 0 unexpected`)
        console.log('\n✓ doctor passed — the conversion environment is sound')
      } catch (err) {
        if (err instanceof DoctorFailedError) {
          console.error('\n✗ doctor failed')
          console.error(`  ${err.message}`)
          console.error(`\n  report: ${JSON.stringify(err.report, null, 2)}`)
          process.exit(1)
        }
        throw err
      }
      return
    }

    case 'serve': {
      const port = typeof flags.port === 'string' ? Number(flags.port) : 8787
      const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1'
      if (!Number.isInteger(port) || port <= 0) {
        console.error(`Invalid --port: ${String(flags.port)}`)
        process.exit(1)
      }
      serveMcp({ port, host })
      // Bun.serve keeps the process alive; nothing further to await.
      return
    }

    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      return

    default:
      console.error(`Unknown command: ${command}\n`)
      console.log(HELP)
      process.exit(1)
  }
}
