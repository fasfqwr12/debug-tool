$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$fontsDir = Join-Path $root 'fonts'
New-Item -ItemType Directory -Force -Path $fontsDir | Out-Null

$files = @(
  @{ name = 'SourceHanSansSC-VF.otf.woff2'; urls = @(
      'https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/Variable/WOFF2/OTF/SourceHanSansSC-VF.otf.woff2',
      'https://ghproxy.com/https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/Variable/WOFF2/OTF/SourceHanSansSC-VF.otf.woff2',
      'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/Variable/WOFF2/OTF/SourceHanSansSC-VF.otf.woff2'
    )
  }
)

function Download-HarmonyOSSans {
  param(
    [Parameter(Mandatory=$true)][string]$FontsDir
  )

  $zipUrl = 'https://developer.huawei.com/images/download/general/HarmonyOS-Sans.zip'
  $zipOut = Join-Path $FontsDir 'HarmonyOS-Sans.zip'
  $tmp = Join-Path $env:TEMP ('HarmonyOS-Sans_' + [guid]::NewGuid().ToString('N'))

  Write-Host "Downloading HarmonyOS Sans (fallback) ..."
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipOut
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Expand-Archive -Path $zipOut -DestinationPath $tmp -Force

  $candidates = Get-ChildItem -Path $tmp -Recurse -File -Include *.ttf,*.otf -ErrorAction SilentlyContinue
  if (-not $candidates -or $candidates.Count -eq 0) {
    throw "HarmonyOS-Sans.zip extracted but no .ttf/.otf found."
  }

  $pick = $candidates | Where-Object { $_.Name -match 'SC' -and $_.Name -match 'VF|Variable' } | Select-Object -First 1
  if (-not $pick) { $pick = $candidates | Where-Object { $_.Name -match 'SC' -and $_.Name -match 'Regular' } | Select-Object -First 1 }
  if (-not $pick) { $pick = $candidates | Where-Object { $_.Name -match 'SC' } | Select-Object -First 1 }
  if (-not $pick) { $pick = $candidates | Select-Object -First 1 }

  $ext = [System.IO.Path]::GetExtension($pick.Name).ToLower()
  if ($ext -eq '.ttf') {
    $dst = Join-Path $FontsDir 'HarmonyOSSansSC.ttf'
  } else {
    $dst = Join-Path $FontsDir 'HarmonyOSSansSC.otf'
  }
  Copy-Item -Force -Path $pick.FullName -Destination $dst

  $size = (Get-Item $dst).Length
  Write-Host "Saved: $dst ($size bytes)"
}

foreach ($f in $files) {
  $out = Join-Path $fontsDir $f.name
  Write-Host "Downloading $($f.name) ..."
  $ok = $false
  foreach ($u in $f.urls) {
    try {
      Write-Host "  Try: $u"
      Invoke-WebRequest -Uri $u -OutFile $out
      $size = (Get-Item $out).Length
      Write-Host "Saved: $out ($size bytes)"
      $ok = $true
      break
    } catch {
      Write-Host "  Failed: $u"
    }
  }
  if (-not $ok) {
    Write-Host "All download URLs failed for $($f.name). Will try HarmonyOS Sans as fallback."
    try {
      Download-HarmonyOSSans -FontsDir $fontsDir
    } catch {
      throw "All download URLs failed for $($f.name), and HarmonyOS Sans fallback also failed."
    }
  }
}

Write-Host "Done."
