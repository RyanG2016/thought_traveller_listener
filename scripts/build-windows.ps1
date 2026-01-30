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
    Write-Host "Building Windows distribution..." -ForegroundColor Cyan

    Push-Location $ProjectRoot
    try {
        # Build TypeScript
        Write-Host "Compiling TypeScript..."
        npm run build

        # Note: pkg cannot bundle systray2 due to native binary issues
        # Instead, we create a distribution that runs via Node.js

        Write-Host "Creating Windows distribution..."

        # Create distribution folder
        $WinDist = Join-Path $DistDir "ThoughtTravellerListener-win"
        if (Test-Path $WinDist) {
            Remove-Item $WinDist -Recurse -Force
        }
        New-Item -ItemType Directory -Path $WinDist | Out-Null

        # Copy compiled JS files
        Copy-Item "$DistDir\*.js" $WinDist -Force
        Copy-Item "$DistDir\*.js.map" $WinDist -Force -ErrorAction SilentlyContinue

        # Copy node_modules (required for runtime)
        Write-Host "Copying node_modules (this may take a moment)..."
        Copy-Item "$ProjectRoot\node_modules" "$WinDist\node_modules" -Recurse -Force

        # Copy package.json
        Copy-Item "$ProjectRoot\package.json" $WinDist -Force

        # Create launcher batch file
        $LauncherContent = @"
@echo off
cd /d "%~dp0"
node tray.js
"@
        Set-Content -Path "$WinDist\ThoughtTravellerListener.bat" -Value $LauncherContent

        # Create hidden launcher (no console window) using VBScript
        $VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node tray.js", 0, False
"@
        Set-Content -Path "$WinDist\ThoughtTravellerListener.vbs" -Value $VbsContent

        Write-Host ""
        Write-Host "Build complete!" -ForegroundColor Green
        Write-Host "Distribution folder: $WinDist"
        Write-Host ""
        Write-Host "To run (with console): ThoughtTravellerListener.bat"
        Write-Host "To run (hidden):       ThoughtTravellerListener.vbs"
        Write-Host ""
        Write-Host "Note: Node.js must be installed on the target machine"
        Write-Host ""
        Write-Host "To install for auto-start, run:"
        Write-Host "  .\scripts\build-windows.ps1 -Install" -ForegroundColor Yellow

        # Update ExePath to point to vbs launcher for install
        $script:ExePath = Join-Path $WinDist "ThoughtTravellerListener.vbs"
    } finally {
        Pop-Location
    }
}

function Install-Startup {
    $WinDist = Join-Path $DistDir "ThoughtTravellerListener-win"

    if (-not (Test-Path $WinDist)) {
        Write-Host "Distribution not found. Building first..." -ForegroundColor Yellow
        Build-Executable
    }

    Write-Host "Installing to local programs folder..." -ForegroundColor Cyan

    # Copy entire distribution to user's local programs folder
    $InstallDir = Join-Path $env:LOCALAPPDATA "ThoughtTravellerListener"

    if (Test-Path $InstallDir) {
        # Check if process is running
        $process = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*ThoughtTravellerListener*" }
        if ($process) {
            Write-Host "Stopping running instance..."
            Stop-Process -Id $process.Id -Force
            Start-Sleep -Seconds 2
        }
        Remove-Item $InstallDir -Recurse -Force
    }

    Write-Host "Copying files (this may take a moment)..."
    Copy-Item $WinDist $InstallDir -Recurse -Force
    Write-Host "Installed to: $InstallDir"

    # Create startup shortcut pointing to the VBS launcher (hidden window)
    $StartupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
    $ShortcutPath = Join-Path $StartupFolder "Thought Traveller Listener.lnk"
    $LauncherPath = Join-Path $InstallDir "ThoughtTravellerListener.vbs"

    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = "`"$LauncherPath`""
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "Thought Traveller Listener - Receives AI conversation exports"
    $Shortcut.Save()

    Write-Host "Startup shortcut created: $ShortcutPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "Thought Traveller Listener will now start automatically when you log in."
    Write-Host ""
    Write-Host "To start it now, run:"
    Write-Host "  wscript.exe `"$LauncherPath`"" -ForegroundColor Yellow
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

    # Remove installed folder
    $InstallDir = Join-Path $env:LOCALAPPDATA "ThoughtTravellerListener"
    if (Test-Path $InstallDir) {
        # Check if node process is running from our install dir
        $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue
        foreach ($proc in $processes) {
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
                if ($cmdLine -like "*ThoughtTravellerListener*") {
                    Write-Host "Stopping running instance..."
                    Stop-Process -Id $proc.Id -Force
                    Start-Sleep -Seconds 2
                }
            } catch {}
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
