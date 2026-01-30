---
name: check-traveller
description: Check for new conversation exports from Claude Traveller iOS app. Use when looking for recent exported conversations or wanting to load traveller data into the session.
argument-hint: [--all | --review | --delete | --clean] [path]
---

# Check Traveller for New Conversations

Scan for new markdown conversation files exported from the Claude Traveller iOS app.

## Switches

| Switch | Short | Description |
|--------|-------|-------------|
| `--all` | `-a` | Scan all configured projects (instead of just current project) |
| `--review` | `-r` | Mark selected conversations as reviewed (moves to `reviewed/` subfolder) |
| `--delete` | `-d` | Delete selected conversations (with confirmation) |
| `--clean` | `-c` | Delete all reviewed conversations (clears `reviewed/` folders) |

## Instructions

When the user invokes `/check-traveller`, scan for new conversation markdown files.

### Parse Arguments

Check `$ARGUMENTS` for switches:
- If it contains `--all` or `-a`: Scan all configured projects
- If it contains `--review` or `-r`: Enable review mode
- If it contains `--delete` or `-d`: Enable delete mode
- If it contains `--clean` or `-c`: Enable clean mode
- Any remaining non-switch argument is treated as a path

### Steps

1. **Determine the folder to scan**
   - If a path argument is provided, use that path
   - If `--all` or `-a` switch is provided, scan all configured projects from `~/.claude-traveller/config.json`
   - Otherwise (default), search the **current project only**:
     1. Check if `./traveller/` exists in the current working directory - if so, use it
     2. If not, check `~/.claude-traveller/config.json` for a project whose path contains the current directory
     3. If no match found, default to scanning the current directory for `.md` files

2. **Find recent conversation files**
   - Use `Glob` to find `*.md` files that look like traveller exports (typically named with timestamps like `2024-01-23-*.md`)
   - **Exclude** files in `reviewed/` subfolders (these have already been processed)
   - Sort by modification time (newest first)
   - Show the 10 most recent files with their dates

3. **Display summary**
   - For each file, extract the first heading as the title
   - Show file path, date, and title
   - Indicate approximate size or message count if visible

4. **Handle mode-specific actions**

   **Default mode (no switches):**
   - Ask the user if they want to load any specific conversation into the current session
   - If yes, read the selected file(s) and summarize the key points

   **Review mode (`--review`):**
   - Ask which conversations to mark as reviewed (can select multiple: "1,3,5" or "all")
   - For each selected file, move it to a `reviewed/` subfolder in the same directory
   - Create the `reviewed/` folder if it doesn't exist
   - Example: `traveller/2024-01-23-file.md` → `traveller/reviewed/2024-01-23-file.md`

   **Delete mode (`--delete`):**
   - Ask which conversations to delete (can select multiple: "1,3,5" or "all")
   - Show a confirmation prompt listing the files to be deleted
   - Only delete after explicit "yes" confirmation
   - Use `rm` via Bash to delete the files

   **Clean mode (`--clean`):**
   - Find all files in `reviewed/` subfolders across all project traveller directories
   - Show count and total size of reviewed files
   - Ask for confirmation before deleting
   - Delete all files in `reviewed/` folders

### Example Output

```
Recent Traveller Conversations:

1. 2024-01-23-143052-A1B2C3D4.md (Today, 2:30 PM)
   "Debugging the authentication flow"

2. 2024-01-22-091523-E5F6G7H8.md (Yesterday, 9:15 AM)
   "API endpoint design discussion"

Which conversation would you like to load? (Enter number, or 'skip')
```

**Review mode example:**
```
/check-traveller --review

Recent Traveller Conversations:
1. 2024-01-23-143052-A1B2C3D4.md - "Debugging auth flow"
2. 2024-01-22-091523-E5F6G7H8.md - "API endpoint design"

Which conversations to mark as reviewed? (e.g., "1,3" or "all" or "skip")
> 1,2

Marked as reviewed:
  → traveller/reviewed/2024-01-23-143052-A1B2C3D4.md
  → traveller/reviewed/2024-01-22-091523-E5F6G7H8.md
```

**Delete mode example:**
```
/check-traveller --delete

Recent Traveller Conversations:
1. 2024-01-23-143052-A1B2C3D4.md - "Debugging auth flow"

Which conversations to delete? (e.g., "1,3" or "all" or "skip")
> 1

⚠️  About to DELETE:
  - traveller/2024-01-23-143052-A1B2C3D4.md

Type 'yes' to confirm deletion:
```

### Config Location

The Claude Traveller Listener config is at `~/.claude-traveller/config.json` with structure:
```json
{
  "projects": [
    { "tag": "project-name", "path": "/path/to/traveller/folder" }
  ]
}
```
