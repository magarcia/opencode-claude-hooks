import { z } from "zod";

// Claude Code hook event types
export type ClaudeHookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PermissionRequest"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop"
  | "PreCompact"
  | "Notification";

// Hook definition schemas
export const CommandHookSchema = z.object({
  type: z.literal("command"),
  command: z.string(),
  timeout: z.number().optional(),
  // When true (default), the command is spawned and not awaited (fire-and-forget).
  // Set to false to wait for the command to exit and capture its output.
  background: z.boolean().optional().default(true),
});

export const PromptHookSchema = z.object({
  type: z.literal("prompt"),
  prompt: z.string(),
});

export const HookDefinitionSchema = z.union([CommandHookSchema, PromptHookSchema]);

export const HookConfigSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookDefinitionSchema),
});

export const HooksSettingsSchema = z.object({
  hooks: z
    .record(z.string(), z.array(HookConfigSchema))
    .optional()
    .default({}),
});

export type CommandHook = z.infer<typeof CommandHookSchema>;
export type PromptHook = z.infer<typeof PromptHookSchema>;
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;
export type HookConfig = z.infer<typeof HookConfigSchema>;
export type HooksSettings = z.infer<typeof HooksSettingsSchema>;

// Base hook input that all hooks receive
export interface BaseHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: ClaudeHookEvent;
}

// Event-specific hook inputs
export interface SessionStartInput extends BaseHookInput {
  hook_event_name: "SessionStart";
  is_continuation: boolean;
}

export interface SessionEndInput extends BaseHookInput {
  hook_event_name: "SessionEnd";
}

export interface UserPromptSubmitInput extends BaseHookInput {
  hook_event_name: "UserPromptSubmit";
  user_prompt: string;
}

export interface PreToolUseInput extends BaseHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PostToolUseInput extends BaseHookInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: string;
}

export interface PostToolUseFailureInput extends BaseHookInput {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: Record<string, unknown>;
  error: string;
}

export interface PermissionRequestInput extends BaseHookInput {
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_type: string;
}

export interface SubagentStartInput extends BaseHookInput {
  hook_event_name: "SubagentStart";
  subagent_type: string;
  task_description: string;
}

export interface SubagentStopInput extends BaseHookInput {
  hook_event_name: "SubagentStop";
  subagent_type: string;
  task_description: string;
  result?: string;
}

export interface StopInput extends BaseHookInput {
  hook_event_name: "Stop";
  stop_reason: string;
}

export interface PreCompactInput extends BaseHookInput {
  hook_event_name: "PreCompact";
  summary_so_far?: string;
}

export interface NotificationInput extends BaseHookInput {
  hook_event_name: "Notification";
  message: string;
  level: "info" | "warning" | "error";
}

export type HookInput =
  | SessionStartInput
  | SessionEndInput
  | UserPromptSubmitInput
  | PreToolUseInput
  | PostToolUseInput
  | PostToolUseFailureInput
  | PermissionRequestInput
  | SubagentStartInput
  | SubagentStopInput
  | StopInput
  | PreCompactInput
  | NotificationInput;

// Hook output structures
export interface HookSpecificOutput {
  hookEventName: ClaudeHookEvent;
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
}

export interface HookOutput {
  hookSpecificOutput?: HookSpecificOutput;
  continue?: boolean;
  stopReason?: string;
}

// Execution result
export interface HookExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  output?: HookOutput;
  blocked: boolean;
  error?: string;
}

// Prompt hook evaluation result
export interface PromptHookResult {
  ok: boolean;
  reason: string;
}

// Combined result from running all matching hooks
export interface HooksResult {
  blocked: boolean;
  blockReason?: string;
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string[];
  errors: string[];
}

// Config file paths
export interface ConfigPaths {
  claudeProjectLocal: string;
  claudeProject: string;
  claudeGlobal: string;
  opencodeProject: string;
  opencodeGlobal: string;
}

// Plugin context passed to handlers
export interface PluginContext {
  sessionId: string;
  cwd: string;
  permissionMode: string;
  transcriptPath: string;
}
