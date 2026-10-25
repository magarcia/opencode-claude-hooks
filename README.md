# OpenCode Claude Hooks

[![npm version](https://badge.fury.io/js/opencode-claude-hooks.svg)](https://www.npmjs.com/package/opencode-claude-hooks)
[![npm downloads](https://img.shields.io/npm/dm/opencode-claude-hooks.svg)](https://www.npmjs.com/package/opencode-claude-hooks)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Made with Bun](https://img.shields.io/badge/Made%20with-Bun-f9f1e1?logo=bun)](https://bun.sh)

> Claude Code hooks compatibility for OpenCode

This OpenCode plugin enables you to use your existing Claude Code hook configurations with OpenCode, providing ~80% compatibility for drop-in migration.

## Features

- ✅ **Drop-in compatibility** - Use your existing `.claude/settings.json` files
- ✅ **All major hooks supported** - SessionStart, SessionEnd, PreToolUse, PostToolUse, etc.
- ✅ **Command and prompt-based hooks** - Run shell scripts or use LLM-based decisions
- ✅ **Multiple config locations** - Project and global configurations
- ✅ **Tool pattern matching** - Target specific tools with regex patterns

## Installation

```bash
npm install opencode-claude-hooks
# or
bun add opencode-claude-hooks
```

Add to your OpenCode configuration (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-claude-hooks"
  ]
}
```

## Configuration

The plugin loads hook configurations from these locations (in priority order):

**Claude Code locations (for compatibility):**
1. `.claude/settings.local.json` (project, not committed)
2. `.claude/settings.json` (project)
3. `~/.claude/settings.json` (user global)

**OpenCode locations:**
4. `.opencode/hooks.json` (project)
5. `~/.config/opencode/hooks.json` (user global)

All configurations are merged, with earlier files taking precedence.

## Hook Configuration Format

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./scripts/validate-command.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session started!'"
          }
        ]
      }
    ]
  }
}
```

## Supported Hooks

| Claude Code Hook | OpenCode Event | Compatibility |
|-----------------|----------------|---------------|
| `SessionStart` | `session.created` | ✅ Full |
| `SessionEnd` | `session.deleted` | ✅ Full |
| `PreToolUse` | `tool.execute.before` | ✅ Full |
| `PostToolUse` | `tool.execute.after` | ✅ Full |
| `PostToolUseFailure` | `tool.execute.after` (error) | ✅ Full |
| `PermissionRequest` | `permission.asked` | ⚠️ Partial |
| `SubagentStart` | `tool.execute.before` (Task) | ⚠️ Partial |
| `SubagentStop` | `tool.execute.after` (Task) | ⚠️ Partial |
| `PreCompact` | `experimental.session.compacting` | ⚠️ Partial |
| `UserPromptSubmit` | `message.updated` (user) | ⚠️ Partial |
| `Stop` | `session.idle` | ⚠️ Partial |
| `Notification` | `tui.toast.show` | ⚠️ Partial |
| `Setup` | N/A | ❌ Not supported |

## Hook Types

### Command Hooks

Execute shell commands with stdin/stdout:

```json
{
  "type": "command",
  "command": "bash ./my-hook.sh",
  "timeout": 5000
}
```

**Background mode** — Run the command without waiting for it to finish (fire-and-forget). This is the default for command hooks; useful for long-running bash commands that should not block tool execution:

```json
{
  "type": "command",
  "command": "bash ./long-running.sh",
  "background": true
}
```

Set `"background": false` to wait for the command to exit and capture its output (blocking).

**Input via stdin:**
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/project/directory",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "ls" }
}
```

**Exit codes:**
- `0` - Success, continue
- `2` - Block/deny the action
- Other - Non-blocking error

**JSON output (optional):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Dangerous command detected"
  }
}
```

### Prompt-Based Hooks

Use LLM to make decisions:

```json
{
  "type": "prompt",
  "prompt": "Check if this bash command is safe to execute"
}
```

## Tool Pattern Matching

Use the `matcher` field to target specific tools:

- `"*"` or `""` - Matches all tools
- `"Bash"` - Exact match
- `"Edit|Write"` - Regex pattern (matches Edit OR Write)
- `"Read.*"` - Regex with wildcards

## Examples

See the `examples/` directory for complete hook examples:

- **session-start.sh** - Log session starts with timestamp
- **block-dangerous-bash.sh** - Block dangerous bash commands
- **pre-tool-use-logger.sh** - Log all tool executions
- **notify-on-write.sh** - macOS notification when files are written

## Environment Variables

Hooks receive these environment variables:

- `CLAUDE_PROJECT_DIR` - Project root directory
- `OPENCODE_COMPAT` - Set to `"true"` (indicates OpenCode environment)

## Limitations

1. **Setup hook** - No equivalent in OpenCode
2. **MCP tools** - May not trigger plugin hooks
3. **Timing differences** - `Stop` and `PreCompact` semantics differ slightly
4. **Permission model** - OpenCode's permission system works differently

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Type check
bun run typecheck

# Test hooks locally
bun run examples/test-runner.ts
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Related

- [Claude Code](https://claude.com/claude-code)
- [OpenCode](https://opencode.ai)
- [OpenCode Plugin API](https://opencode.ai/docs/plugins/)
