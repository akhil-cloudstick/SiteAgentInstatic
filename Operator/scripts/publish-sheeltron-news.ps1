# Publish the 8 news collection entries, then re-publish the site.
#
#   powershell -ExecutionPolicy Bypass -File scripts\publish-sheeltron-news.ps1
#
# ASCII only on purpose: this file is read as ANSI by powershell.exe, so a
# smart quote or an em-dash corrupts string parsing and the whole script
# fails to compile. Do not paste typographic punctuation in here.
#
# WHY - the v7 publish was incomplete and nothing said so:
#
#   publish_site published the 11 PAGES and reported publishedPages: 11.
#   It did NOT publish the 8 news collection entries, which arrived from the
#   bundle as status: draft and stayed there. The baker only writes rows that
#   are already published, so the current publish slot has no news/ directory
#   at all - the 8 article files were never written.
#
#   Confirmed on disk:  published/a/news/ = 8 files (old v5 publish)
#                       published/b/news/ = does not exist (current)
#
#   That is why a cache-busted /news/<slug> returns the homepage: the origin
#   has no such file, so it falls through to the soft-404 that serves the
#   homepage with HTTP 200. Not a caching artefact - a missing page.
#
# OUTWARD-FACING: the 8 articles become publicly visible. Publishing a row is
# not reversible to a previous version.
#
# NOTE ON THE DROPPED CONNECTION: publish_site reliably returns "The underlying
# connection was closed" on this stack while the publish itself succeeds
# (deploys 32 and 33 both went live after that error). This script catches it
# and verifies from state instead of trusting the response.

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

try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5 | Out-Null } catch {
  Write-Host 'The connector is not running on port 8787. Start npm run dev in another terminal.' -ForegroundColor Yellow
  exit 1
}

Invoke-Tool 'connector_connect' @{ target='sheeltron' } 1 | Out-Null

# Row ids read from the database rather than listed at runtime, so a listing
# failure cannot silently turn this into a no-op the way it did on the first run.
$news = [ordered]@{
  'ai-buildout'                = 'bQ_OBwXCVm82NserLcvvO'
  'ait-cricket-2026'           = 'Igedkgvn9hS8TbpT1JYLL'
  'amd-apj-summit'             = 'VH9Z9-gEzgATho2le1bMt'
  'cooling-investment'         = 'ap7R1DMfunDe90lvhhQTW'
  'iris-deal'                  = 'bU8RC62KdSV4-p2BtN05g'
  'nvidia-partnership'         = 'mUdo_2Wf-391M50x1Ah3z'
  'team-outing'                = 'cSOYdndqBJyANDtFZS79m'
  'world-environment-day-2026' = 'o1WNPQTUuTu8PtK6wbGWu'
}

'=== publishing the 8 news entries ==='
$i = 10
foreach ($slug in $news.Keys) {
  $i++
  try {
    $res = Invoke-Tool 'connector_publish_row' @{ target='sheeltron'; rowId=$news[$slug] } $i
    "  {0,-30} {1}" -f $slug, (($res -replace '\s+',' ').Trim())
  } catch {
    "  {0,-30} ERROR: {1}" -f $slug, $_.Exception.Message
  }
}

''
'=== full publish so the entries are baked and deployed ==='
Invoke-Tool 'connector_step_up' @{ target='sheeltron' } 90 | Out-Null
try {
  Invoke-Tool 'connector_publish_site' @{ target='sheeltron' } 91
} catch {
  '  (connection dropped as usual; verifying from state rather than the response)'
}

''
'=== publish status ==='
Invoke-Tool 'connector_publish_status' @{ target='sheeltron' } 92

''
'=== ORIGIN: baked article files on disk (the check no CDN can distort) ==='
$slotRoot = 'S:\SiteAgentHub\Operator\tenant-users\sheeltron\uploads\published'
foreach ($slot in @('a','b')) {
  $p = Join-Path $slotRoot (Join-Path $slot 'news')
  if (Test-Path $p) {
    $files = @(Get-ChildItem $p -Filter *.html)
    $mod = (Get-Item (Join-Path $slotRoot $slot)).LastWriteTime
    "  slot {0} : {1} baked article file(s)   modified {2}" -f $slot, $files.Count, $mod
    if ($files.Count -gt 0) {
      $one = Get-Content $files[0].FullName -Raw
      $esc = ([regex]::Matches($one, [char]38 + 'lt;')).Count
      "           {0} -> {1} escaped fragment(s)  (expect 0)" -f $files[0].Name, $esc
    }
  } else {
    "  slot {0} : no news/ directory" -f $slot
  }
}

''
'=== waiting 75s for the Cloudflare deploy ==='
Start-Sleep -Seconds 75

'=== live check (NO query string; a query string falls through to the homepage) ==='
foreach ($slug in @('ai-buildout','team-outing','iris-deal')) {
  try {
    $a = Invoke-WebRequest -Uri "https://siteagent-sheeltron.pages.dev/news/$slug" -UseBasicParsing -TimeoutSec 30
    $t = [regex]::Match($a.Content, '<title>(.*?)</title>').Groups[1].Value
    $esc = ([regex]::Matches($a.Content, [char]38 + 'lt;')).Count
    "  /news/{0,-28} esc {1,3}  cache {2}  age {3}" -f $slug, $esc, $a.Headers['cf-cache-status'], $a.Headers['age']
    "      $t"
  } catch {
    "  /news/{0} failed: {1}" -f $slug, $_.Exception.Message
  }
}
