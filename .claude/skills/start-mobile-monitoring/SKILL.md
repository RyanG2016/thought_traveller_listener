---
name: start-mobile-monitoring
description: Enable mobile monitoring mode - Claude will notify your phone for simple input choices instead of waiting at the terminal.
argument-hint: [--check-only]
---

# Start Mobile Monitoring Mode

When invoked, this skill enables "mobile monitoring mode" for the current session. While in this mode, Claude will proactively use the user's mobile device for simple input requests instead of waiting at the terminal.

## What This Does

1. Checks if the Claude Traveller Listener is running
2. Verifies at least one mobile device is connected with monitoring enabled
3. Instructs Claude to use `/request-mobile-input` for simple choices going forward

## Arguments

- `--check-only` or `-c`: Only check connection status, don't enable monitoring mode

## Instructions

### Step 1: Check Listener Status

First, verify the listener is running and devices are connected. Read the config and call the status endpoint:

```bash
# Read config for port and token
CONFIG=$(cat ~/.claude-traveller/config.json)
PORT=$(echo $CONFIG | jq -r '.listener.port')
TOKEN=$(echo $CONFIG | jq -r '.listener.auth_token')

# Check monitor status
curl -s "http://localhost:$PORT/monitor/status" \
  -H "Authorization: Bearer $TOKEN"
```

### Step 2: Evaluate Connection Status

Based on the response:

**If listener not running:**
```
Mobile Monitoring: Not Available

The Claude Traveller Listener is not running.

To start it:
  claude-traveller start

Then enable monitoring on your iOS device and try again.
```

**If no devices connected:**
```
Mobile Monitoring: No Devices Connected

To connect your mobile device:
1. Open Claude Traveller on your iOS device
2. Make sure you're on the same network as this computer
3. Tap "Start Monitoring" 
4. Run /start-mobile-monitoring again
```

**If devices connected (success):**
```
Mobile Monitoring: Enabled

Connected devices: [device count]
  - [device name] (last seen: Xs ago)

I will now use your mobile device for simple input requests:
- Numeric choices (1, 2, 3)
- Yes/No confirmations  
- Short text input

You can step away - I'll notify your phone when I need input.

To test the connection: claude-traveller monitor test
To disable: Just tell me to "stop using mobile input"
```

### Step 3: Set Monitoring Mode Behavior

After successfully verifying connection, Claude should remember for this session:

**IMPORTANT - Monitoring Mode Behavior:**

When mobile monitoring is enabled, for ANY prompt that requires simple user input, Claude MUST:

1. **Identify simple input patterns:**
   - Numeric choices: "Choose option 1, 2, or 3"
   - Yes/No questions: "Should I proceed?", "Continue?", "Deploy?"
   - Simple confirmations: "Is this correct?"
   - Short text: "Enter the environment name"

2. **Use mobile input instead of asking directly:**
   Instead of outputting a question and waiting, call the `/request-mobile-input` skill:
   ```
   /request-mobile-input "Which approach? 1=Refactor, 2=Rewrite, 3=Skip" --options 1,2,3
   ```

3. **Format prompts clearly:**
   - Keep prompts concise (fits on phone notification)
   - Include context: "Deploying to production - continue?" not just "Continue?"
   - For numbered options, include brief descriptions

4. **Handle responses:**
   - Use the returned response to continue the task
   - If timeout/error, fall back to asking directly in terminal

**DO NOT use mobile input for:**
- Complex questions requiring detailed answers
- Code review or approval of large changes
- Questions needing back-and-forth discussion
- Anything requiring the user to see terminal context

### Example Session Flow

```
User: "Refactor the authentication module. I'm stepping away for a bit."

Claude: "I'll work on refactoring the auth module. Let me enable mobile monitoring first."
*runs /start-mobile-monitoring*

Claude: "Mobile Monitoring: Enabled - I'll notify your phone if I need input.

Starting refactoring..."

*Later, Claude needs a decision*

Claude: *uses /request-mobile-input "Auth refactor: Keep backward compatibility? 1=Yes (safer), 2=No (cleaner), 3=Ask me later" --options 1,2,3*

*User responds "1" on their phone*

Claude: "Got it - keeping backward compatibility. Continuing..."
```

## Testing

After enabling, the user can test with:
```bash
claude-traveller monitor test
```

This sends a test notification to verify the connection works.
