# Import sheeltron-bundle-v5.json into the `sheeltron` tenant.
#
#   powershell -ExecutionPolicy Bypass -File scripts\import-sheeltron-v5.ps1
#
# WHY v5: v4 published UNSTYLED. The bundle minted synthetic style-rule ids while
# `node.classIds` carries bare class names, and the publisher's tree-shaker keeps
# a rule only when `usedIds.has(rule.id)` — so 609 of 617 rules were shaken out
# as unused. v5 sets `id = name` for class rules.
#
# VERIFIED against our real tree-shaker before authorising:
#     v4  ->    8 of 617 rules survive
#     v5  ->  564 of 617 rules survive   (305 class + 259 ambient)
#
# KNOWN REMAINING GAP (present in v4 too, not a v5 regression): 13 classes have
# no CSS anywhere in the bundle — .article-page/-body/-hero/-lede/-back,
# .page-hero*, .stats-bar, .ehf-head, .btn-sm, .icon-tt. ~44 nodes across 9
# pages will still render unstyled. Reported to the client separately.
#
# THIS PUBLISHES NOTHING. All 19 rows arrive as drafts. Note the live site is
# currently published and unstyled, so a `publish_site` is needed AFTER this
# import to actually fix what visitors see — that is a separate authorisation.
#
# Authorised by the client in DEV-REPORT-2026-09-07-published-unstyled.md §3.

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

try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5 } catch {
  Write-Host ''
  Write-Host 'The connector is not running on port 8787.' -ForegroundColor Yellow
  Write-Host 'Start it in a SEPARATE terminal and leave it open:'
  Write-Host '    cd s:\SiteAgentHub\Operator'
  Write-Host '    npm run dev'
  Write-Host 'Wait for:  mms-connector MCP listening on http://127.0.0.1:8787'
  Write-Host ''
  exit 1
}
if (-not $health.ok) { Write-Error 'Connector responded but is not healthy.'; exit 1 }

'=== BEFORE ==='
Invoke-Tool 'connector_connect' @{ target='sheeltron' } 1 | Out-Null
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 2

''
'=== STEP-UP (required for a clean-site import) ==='
Invoke-Tool 'connector_step_up' @{ target='sheeltron' } 3

''
'=== IMPORT (replace) ==='
Invoke-Tool 'connector_import_replace' @{
  target   = 'sheeltron'
  uploadId = 'upload-a3078898c6b127ba.json'
  confirm  = 'REPLACE sheeltron'
} 4

''
'=== AFTER: entry templates (MUST be count 1) ==='
Invoke-Tool 'connector_list_templates' @{ target='sheeltron' } 5

''
'=== AFTER: publish status ==='
'NOTE: the live site stays unstyled until a separate publish_site runs.'
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 6
