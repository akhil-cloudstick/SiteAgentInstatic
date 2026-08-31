/**
 * Entrypoint. Deliberately separate from cli.ts: see the note there about
 * `import.meta.main` being unreliable on this UNC checkout.
 */

import { main } from "./cli"

main().catch((err) => {
  console.error(`\u2717 ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  process.exit(1)
})
