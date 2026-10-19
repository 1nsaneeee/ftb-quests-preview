[CmdletBinding()]
param(
    [string]$InstallPrefix = "",
    [string]$SkillDir = "",
    [switch]$NoPath,
    [switch]$NoSkill
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js 20 or newer was not found. Install it from https://nodejs.org/en/download and rerun."
}
$nodeVersion = (& node --version).Trim()
$nodeMajor = 0
[void][int]::TryParse((($nodeVersion.TrimStart("v")).Split(".")[0]), [ref]$nodeMajor)
if ($nodeMajor -lt 20) {
    throw "Node.js 20 or newer is required; detected $nodeVersion."
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    throw "npm was not found next to Node.js. Reinstall Node.js and rerun."
}

Write-Step "Resolving install prefix"
if ([string]::IsNullOrWhiteSpace($InstallPrefix)) {
    $InstallPrefix = (& npm prefix -g).Trim()
}
if ([string]::IsNullOrWhiteSpace($InstallPrefix)) {
    throw "Could not determine the npm global prefix. Pass -InstallPrefix explicitly."
}
$InstallPrefix = [System.IO.Path]::GetFullPath($InstallPrefix)
if ($InstallPrefix -match "[()]") {
    throw "The install prefix contains '(' or ')': $InstallPrefix. Windows npm shims do not handle those paths. Choose a prefix without parentheses, for example: `$env:LOCALAPPDATA\ftbquests"
}
Write-Host "Install prefix: $InstallPrefix"

Write-Step "Packing ftb-quests-preview"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ftbquest-pack-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
try {
    & npm pack --pack-destination $tempDir $root
    if ($LASTEXITCODE -ne 0) {
        throw "npm pack failed."
    }
    $tarball = Get-ChildItem -Path $tempDir -Filter "*.tgz" | Select-Object -First 1
    if (-not $tarball) {
        throw "npm pack did not produce a tarball."
    }

    Write-Step "Installing package"
    & npm uninstall --global --prefix $InstallPrefix ftb-quests-preview 2>$null
    & npm install --global --prefix $InstallPrefix $tarball.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed. If this is a permissions problem, rerun with: .\install.ps1 -InstallPrefix `"$env:LOCALAPPDATA\ftbquests`" -NoPath"
    }
} finally {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

$binDir = $InstallPrefix
$commandPath = Join-Path $binDir "ftbquest.cmd"
if (-not (Test-Path $commandPath)) {
    $unixBin = Join-Path $InstallPrefix "bin"
    if (Test-Path (Join-Path $unixBin "ftbquest.cmd")) {
        $binDir = $unixBin
        $commandPath = Join-Path $binDir "ftbquest.cmd"
    }
}
if (-not (Test-Path $commandPath)) {
    throw "npm reported success, but $commandPath was not created."
}

if (-not $NoPath) {
    Write-Step "Checking user PATH"
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }
    $segments = @($userPath -split ";" | Where-Object { $_ -and $_.Trim() })
    $currentSegments = @($env:PATH -split ";" | Where-Object { $_ -and $_.Trim() })
    $already = @($segments + $currentSegments) | Where-Object { $_.TrimEnd("\") -ieq $binDir.TrimEnd("\") } | Select-Object -First 1
    if ($already) {
        Write-Host "PATH already contains: $binDir"
    } else {
        $newPath = if ($userPath.Trim()) { $userPath.TrimEnd(";") + ";" + $binDir } else { $binDir }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "Added to user PATH: $binDir"
        Write-Host "Open a new terminal for the change to take effect."
    }
} else {
    Write-Host ""
    Write-Host "Skipped PATH changes (-NoPath). Use: $commandPath"
}

if (-not $NoSkill) {
    Write-Step "Installing agent skill"
    if ([string]::IsNullOrWhiteSpace($SkillDir)) {
        $agentsSkills = Join-Path $HOME ".agents\skills"
        $dshSkills = Join-Path $HOME ".dsh\skills"
        if (Test-Path (Split-Path -Parent $agentsSkills)) {
            $SkillDir = $agentsSkills
        } elseif (Test-Path (Split-Path -Parent $dshSkills)) {
            $SkillDir = $dshSkills
        } else {
            $SkillDir = $agentsSkills
        }
    }
    $source = Join-Path $root "skills\ftbquests"
    if (-not (Test-Path $source)) {
        throw "Skill files were not found at $source."
    }
    $target = Join-Path $SkillDir "ftbquests"
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
    Write-Host "Skill installed to: $target"
} else {
    Write-Host ""
    Write-Host "Skipped skill install (-NoSkill)."
}

Write-Step "Installed"
$version = (& $commandPath --version 2>&1).Trim()
Write-Host "Command: $commandPath"
Write-Host "Version: $version"
Write-Host "Try: ftbquest skill"
Write-Host "Browser: ftbquest-preview --instance-root `"PATH\TO\.minecraft`""
if (-not $NoPath) {
    Write-Host "If 'ftbquest' is still not found, open a new terminal."
}
