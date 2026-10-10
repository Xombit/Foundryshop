[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
    [string]$Version = '1.0.0'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$moduleName = 'foundryshop'
$output = Join-Path $root "dist\$moduleName"
$manifest = Get-Content -LiteralPath (Join-Path $root 'module.json') -Raw | ConvertFrom-Json
if ($manifest.id -ne $moduleName) {
    throw "Unexpected module ID: $($manifest.id)"
}

# Local packages deliberately have no upstream automatic-update endpoint.
$manifest.version = $Version
$manifest.url = 'https://github.com/Xombit/foundryshop'
$manifest.license = 'LICENSE'
$manifest.readme = 'README.md'
$manifest.changelog = 'CHANGELOG.md'
$manifest.PSObject.Properties.Remove('manifest')
$manifest.PSObject.Properties.Remove('download')

$files = @('setup.js', 'README.md', 'LICENSE', 'CHANGELOG.md')
foreach ($folder in @('scripts', 'templates', 'languages', 'assets')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Recurse |
        ForEach-Object { $_.FullName.Substring($root.Length + 1) }
}
$files += Get-ChildItem -LiteralPath (Join-Path $root 'styles') -Filter '*.css' -File |
    ForEach-Object { $_.FullName.Substring($root.Length + 1) }

foreach ($relative in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
        throw "Missing runtime file: $relative"
    }
}
Get-Command node -ErrorAction Stop | Out-Null
foreach ($relative in ($files | Where-Object { $_ -like '*.js' })) {
    Get-Content -LiteralPath (Join-Path $root $relative) -Raw |
        & node --input-type=module --check
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript syntax check failed: $relative"
    }
}

if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path $output -Force | Out-Null
foreach ($relative in $files) {
    $destination = Join-Path $output $relative
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $destination
}
$manifestJson = $manifest | ConvertTo-Json -Depth 20
if ($manifestJson -match '#\{[^}]+\}#') {
    throw 'Unresolved release placeholders in generated manifest.'
}
[System.IO.File]::WriteAllText(
    (Join-Path $output 'module.json'),
    $manifestJson,
    (New-Object System.Text.UTF8Encoding($false))
)
foreach ($relative in @($manifest.esmodules) + @($manifest.scripts) + @($manifest.styles) +
    @($manifest.languages | ForEach-Object { $_.path })) {
    if (-not (Test-Path -LiteralPath (Join-Path $output $relative) -PathType Leaf)) {
        throw "Manifest references a missing file: $relative"
    }
}
& node (Join-Path $PSScriptRoot 'validate-package.mjs') $output
if ($LASTEXITCODE -ne 0) { throw 'Module package validation failed.' }

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function Write-ModuleArchive([string]$Path, [string]$Prefix) {
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
    # ZIP entry paths must use forward slashes for non-Windows hosts.
    $zip = [System.IO.Compression.ZipFile]::Open($Path, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $output -File -Recurse) {
            $entry = $Prefix + $file.FullName.Substring($output.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry,
                [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally { $zip.Dispose() }
}
$archive = Join-Path $root "dist\$moduleName-$Version.zip"
Write-ModuleArchive $archive "$moduleName/"
$packages = Join-Path $root 'packages'
New-Item -ItemType Directory -Path $packages -Force | Out-Null
$package = Join-Path $packages "$moduleName-$Version.zip"
Write-ModuleArchive $package ''
Write-Host "Built $moduleName $Version at $output"
Write-Host "Extract into Data\modules: $archive"
Write-Host "Extract into Data\modules\$moduleName : $package"
Write-Host 'Foundryshop is a fresh module ID: settings from Boneyard Drawing Tools are not carried over.'
