[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string]$FoundryModulesPath,
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
    [string]$Version = '0.1.0'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$moduleName = 'foundryshop'
$modules = Get-Item -LiteralPath $FoundryModulesPath
if (-not $modules.PSIsContainer -or $modules.Name -ne 'modules') {
    throw 'Specify the existing Foundry Data\modules directory.'
}
$target = Join-Path $modules.FullName $moduleName
if (Test-Path -LiteralPath $target) {
    $existing = Get-Item -LiteralPath $target
    if ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw 'Deployment to a symlink or junction is not supported.'
    }
    $existingManifest = Get-Content -LiteralPath (Join-Path $target 'module.json') -Raw | ConvertFrom-Json
    if ($existingManifest.id -ne $moduleName) {
        throw 'The destination does not contain the expected module.'
    }
}

if (-not $PSCmdlet.ShouldProcess($target, "Back up existing installation and deploy local version $Version")) {
    return
}
& (Join-Path $PSScriptRoot 'build.ps1') -Version $Version
$source = Join-Path $root "dist\$moduleName"
Write-Warning 'Do not reload or interact with the module until deployment completes; files are briefly unavailable during replacement.'
$backup = $null
if (Test-Path -LiteralPath $target) {
    $backupRoot = Join-Path $modules.Parent.FullName 'module-backups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backup = Join-Path $backupRoot "$moduleName-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N'))"
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Previous installation backed up at: $backup"
}
try {
    Copy-Item -LiteralPath $source -Destination $target -Recurse
} catch {
    # Preserve the partial copy rather than deleting files during rollback.
    if (Test-Path -LiteralPath $target) {
        $failed = Join-Path $modules.Parent.FullName "$moduleName-failed-$([guid]::NewGuid().ToString('N'))"
        Move-Item -LiteralPath $target -Destination $failed
        Write-Warning "Partial deployment preserved at: $failed"
    }
    if ($backup) {
        Move-Item -LiteralPath $backup -Destination $target
    }
    throw
}
Write-Host "Deployed $Version to $target"
if (Test-Path -LiteralPath (Join-Path $modules.FullName 'boneyard-drawing-tools')) {
    Write-Warning 'Boneyard Drawing Tools is also installed. Disable it in worlds that use Foundryshop; both add drawing controls and the same default Ctrl+D shortcut.'
}
Write-Host 'Fully reload each browser client to load the updated JavaScript, CSS, and templates.'
Write-Host 'Manifest or server-loaded resource changes may require a world relaunch or server restart.'
Write-Host 'The displayed module version may remain cached until Foundry reloads package metadata.'
