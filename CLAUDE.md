# Claude Code Context - Thought Traveller Listener

## Project Overview

Thought Traveller Listener is a cross-platform desktop service that receives AI conversation exports from the Thought Traveller iOS app and saves them as markdown files to configured local project folders.

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript (strict mode)
- **Framework:** Express.js
- **CLI:** Commander.js
- **Logging:** Winston
- **Network Discovery:** bonjour-service (mDNS/Bonjour)
- **System Tray:** systray2
- **Packaging:** pkg (for standalone executables)

## Project Structure

```
src/
├── cli.ts          # CLI entry point (Commander.js)
├── tray.ts         # System tray app entry point
├── tray-menu.ts    # Tray menu building and actions
├── server.ts       # Express HTTP/HTTPS server
├── config.ts       # Configuration management
├── types.ts        # TypeScript interfaces
├── markdown.ts     # Conversation to markdown conversion
├── logger.ts       # Winston logging setup
├── bonjour.ts      # mDNS service advertisement
├── tls.ts          # TLS certificate generation
├── monitoring.ts   # WebSocket monitoring for mobile notifications
└── index.ts        # Library exports

scripts/
├── test-monitor-client.js  # Simulates iOS app for testing monitoring
├── build-macos-app.sh      # Build macOS .app bundle
└── build-windows.ps1       # Build Windows executable

assets/
└── README.md       # Icon documentation

dist/               # Compiled JavaScript output
```

## Key Files

- **Config location:** `~/.thought-traveller/config.json`
- **Logs:** `~/.thought-traveller/logs/`
- **TLS certs:** `~/.thought-traveller/certs/`
- **Brief generator prompt:** `~/.thought-traveller/brief-generator-prompt.md`

## Running the App

```bash
# CLI mode (foreground)
npm run build && npm run start

# System tray mode
npm run build && npm run start:tray

# Development
npm run dev        # CLI
npm run dev:tray   # Tray
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check |
| `/projects` | GET | Yes | List projects (includes hasBrief) |
| `/projects/:tag/brief` | GET | Yes | Get project brief content |
| `/brief-generator-prompt` | GET | Yes | Get brief generator template |
| `/conversation` | POST | Yes | Save/append conversation |
| `/note` | POST | Yes | Save a quick note or todo |
| `/monitor/status` | GET | Yes | Get monitoring session status |
| `/input-request` | POST | Yes | Request input from mobile (blocks until response) |
| `/monitor` | WebSocket | Yes | Real-time monitoring connection for iOS app |

## Key Features

1. **Project Briefs** - Each project can have a PROJECT_BRIEF.md that the iOS app fetches for context
2. **Bonjour Discovery** - Advertises `_thoughttraveller._tcp` for local network discovery
3. **System Tray** - Background app with start/stop controls (green circle icon)
4. **TLS Support** - Self-signed certificates with fingerprint verification
5. **Conversation Continuations** - Appends to existing files based on conversation_id
6. **Mobile Monitoring** - Bidirectional WebSocket for real-time notifications to iOS app
7. **Mobile Input Requests** - Claude Code can request simple input from user's mobile device
8. **Apple Push Notifications** - Optional APNs support for notifications when not on local network

## APNs Configuration (Optional)

Apple Push Notifications allow the listener to send notifications to disconnected iOS devices. This is useful when:
- User steps away from the network but has their phone
- App is in background and WebSocket disconnects
- User wants to receive notifications without active monitoring

### Setup APNs

1. Create an APNs key in Apple Developer portal (Keys section)
2. Download the .p8 key file
3. Configure the listener:

```bash
thought-traveller apns setup \
  --key /path/to/AuthKey_XXXXXXXXXX.p8 \
  --key-id XXXXXXXXXX \
  --team-id YYYYYYYYYY \
  --bundle-id com.yourcompany.thoughttraveller
```

### APNs Features

- **30-minute timeout**: Input requests stay pending for 30 minutes (configurable)
- **Push when disconnected**: If device has APNs token but no WebSocket, push is sent
- **Reconnect and respond**: User can reconnect via WebSocket and respond to pending requests
- **Fallback**: If APNs not configured, WebSocket-only notifications still work

## Configuration

Projects are stored in config with optional briefFile:
```json
{
  "tag": "my-project",
  "name": "My Project",
  "path": "/path/to/traveller",
  "briefFile": "/path/to/PROJECT_BRIEF.md"
}
```

## CLI Commands

```bash
thought-traveller init                    # Initialize config
thought-traveller start                   # Start listener (foreground)
thought-traveller status                  # Check if running
thought-traveller project add             # Add project (interactive)
thought-traveller project list            # List projects
thought-traveller project set-brief <tag> --file <path>  # Link brief
thought-traveller brief show-prompt       # Show brief generator template
thought-traveller brief generate <tag>    # Instructions to generate brief
thought-traveller brief view <tag>        # View project brief
thought-traveller tls setup               # Generate certs & enable HTTPS
thought-traveller config set auth_token "token"  # Set auth token
thought-traveller monitor status          # Show active monitoring sessions
thought-traveller monitor test            # Send test notification to mobile
thought-traveller apns setup              # Configure Apple Push Notifications
thought-traveller apns status             # Show APNs configuration
thought-traveller config set input_timeout 30  # Set mobile input timeout (minutes)
```

## Building Standalone Executables

```bash
npm run pkg:macos    # macOS executable (raw)
npm run pkg:windows  # Windows executable (raw)
npm run pkg:all      # Both platforms (raw)
```

## Building Application Bundles (Recommended)

### macOS (.app bundle)
```bash
npm run build:macos-app
```
Creates `dist/ThoughtTravellerListener.app` - a proper macOS application that:
- Runs as a background app (no dock icon, just menu bar)
- Can be added to Login Items for auto-start
- Survives sleep/wake cycles

**To install:**
1. Copy `ThoughtTravellerListener.app` to `/Applications`
2. Open System Settings → General → Login Items
3. Add ThoughtTravellerListener under "Open at Login"

### Windows
```bash
# On Windows, run from PowerShell:
.\scripts\build-windows.ps1           # Build only
.\scripts\build-windows.ps1 -Install   # Build and install to Startup
.\scripts\build-windows.ps1 -Uninstall # Remove from Startup
```
Or double-click `scripts/build-windows.bat`

Creates `dist/ThoughtTravellerListener.exe` and optionally:
- Copies to `%LOCALAPPDATA%\ThoughtTravellerListener`
- Creates a Startup folder shortcut for auto-start

## Logging

Logs are written to `~/.thought-traveller/logs/combined.log`:
```
← GET /projects              # Incoming request
→ Projects list (5 projects) # Response sent
→ Brief sent: myapp (2.1 KB) # Brief served
→ Conversation saved: myapp/file.md (12 messages)
```

## Claude Code Skills

Custom slash commands for use in Claude Code.

**Note:** After adding or modifying a skill, restart Claude Code for changes to take effect.

### /check-traveller

Scans for new conversation exports from the Thought Traveller iOS app.

**Usage:**
```
/check-traveller              # Scan configured project folders
/check-traveller /path/to/dir # Scan a specific directory
```

**What it does:**
1. Finds recent `.md` conversation files
2. Shows the 10 most recent with titles and dates
3. Offers to load selected conversations into the current session

**Locations:**
- Project-level: `.claude/skills/check-traveller/SKILL.md`
- Global (all projects): `~/.claude/skills/check-traveller/SKILL.md`

### /request-mobile-input

Request simple input from the user's mobile device when they're away from the computer.

**Usage:**
```
/request-mobile-input "Which approach? 1=Refactor, 2=Rewrite" --options 1,2
/request-mobile-input "Continue with deployment?" --options yes,no
/request-mobile-input "Enter the API key prefix" --timeout 120
```

**What it does:**
1. Sends a notification to connected iOS devices via WebSocket
2. Waits for the user to respond on their phone
3. Returns the response to Claude Code to continue the task

**Requirements:**
- Listener must be running
- iOS app must have monitoring mode enabled
- Device must be on the same network (or have been recently)

**Locations:**
- Project-level: `.claude/skills/request-mobile-input/SKILL.md`
- Global (all projects): `~/.claude/skills/request-mobile-input/SKILL.md`

### /start-mobile-monitoring

Enable mobile monitoring mode for the current session. Claude will proactively use your phone for simple input choices.

**Usage:**
```
/start-mobile-monitoring           # Enable monitoring mode
/start-mobile-monitoring --check   # Just check connection status
```

**What it does:**
1. Checks if listener is running and mobile devices are connected
2. Enables "monitoring mode" where Claude uses mobile input for simple choices
3. Claude will use `/request-mobile-input` automatically for:
   - Numeric choices (1, 2, 3)
   - Yes/No confirmations
   - Short text input

**Example workflow:**
```
User: "Refactor the auth module. I'm stepping away."
Claude: *runs /start-mobile-monitoring*
Claude: "Mobile monitoring enabled. I'll notify your phone if I need input."
*Claude works, later needs a decision*
Claude: *uses /request-mobile-input* → notification sent to phone
User: *taps "2" on phone*
Claude: "Got it, continuing with option 2..."
```

**Locations:**
- Project-level: `.claude/skills/start-mobile-monitoring/SKILL.md`
- Global (all projects): `~/.claude/skills/start-mobile-monitoring/SKILL.md`

### Adding New Skills

1. Create a folder in `.claude/skills/<skill-name>/` (project) or `~/.claude/skills/<skill-name>/` (global)
2. Add a `SKILL.md` file with YAML frontmatter:
   ```yaml
   ---
   name: skill-name
   description: What this skill does
   argument-hint: [optional-args]
   ---

   # Skill Title

   Instructions for Claude when this skill is invoked...
   ```
3. Restart Claude Code
4. Invoke with `/<skill-name>`

## Common Tasks

### Adding a new endpoint
1. Add types to `src/types.ts`
2. Add route in `src/server.ts`
3. Add CLI command if needed in `src/cli.ts`

### Updating the tray menu
1. Edit `src/tray-menu.ts` for menu structure
2. Update `src/tray.ts` for click handlers
3. Update MenuId enum if adding items

### Changing the icon
1. Create 22x22 PNG icon
2. Convert to base64
3. Update ICON_MACOS in `src/tray-menu.ts`

## Recent Changes (January 2026)

### Mobile Monitoring & APNs Implementation

Added complete bidirectional monitoring system:

**Listener Changes:**
- `src/monitoring.ts` - WebSocket server for iOS monitoring connections
  - Accepts connections at `/monitor` with auth token
  - Handles heartbeat, input_required, input_response messages
  - APNs push notification support via `@parse/node-apn`
  - 30-minute pending request queue (configurable)
  - Re-sends pending requests when devices reconnect
  - Tracks APNs tokens for disconnected device push

- `src/server.ts` - New endpoints
  - `GET /monitor/status` - Returns connected devices, APNs status, pending requests
  - `POST /input-request` - Blocking endpoint for Claude Code to request mobile input

- `src/cli.ts` - New commands
  - `monitor status` - Show active monitoring sessions
  - `monitor test` - Send test notification to mobile
  - `apns setup/status/enable/disable` - Configure APNs
  - `config set input_timeout` - Configure timeout (1-120 minutes)

- `src/types.ts` - New types for monitoring, APNs config, input requests

- `src/config.ts` - Config migration for monitoring settings

**New Skills:**
- `/request-mobile-input` - Request input from user's phone
- `/start-mobile-monitoring` - Enable monitoring mode for session

**iOS App Status:**
- WebSocket monitoring: ✅ Complete
- Input UI (numeric, yesno, text): ✅ Complete
- Local notifications: ✅ Complete
- Auto-reconnection: ✅ Complete
- APNs push notifications: ❌ Not yet implemented

**iOS Spec:**
- `iOS-MONITORING-SPEC.md` - Complete implementation guide for iOS team
  - WebSocket protocol documentation
  - Message format specifications
  - Swift code examples
  - APNs integration guide

### Testing the Monitoring Flow

1. Start listener: `thought-traveller start`
2. Run test client: `node scripts/test-monitor-client.js`
3. In another terminal: `thought-traveller monitor test`
4. Test client shows notification and you can respond

Or test with iOS app:
1. Start listener with TLS: `thought-traveller tls setup && thought-traveller start`
2. Connect iOS app via Bonjour with monitoring enabled
3. Run: `thought-traveller monitor test`
4. iOS app receives notification

### Configuration Reference

Full config.json structure:
```json
{
  "listener": {
    "id": "ct_xxxxxxxx",
    "port": 41420,
    "auth_token": "your_secret",
    "friendly_name": "My-MacBook"
  },
  "projects": [...],
  "export": {...},
  "network": {
    "upnp_enabled": true,
    "bonjour_enabled": true,
    "tls": {
      "enabled": true,
      "cert_path": "~/.thought-traveller/certs/server.crt",
      "key_path": "~/.thought-traveller/certs/server.key"
    }
  },
  "briefs": {...},
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
