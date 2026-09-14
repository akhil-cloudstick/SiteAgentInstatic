# Publish `sheeltron` — takes the imported v5 content live.
#
#   powershell -ExecutionPolicy Bypass -File scripts\publish-sheeltron.ps1
#
# WHY: v5 imported correctly (617 style rules, id === name on all 336 class
# rules), but the `replace` cleared the published version. The CMS holds the
# right content as drafts while Cloudflare Pages still serves the broken,
# unstyled v4 build. Only a full publish bakes the pages and triggers the
# deploy that replaces it.
#
# WHAT THIS DOES: publishes every page and takes the result live on the public
# internet at https://siteagent-sheeltron.pages.dev. This is outward-facing.
#
# EXPECTED AFTER: publishedPages 11, hasPublishedVersion true, and the deployed
# stylesheet grows well past the broken 1,531 bytes — the tree-shaker keeps 564
# of 617 rules with v5 instead of the 8 it kept with v4.
#
# STILL EXPECTED TO LOOK WRONG: the article chrome and hero sections. 13 classes
# have no CSS in the bundle at all (.article-*, .page-hero*, .stats-bar,
# .btn-sm, .icon-tt, .ehf-head). The client knows; it is their v6 work.
#
# Authorised by the client in DEV-REPLY-2026-09-07-publish-go-ahead.md.

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
'=== STEP-UP (publish_site requires recent re-authentication) ==='
Invoke-Tool 'connector_step_up' @{ target='sheeltron' } 3

''
'=== PUBLISH SITE ==='
Invoke-Tool 'connector_publish_site' @{ target='sheeltron' } 4

''
'=== AFTER: publish status (expect publishedPages 11) ==='
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 5

''
'=== LIVE SITE: stylesheet size (was 1,531 bytes when broken) ==='
'Cloudflare deploy takes ~20s after publish; if this still shows the old file, wait and re-check.'
try {
  $html = Invoke-WebRequest -Uri 'https://siteagent-sheeltron.pages.dev/about-us' -UseBasicParsing -TimeoutSec 30
  $css  = [regex]::Matches($html.Content, '/_instatic/css/[^"]+\.css') | ForEach-Object { $_.Value } | Select-Object -Unique
  foreach ($c in $css) {
    $r = Invoke-WebRequest -Uri "https://siteagent-sheeltron.pages.dev$c" -UseBasicParsing -TimeoutSec 30
    "{0,-46} {1,8} bytes" -f $c, $r.RawContentLength
  }
} catch { "could not fetch live site: $($_.Exception.Message)" }
