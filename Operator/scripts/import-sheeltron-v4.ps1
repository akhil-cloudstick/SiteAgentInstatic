# Import sheeltron-bundle-v4.json into the `sheeltron` tenant.
#
#   powershell -ExecutionPolicy Bypass -File scripts\import-sheeltron-v4.ps1
#
# WHAT THIS DOES, EXACTLY:
#   Deletes all 19 rows currently on `sheeltron` (the v3 import), then inserts
#   19 from v4. NOT REVERSIBLE.
#
#   Verified before authorising: v4 differs from v3 in the `body` cell of all 19
#   rows and NOTHING else — same row set, same row IDs, same slugs. Every one of
#   the 18 served URLs is re-created. The change is 479 internal references
#   rewritten from build-time filenames (contact.html) to CMS routes (/contact).
#
# WHAT IT DOES NOT DO:
#   It does not publish. All 19 rows arrive as drafts, sheeltron.com untouched.
#
# NOTE ON `strategy`: the client's note asks for strategy:"replace" to be passed
# explicitly. connector_import_replace has no such parameter and the connector
# does not validate arguments against the schema, so passing it would be
# silently ignored rather than honoured. It is omitted here because the tool
# hardcodes 'replace' internally for both the dry run and the import — it never
# consults the default, which is what the client actually wanted assurance of.
#
# Authorised by the client in DEV-GO-2026-09-07-import-v4.md.

$ErrorActionPreference = 'Stop'

$tok = [Environment]::GetEnvironmentVariable('MMS_CONNECTOR_MCP_TOKEN','User')
if (-not $tok) { Write-Error 'MMS_CONNECTOR_MCP_TOKEN is not set at user level.'; exit 1 }
$h = @{ Authorization = "Bearer $tok"; Accept = 'application/json, text/event-stream' }

function Invoke-Tool($name, $arguments, $id) {
  $body = @{ jsonrpc='2.0'; id=$id; method='tools/call'; params=@{ name=$name; arguments=$arguments } } | ConvertTo-Json -Depth 8
  $raw  = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/mcp' -Method Post -Body $body -ContentType 'application/json' -Headers $h
  $line = ($raw -split "`n") | Where-Object { $_.StartsWith('data: ') } | Select-Object -First 1
  return (($line.Substring(6)) | ConvertFrom-Json).result.content[0].text
}

# Pre-flight. A raw "Unable to connect" from inside a helper reads as a broken
# script; it usually just means the dev stack is not running.
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
} catch {
  Write-Host ''
  Write-Host 'The connector is not running on port 8787.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Start the stack first, in a SEPARATE terminal, and leave it open:'
  Write-Host '    cd s:\SiteAgentHub\Operator'
  Write-Host '    npm run dev'
  Write-Host ''
  Write-Host 'Wait for:  mms-connector MCP listening on http://127.0.0.1:8787'
  Write-Host 'Then run this script again from a second terminal.'
  Write-Host ''
  exit 1
}
if (-not $health.ok) { Write-Error 'Connector responded but is not healthy.'; exit 1 }

'=== BEFORE ==='
Invoke-Tool 'connector_connect' @{ target='sheeltron' } 1 | Out-Null
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 2

''
# A clean-site import is gated behind step-up re-authentication on top of the
# ordinary session. Without it the import returns 401 step_up_required and
# changes nothing — the gate working, not a failure. The credential comes from
# server configuration; nothing secret passes through this script.
'=== STEP-UP (required for a clean-site import) ==='
Invoke-Tool 'connector_step_up' @{ target='sheeltron' } 3

''
'=== IMPORT (replace) ==='
Invoke-Tool 'connector_import_replace' @{
  target   = 'sheeltron'
  uploadId = 'upload-540b109c230965e8.json'
  confirm  = 'REPLACE sheeltron'
} 4

''
'=== AFTER: publish status (publishedPages MUST still be 0) ==='
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 5

''
'=== AFTER: entry templates (MUST be count 1) ==='
Invoke-Tool 'connector_list_templates' @{ target='sheeltron' } 6
