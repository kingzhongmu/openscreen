# Build a Windows installer for OpenScreen (native helper + frontend + NSIS).
# Usage:
#   .\scripts\build-win-pack.ps1
#   .\scripts\build-win-pack.ps1 -SkipNative
#
# Requires: Node.js, cnpm/npm, Visual Studio C++ (see build-windows-wgc-helper.mjs).

param(
	[switch]$SkipNative,
	[switch]$SkipCacheCleanup
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step($Message) {
	Write-Host ""
	Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-LocalBin {
	param(
		[string]$Name,
		[string[]]$CommandArgs
	)
	$cmd = Join-Path $Root "node_modules\.bin\$Name.cmd"
	if (-not (Test-Path $cmd)) {
		$cmd = Join-Path $Root "node_modules\.bin\$Name"
	}
	if (-not (Test-Path $cmd)) {
		throw "Missing local binary: node_modules\.bin\$Name (run cnpm install first)"
	}
	& $cmd @CommandArgs
	if ($LASTEXITCODE -ne 0) {
		throw "Command failed: $Name $($CommandArgs -join ' ') (exit $LASTEXITCODE)"
	}
}

function Invoke-Node {
	param([string[]]$CommandArgs)
	& node @CommandArgs
	if ($LASTEXITCODE -ne 0) {
		throw "Command failed: node $($CommandArgs -join ' ') (exit $LASTEXITCODE)"
	}
}

function Clear-CorruptedElectronCache {
	$cacheRoot = Join-Path $env:LOCALAPPDATA "electron\Cache"
	if (-not (Test-Path $cacheRoot)) {
		return
	}

	# Incomplete downloads and wrongly placed zips break electron-builder with "not a valid zip file".
	$staleRootZip = Join-Path $cacheRoot "electron-v41.2.1-win32-x64.zip"
	if (Test-Path $staleRootZip) {
		$item = Get-Item $staleRootZip
		if ($item.Length -lt 140000000) {
			Write-Host "Removing incomplete Electron zip: $staleRootZip ($($item.Length) bytes)"
			Remove-Item $staleRootZip -Force
		}
	}

	Get-ChildItem $cacheRoot -Filter "*.part*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Step "OpenScreen Windows pack build"
Write-Host "Project: $Root"

# China-friendly mirrors (override before calling if you need HuggingFace/GitHub directly).
$env:ELECTRON_MIRROR = if ($env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR } else { "https://npmmirror.com/mirrors/electron/" }
$env:ELECTRON_BUILDER_BINARIES_MIRROR = if ($env:ELECTRON_BUILDER_BINARIES_MIRROR) { $env:ELECTRON_BUILDER_BINARIES_MIRROR } else { "https://npmmirror.com/mirrors/electron-builder-binaries/" }
$env:CAPTION_MODEL_MIRROR = if ($env:CAPTION_MODEL_MIRROR) { $env:CAPTION_MODEL_MIRROR } else { "modelscope" }

Write-Host "ELECTRON_MIRROR=$($env:ELECTRON_MIRROR)"
Write-Host "ELECTRON_BUILDER_BINARIES_MIRROR=$($env:ELECTRON_BUILDER_BINARIES_MIRROR)"
Write-Host "CAPTION_MODEL_MIRROR=$($env:CAPTION_MODEL_MIRROR)"

if (-not $SkipCacheCleanup) {
	Write-Step "Cleaning corrupted Electron cache (if any)"
	Clear-CorruptedElectronCache
}

if (-not $SkipNative) {
	Write-Step "Building native WGC helper"
	Invoke-Node @("$Root\scripts\build-windows-wgc-helper.mjs")
} else {
	Write-Host "Skipping native build (-SkipNative)"
}

Write-Step "Type-check and Vite production build"
Invoke-LocalBin "tsc" @()
Invoke-LocalBin "vite" @("build")

Write-Step "Packaging with electron-builder"
Invoke-LocalBin "electron-builder" @("--win", "--config.npmRebuild=false")

$version = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
$releaseDir = Join-Path $Root "release\$version"
Write-Step "Done"
Write-Host "Output directory: $releaseDir" -ForegroundColor Green
Get-ChildItem $releaseDir -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
	Write-Host "  Installer: $($_.FullName)" -ForegroundColor Green
}
