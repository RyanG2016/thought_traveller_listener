---
name: request-mobile-input
description: Request input from user's mobile device when they're away. Use when you need simple input (1/2/3, Y/N) and the user may not be at their computer.
argument-hint: <prompt> [--options 1,2,3] [--timeout 300]
---

# Request Mobile Input

Request simple input from the user's mobile device via the Claude Traveller app. This is useful when:
- You need a quick decision (choose 1, 2, or 3)
- The user may have stepped away from their computer
- Monitoring mode is enabled on their iOS device

## When to Use This Skill

Use this skill when:
1. You're about to ask for simple input (numeric choice, yes/no, short text)
2. The task is long-running and the user might not be watching
3. You want to notify the user on their phone instead of waiting at the terminal

**Do NOT use this skill for:**
- Complex questions requiring detailed responses
- Code review or file content
- Questions that need back-and-forth discussion

## Arguments

Parse `$ARGUMENTS` for:
- The main argument is the prompt/question to ask
- `--options` or `-o`: Comma-separated list of options (e.g., "1,2,3" or "yes,no")
- `--timeout` or `-t`: Timeout in seconds (default: 300 = 5 minutes)
- `--project` or `-p`: Project tag (optional, for context)

## Instructions

When invoked, follow these steps:

### 1. Parse the Arguments

Extract the prompt and any options from the arguments. Examples:
- `/request-mobile-input "Which approach? 1=Refactor, 2=Rewrite, 3=Skip" --options 1,2,3`
- `/request-mobile-input "Continue with deployment?" --options yes,no`
- `/request-mobile-input "Enter the API key prefix"`

### 2. Load Configuration

Read the Claude Traveller config to get the listener connection details:

```bash
CONFIG_FILE="$HOME/.claude-traveller/config.json"
```

Extract:
- `listener.port` (default: 41420)
- `listener.auth_token`
- `network.tls.enabled` (to determine http vs https)

### 3. Make the Request

Use curl to call the `/input-request` endpoint:

```bash
# Example for numeric options
curl -s -X POST "http://localhost:41420/input-request" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "prompt": "Which approach should I use?",
    "options": ["1", "2", "3"],
    "input_type": "numeric",
    "timeout_seconds": 300
  }'
```

The endpoint will block until:
- A response is received from the mobile device
- The timeout is reached
- An error occurs (no devices connected)

### 4. Handle the Response

**Success response:**
```json
{
  "success": true,
  "response": "2",
  "responded_by": "mobile",
  "response_time_ms": 15000
}
```

**Error response (no devices):**
```json
{
  "success": false,
  "error": "No mobile devices connected for monitoring",
  "connected_devices": 0
}
```

**Error response (timeout):**
```json
{
  "success": false,
  "error": "Mobile input request timed out after 300 seconds",
  "connected_devices": 1
}
```

### 5. Report to User

After receiving the response:
- If successful: Report the user's choice and continue with the task
- If no devices: Inform the user to enable monitoring mode on their phone, then fall back to asking directly
- If timeout: Inform the user and ask if they want to retry or respond directly

## Example Usage

### Numeric Choice
```
/request-mobile-input "Which database migration strategy? 1=Incremental, 2=Full rebuild, 3=Skip" --options 1,2,3
```

### Yes/No Question
```
/request-mobile-input "Deploy to production?" --options yes,no
```

### Free Text (short)
```
/request-mobile-input "Enter the environment name" --timeout 120
```

## Implementation Notes

- The listener must be running (`claude-traveller start`)
- At least one iOS device must be connected with monitoring mode enabled
- The request blocks the current terminal until response/timeout
- For HTTPS listeners, use `-k` flag with curl to accept self-signed certs

## Fallback Behavior

If the mobile request fails:
1. Check if listener is running (`curl http://localhost:41420/health`)
2. Check monitor status (`curl http://localhost:41420/monitor/status`)
3. If no devices connected, inform user and ask the question directly in the terminal
4. If timeout, offer to retry or get direct input
