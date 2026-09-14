# Ship sheeltron-bundle-v7: preview -> import -> publish, in one run.
#
#   powershell -ExecutionPolicy Bypass -File scripts\ship-sheeltron-v7.ps1
#
# All three steps are authorised together in DEV-REPLY-2026-09-08-v7-go.md:
# "Preview it, import it, publish it. You do not need to come back between them."
#
# WHAT v7 FIXES (verified against our tree-shaker before staging):
#   v4    8 of 617 rules survive   -> site published with no design
#   v5  564 of 617                 -> design back, 8 sections invisible, articles show markup
#   v7  600 of 666                 -> linked stylesheets ingested, js-gated rules dropped,
#                                     entry bodies dedented so Markdown stops escaping them
#
# EXPECTED, so a difference is a finding rather than a surprise:
#   - preview: pages 11 add, news 8 add, 19 rows, unknownFields []
#   - preview: unresolvedClasses reports ~10 classes incl. .reveal x6 — ADVISORY, not a fault.
#     These are the 11 js-gated rules the client dropped on purpose; shipping them would leave
#     the nodes permanently invisible, which is worse than unstyled.
#   - import: rowsInserted 19, and publishedPages drops to 0. Expected — a replace clears the
#     published version. The publish step below puts it back.
#   - publish: publishedPages 11, then a Cloudflare deploy ~45s later.
#
# STILL EXPECTED TO LOOK WRONG AFTERWARDS: .icon-tt and .ehf-head are unstyled. They are dead
# classes on the live sheeltron.com too, so they render here exactly as they render there.

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
  Write-Host ''
  exit 1
}

'=== BEFORE ==='
Invoke-Tool 'connector_connect' @{ target='sheeltron' } 1 | Out-Null
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 2

''
'=== STEP 1 of 3: PREVIEW (writes nothing) ==='
Invoke-Tool 'connector_preview_import' @{
  target   = 'sheeltron'
  uploadId = 'upload-6b3ff1405ff1767d.json'
  strategy = 'replace'
} 3

''
'=== STEP-UP (required for import and for publish) ==='
Invoke-Tool 'connector_step_up' @{ target='sheeltron' } 4

''
'=== STEP 2 of 3: IMPORT (replace) ==='
# No `strategy` argument: connector_import_replace does not take one and hardcodes
# replace internally. `confirm` is required and names the target.
Invoke-Tool 'connector_import_replace' @{
  target   = 'sheeltron'
  uploadId = 'upload-6b3ff1405ff1767d.json'
  confirm  = 'REPLACE sheeltron'
} 5

''
'=== STEP 3 of 3: PUBLISH SITE ==='
# Step up again: the import consumed the elevated window, and publish_site needs its own.
Invoke-Tool 'connector_step_up' @{ target='sheeltron' } 6
Invoke-Tool 'connector_publish_site' @{ target='sheeltron' } 7

''
'=== AFTER: publish status (expect publishedPages 11) ==='
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 8

''
'=== AFTER: entry templates (expect count 1) ==='
Invoke-Tool 'connector_list_templates' @{ target='sheeltron' } 9

''
'=== LIVE SITE (Cloudflare deploy takes ~45s; re-run the check below if unchanged) ==='
'was: style-0ba723028d39.css  161,177 bytes  (v5)'
Start-Sleep -Seconds 60
try {
  $html = Invoke-WebRequest -Uri 'https://siteagent-sheeltron.pages.dev/about-us' -UseBasicParsing -TimeoutSec 30
  $css  = [regex]::Matches($html.Content, '/_instatic/css/[^"]+\.css') | ForEach-Object { $_.Value } | Select-Object -Unique
  foreach ($c in $css) {
    $r = Invoke-WebRequest -Uri "https://siteagent-sheeltron.pages.dev$c" -UseBasicParsing -TimeoutSec 30
    "{0,-46} {1,8} bytes" -f $c, $r.RawContentLength
  }
  # The defect the client caught by screenshot: escaped markup rendered as visible text.
  $art = Invoke-WebRequest -Uri 'https://siteagent-sheeltron.pages.dev/news/iris-deal' -UseBasicParsing -TimeoutSec 30
  $esc = ([regex]::Matches($art.Content, '&lt;(p|strong|em|li|ul|h[1-6])&gt;')).Count
  ''
  "article /news/iris-deal : {0} escaped markup fragment(s)  (expect 0)" -f $esc
} catch { "live check failed: $($_.Exception.Message)" }
