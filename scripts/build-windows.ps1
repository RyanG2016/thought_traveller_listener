# Build script for Windows executable
# Creates ThoughtTravellerListener.exe with installer helper

param(
    [switch]$Install,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DistDir = Join-Path $ProjectRoot "dist"
$ExeName = "ThoughtTravellerListener.exe"
$ExePath = Join-Path $DistDir $ExeName

function Build-Executable {
    Write-Host "Building Windows executable..." -ForegroundColor Cyan

    Push-Location $ProjectRoot
    try {
        # Build TypeScript
        Write-Host "Compiling TypeScript..."
        npm run build

        # Package with pkg
        Write-Host "Packaging executable with pkg..."
        npx pkg dist/tray.js --targets node18-win-x64 --output "$DistDir\ThoughtTravellerListener" --compress GZip

        if (Test-Path $ExePath) {
            Write-Host ""
            Write-Host "Build complete!" -ForegroundColor Green
            Write-Host "Executable: $ExePath"
            Write-Host ""
            Write-Host "To install for auto-start, run:"
            Write-Host "  .\scripts\build-windows.ps1 -Install" -ForegroundColor Yellow
        } else {
            Write-Host "Error: Build failed - executable not created" -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
}

function Install-Startup {
    if (-not (Test-Path $ExePath)) {
        Write-Host "Executable not found. Building first..." -ForegroundColor Yellow
        Build-Executable
    }

    Write-Host "Installing to Startup folder..." -ForegroundColor Cyan

    # Copy to user's local programs folder
    $InstallDir = Join-Path $env:LOCALAPPDATA "ThoughtTravellerListener"
    $InstalledExe = Join-Path $InstallDir $ExeName

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir | Out-Null
    }

    Copy-Item $ExePath $InstalledExe -Force
    Write-Host "Copied to: $InstalledExe"

    # Create startup shortcut
    $StartupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
    $ShortcutPath = Join-Path $StartupFolder "Thought Traveller Listener.lnk"

    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $InstalledExe
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "Thought Traveller Listener - Receives AI conversation exports"
    $Shortcut.Save()

    Write-Host "Startup shortcut created: $ShortcutPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "Thought Traveller Listener will now start automatically when you log in."
    Write-Host "To start it now, run: $InstalledExe"
}

function Uninstall-Startup {
    Write-Host "Removing from Startup..." -ForegroundColor Cyan

    # Remove startup shortcut
    $StartupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
    $ShortcutPath = Join-Path $StartupFolder "Thought Traveller Listener.lnk"

    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-Host "Removed startup shortcut"
    }

    # Remove installed executable
    $InstallDir = Join-Path $env:LOCALAPPDATA "ThoughtTravellerListener"
    if (Test-Path $InstallDir) {
        # Check if process is running
        $process = Get-Process -Name "ThoughtTravellerListener" -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "Stopping running instance..."
            Stop-Process -Name "ThoughtTravellerListener" -Force
            Start-Sleep -Seconds 2
        }

        Remove-Item $InstallDir -Recurse -Force
        Write-Host "Removed installation folder"
    }

    Write-Host ""
    Write-Host "Uninstall complete!" -ForegroundColor Green
}

# Main execution
if ($Install) {
    Install-Startup
} elseif ($Uninstall) {
    Uninstall-Startup
} else {
    Build-Executable
}
