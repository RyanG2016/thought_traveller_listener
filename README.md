# Thought Traveller for Claude Code

A companion desktop service that bridges your Claude Code sessions with the Thought Traveller iOS app—capture ideas on the go, export conversations to your projects, and receive mobile notifications when Claude needs input.

> **Note:** Thought Traveller is an independent project and is not affiliated with or endorsed by Anthropic.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [First-Time Setup](#first-time-setup)
- [Projects](#projects)
- [Project Briefs](#project-briefs)
- [Notes & Todos](#notes--todos)
- [Mobile Monitoring](#mobile-monitoring)
- [Apple Push Notifications (APNs)](#apple-push-notifications-apns)
- [TLS/HTTPS Setup](#tlshttps-setup)
- [Building Applications](#building-applications)
- [CLI Reference](#cli-reference)
- [npm Scripts](#npm-scripts)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [Development Methodology](#development-methodology)
- [Contributing](#contributing)

---

## Quick Start

```bash
# 1. Install and build
npm install && npm run build

# 2. Initialize configuration
node dist/cli.js init

# 3. Set your authentication token (share this with the iOS app)
node dist/cli.js config set auth_token "$(openssl rand -hex 32)"

# 4. Generate TLS certificates
node dist/cli.js tls setup

# 5. Add a project
node dist/cli.js project add

# 6. Start the listener
node dist/cli.js start
```

Or use the pre-built application:
- **macOS:** Run `ThoughtTravellerListener.app`
- **Windows:** Run `ThoughtTravellerListener.exe`

---

## Installation

### Requirements

- **Node.js** 20+ (for building from source)
- **Supported Platforms:** macOS (Intel/Apple Silicon), Windows 10+, Linux

### From Source

```bash
git clone https://github.com/your-repo/thought-traveller.git
cd thought-traveller/listener

npm install
npm run build

# Optional: Link globally for CLI access
npm link
```

### Pre-built Applications

Download from the releases page:
- `ThoughtTravellerListener.app` - macOS application bundle
- `ThoughtTravellerListener.exe` - Windows executable

---

## First-Time Setup

### Step 1: Initialize Configuration

```bash
thought-traveller init
```

This creates your configuration directory:
- **macOS/Linux:** `~/.thought-traveller/`
- **Windows:** `%APPDATA%\thought-traveller\`

### Step 2: Set Authentication Token

The auth token is a shared secret between the listener and iOS app. **Both must use the same token.**

```bash
# Generate a secure random token
thought-traveller config set auth_token "$(openssl rand -hex 32)"

# Or set your own
thought-traveller config set auth_token "your-secret-token-here"
```

**Important:**
- Use at least 32 characters
- Keep this token private—anyone with it can send data to your listener
- You'll need to enter this same token in the iOS app

### Step 3: Enable HTTPS (Recommended)

```bash
thought-traveller tls setup
```

This generates a self-signed certificate and displays a fingerprint. **Save the fingerprint**—you'll verify it in the iOS app to ensure a secure connection.

### Step 4: Add Your First Project

```bash
thought-traveller project add
```

Follow the interactive prompts to configure where conversations will be saved.

### Step 5: Start the Listener

```bash
thought-traveller start
```

You should see:
```
  Thought Traveller Listener v1.0.0
  ────────────────────────────────

  Network:
    Local:      https://192.168.1.100:41420
    TLS:        ✓ Enabled
    Bonjour:    ✓ Advertising

  Status: Ready to receive conversations
```

### Step 6: Connect iOS App

1. Open Thought Traveller on your iPhone
2. The app will discover your listener via Bonjour
3. Enter the same auth token you configured
4. Verify the TLS fingerprint matches
5. You're connected!

---

## Projects

Projects define where conversations are saved on your local disk.

### Add a Project

**Interactive mode (recommended):**
```bash
thought-traveller project add
```

**Command-line mode:**
```bash
thought-traveller project add \
  --tag my-project \
  --name "My Project" \
  --path ~/Projects/MyProject/traveller
```

### Project Fields

| Field | Description |
|-------|-------------|
| `tag` | Unique identifier used to route conversations (lowercase, hyphens allowed) |
| `name` | Display name shown in the iOS app |
| `path` | Local directory where conversations are saved |

### Scan for Projects

Quickly add multiple projects from a directory:

```bash
thought-traveller project scan
```

### List Projects

```bash
thought-traveller project list
```

### Remove a Project

```bash
thought-traveller project remove <tag>
```

---

## Project Briefs

Briefs provide context to the iOS app when discussing a project. They're markdown files containing project overview, tech stack, current status, etc.

### Create a Brief

1. **Get the generator prompt:**
   ```bash
   thought-traveller brief generate my-project
   ```

2. **Paste the prompt into Claude** (with your project context loaded)

3. **Save the output** to `PROJECT_BRIEF.md` in your project

4. **Link it to your project:**
   ```bash
   thought-traveller project set-brief my-project --file ~/Projects/MyProject/PROJECT_BRIEF.md
   ```

### Brief Commands

| Command | Description |
|---------|-------------|
| `brief show-prompt` | Display the brief generator template |
| `brief generate <tag>` | Show instructions for generating a brief |
| `brief view <tag>` | View a project's brief content |
| `project set-brief <tag> --file <path>` | Link a brief file to a project |

---

## Notes & Todos

The iOS app can send quick notes and todos that are saved as markdown files.

### Note Format

Notes are saved to your project's traveller directory:

```markdown
# Note: Quick idea for the login flow

**Created:** January 30, 2026 at 2:30 PM
**Type:** note

---

Consider using biometric auth as the primary login method...
```

### Todo Format

```markdown
# Todo: Fix the API timeout issue

**Created:** January 30, 2026 at 3:00 PM
**Type:** todo
**Status:** pending

---

The webhook is timing out after 30 seconds. Need to implement async processing.
```

---

## Mobile Monitoring

Enable real-time notifications on your phone when Claude Code needs input.

### How It Works

1. Start a long-running task in Claude Code
2. Enable monitoring mode on the iOS app
3. Step away from your computer
4. When Claude needs input (e.g., "Choose option 1, 2, or 3"), your phone gets notified
5. Respond on your phone, Claude continues working

### Check Monitoring Status

```bash
thought-traveller monitor status
```

### Test Mobile Notifications

```bash
thought-traveller monitor test
```

### Configure Timeout

Set how long the listener waits for a mobile response (1-120 minutes):

```bash
thought-traveller config set input_timeout 30
```

---

## Apple Push Notifications (APNs)

APNs enables push notifications when the iOS app isn't actively connected—useful when you step away from WiFi or the app is in the background.

### Prerequisites

1. An Apple Developer account
2. An APNs key (.p8 file) from the Apple Developer portal

### Generate APNs Key

1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/authkeys/list)
2. Click **Keys** → **+** (Create a new key)
3. Name it (e.g., "Thought Traveller APNs")
4. Check **Apple Push Notifications service (APNs)**
5. Click **Continue** → **Register**
6. **Download the .p8 file** (you can only download it once!)
7. Note the **Key ID** shown on the page
8. Note your **Team ID** (visible in Membership details)

### Configure APNs

```bash
thought-traveller apns setup \
  --key /path/to/AuthKey_XXXXXXXXXX.p8 \
  --key-id XXXXXXXXXX \
  --team-id YYYYYYYYYY \
  --bundle-id com.yourcompany.thoughttraveller
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--key` | Path to your .p8 key file |
| `--key-id` | 10-character Key ID from Apple Developer |
| `--team-id` | 10-character Team ID from Apple Developer |
| `--bundle-id` | Your iOS app's bundle identifier |
| `--production` | (Optional) Use production APNs server instead of sandbox |

### Check APNs Status

```bash
thought-traveller apns status
```

### Disable/Enable APNs

```bash
thought-traveller apns disable
thought-traveller apns enable
```

### APNs Behavior

- **30-minute queue:** Input requests stay pending for 30 minutes (configurable)
- **Push when disconnected:** If the iOS app has provided an APNs token but isn't connected via WebSocket, a push notification is sent
- **Reconnect and respond:** Users can reconnect and respond to pending requests
- **Fallback:** If APNs isn't configured, WebSocket-only notifications still work

---

## TLS/HTTPS Setup

HTTPS encrypts communication between the iOS app and listener.

### Generate Certificates

```bash
thought-traveller tls setup
```

Output:
```
✓ TLS certificates generated and enabled

Certificate fingerprint (SHA-256):
  20:7F:91:9D:99:5F:41:97:AF:14:F5:5D:86:48:B0:D3...

Important:
  Save this fingerprint! Verify it in the iOS app to ensure
  you're connecting to the correct server.
```

### TLS Commands

| Command | Description |
|---------|-------------|
| `tls setup` | Generate certificates and enable HTTPS |
| `tls setup --force` | Regenerate certificates |
| `tls status` | Show TLS configuration and fingerprint |
| `tls enable` | Enable HTTPS |
| `tls disable` | Disable HTTPS (not recommended) |

---

## Building Applications

### Prerequisites

All build commands must be run from the project root directory (`thought-traveller-listener/`).

Before building executables, install dependencies and compile TypeScript:

```bash
# 1. Navigate to the project directory
cd path/to/thought-traveller-listener

# 2. Install dependencies
npm install

# 3. Compile TypeScript to JavaScript (creates dist/ folder)
npm run build
```

**Important:** The `npm run build` step is required before packaging. It compiles the TypeScript source files into JavaScript in the `dist/` folder. Without this step, the packaging commands will fail with "input file doesn't exist".

### macOS Application Bundle

```bash
npm run build:macos-app
```

Creates `dist/ThoughtTravellerListener.app`

**Features:**
- Runs as a menu bar app (no Dock icon)
- Green circle icon in menu bar
- Auto-starts listener on launch
- Survives sleep/wake cycles

**Installation:**
1. Copy `ThoughtTravellerListener.app` to `/Applications`
2. Open **System Settings** → **General** → **Login Items**
3. Add ThoughtTravellerListener under "Open at Login"

**First Launch:**
- macOS may show a security warning for unsigned apps
- Right-click the app → **Open** → **Open** to bypass Gatekeeper

### Windows Executable

```bash
npm run pkg:windows
```

Or use npx directly:
```powershell
npx pkg dist/tray.js --targets node18-win-x64 --output dist/ThoughtTraveller-win.exe --compress GZip
```

Creates `dist/ThoughtTraveller-win.exe`

**Installation with Auto-Start:**
```powershell
.\scripts\build-windows.ps1 -Install
```

This:
- Copies the executable to `%LOCALAPPDATA%\ThoughtTravellerListener`
- Creates a Startup folder shortcut

**Uninstall:**
```powershell
.\scripts\build-windows.ps1 -Uninstall
```

### Build All Platforms

```bash
npm run pkg:all
```

Creates both macOS and Windows executables in `dist/`.

---

## CLI Reference

### General Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize configuration |
| `init --force` | Reinitialize (overwrites existing) |
| `start` | Start the listener (foreground) |
| `status` | Check if listener is running |
| `logs` | View recent log entries |
| `logs --tail 100` | View last 100 log entries |

### Configuration Commands

| Command | Description |
|---------|-------------|
| `config show` | Display current configuration |
| `config set auth_token <token>` | Set authentication token |
| `config set port <port>` | Set listener port (default: 41420) |
| `config set friendly_name <name>` | Set display name for Bonjour |
| `config set input_timeout <minutes>` | Set mobile input timeout (1-120) |

### Project Commands

| Command | Description |
|---------|-------------|
| `project list` | List all configured projects |
| `project add` | Add a project (interactive) |
| `project add --tag <t> --name <n> --path <p>` | Add a project (CLI) |
| `project scan` | Scan directory and add projects |
| `project remove <tag>` | Remove a project |
| `project set-brief <tag> --file <path>` | Link a brief file |

### Brief Commands

| Command | Description |
|---------|-------------|
| `brief show-prompt` | Show brief generator template |
| `brief generate <tag>` | Instructions to generate a brief |
| `brief view <tag>` | View a project's brief |

### TLS Commands

| Command | Description |
|---------|-------------|
| `tls setup` | Generate certs and enable HTTPS |
| `tls setup --force` | Regenerate certificates |
| `tls status` | Show TLS status and fingerprint |
| `tls enable` | Enable HTTPS |
| `tls disable` | Disable HTTPS |

### Monitor Commands

| Command | Description |
|---------|-------------|
| `monitor status` | Show connected devices and status |
| `monitor test` | Send test notification to mobile |

### APNs Commands

| Command | Description |
|---------|-------------|
| `apns setup --key <p8> --key-id <id> --team-id <id> --bundle-id <id>` | Configure APNs |
| `apns status` | Show APNs configuration |
| `apns enable` | Enable APNs |
| `apns disable` | Disable APNs |

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run start` | Start listener in CLI mode |
| `npm run start:tray` | Start system tray app |
| `npm run dev` | Run CLI in development mode (ts-node) |
| `npm run dev:tray` | Run tray app in development mode |
| `npm run pkg:macos` | Build macOS executable |
| `npm run pkg:windows` | Build Windows executable |
| `npm run pkg:all` | Build all platforms |
| `npm run build:macos-app` | Build macOS .app bundle |

---

## Configuration Reference

Configuration is stored at:
- **macOS/Linux:** `~/.thought-traveller/config.json`
- **Windows:** `%APPDATA%\thought-traveller\config.json`

### Full Configuration Example

```json
{
  "listener": {
    "id": "ct_7f3a2b1c",
    "port": 41420,
    "auth_token": "your-secure-token-here",
    "friendly_name": "My-MacBook-Pro"
  },
  "projects": [
    {
      "tag": "my-project",
      "name": "My Project",
      "path": "/Users/you/Projects/MyProject/traveller",
      "briefFile": "/Users/you/Projects/MyProject/PROJECT_BRIEF.md"
    }
  ],
  "export": {
    "format": "markdown",
    "filename_pattern": "{date}-{time}-{conversation_id_short}.md",
    "create_directories": true
  },
  "network": {
    "bonjour_enabled": true,
    "tls": {
      "enabled": true,
      "cert_path": "~/.thought-traveller/certs/server.crt",
      "key_path": "~/.thought-traveller/certs/server.key"
    }
  },
  "briefs": {
    "generator_prompt_file": "~/.thought-traveller/brief-generator-prompt.md"
  },
  "monitoring": {
    "input_timeout_minutes": 30,
    "apns": {
      "enabled": true,
      "key_path": "/path/to/AuthKey.p8",
      "key_id": "XXXXXXXXXX",
      "team_id": "YYYYYYYYYY",
      "bundle_id": "com.example.thoughttraveller",
      "production": false
    }
  }
}
```

### Configuration Keys

| Key | Description | Default |
|-----|-------------|---------|
| `listener.port` | HTTP/HTTPS port | `41420` |
| `listener.auth_token` | Shared secret with iOS app | (none) |
| `listener.friendly_name` | Name shown in Bonjour discovery | hostname |
| `network.bonjour_enabled` | Advertise on local network | `true` |
| `network.tls.enabled` | Use HTTPS | `false` |
| `monitoring.input_timeout_minutes` | Mobile response timeout | `30` |

---

## Troubleshooting

### "Configuration not found"

Run `thought-traveller init` to create the configuration.

### "Port already in use"

Another instance is running, or another app is using port 41420.

```bash
# Check what's using the port
lsof -i :41420

# Change to a different port
thought-traveller config set port 8443
```

### iOS app can't find the listener

1. Ensure both devices are on the same WiFi network
2. Check the listener is running: `thought-traveller status`
3. Verify Bonjour is enabled in config
4. Check firewall allows incoming connections on port 41420
5. The iOS app searches for `_thoughttraveller._tcp` service

### iOS app can't connect (authentication error)

The auth token doesn't match. Ensure both the listener and iOS app use the exact same token.

### TLS certificate errors

Regenerate certificates and update the fingerprint in the iOS app:

```bash
thought-traveller tls setup --force
```

### View detailed logs

```bash
thought-traveller logs --tail 100
```

Or check the log file directly:
- **macOS/Linux:** `~/.thought-traveller/logs/combined.log`
- **Windows:** `%APPDATA%\thought-traveller\logs\combined.log`

### macOS app won't start

1. Check if an instance is already running:
   ```bash
   ps aux | grep -i thought
   pkill -f ThoughtTraveller
   ```
2. Try running from terminal to see errors:
   ```bash
   /Applications/ThoughtTravellerListener.app/Contents/MacOS/ThoughtTraveller
   ```

---

## Development Methodology

This project follows a **human-directed, AI-assisted development** approach:

- **Architecture & Design**: Human-defined requirements, system design, and technical decisions
- **Implementation**: AI-generated code following human specifications with iterative review
- **Quality Control**: Human testing, debugging, and refinement of all features

This methodology enables rapid, high-quality development while maintaining full human oversight of design decisions and code quality. The project demonstrates systematic engineering practices including:

- Clear separation of concerns (CLI, server, tray, config modules)
- TypeScript strict mode for type safety
- Cross-platform support (macOS, Windows, Linux)
- Security-first design (TLS, token authentication)
- Comprehensive error handling and logging

---

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

### Development Setup

```bash
git clone https://github.com/your-repo/thought-traveller.git
cd thought-traveller/listener
npm install
npm run dev  # Run in development mode with ts-node
```

### Code Style

- TypeScript strict mode
- ESLint for linting (if configured)
- Meaningful commit messages

---

## License

MIT License - See LICENSE file for details.

---

*Thought Traveller for Claude Code*
*Version 1.0.0*
*January 2026*
