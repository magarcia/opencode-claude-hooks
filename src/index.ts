/**
 * OpenCode Plugin: Claude Code Hooks Compatibility
 * Full implementation - no re-exports
 */

import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import type { PluginContext } from "./types";
import { handleSessionStart, handleSessionEnd } from "./handlers/session";
import { handlePreToolUse, handlePostToolUse, handlePostToolUseFailure } from "./handlers/tool";
import { handlePermissionRequest } from "./handlers/permission";
import { handlePreCompact } from "./handlers/compact";
import { handleSubagentStart, handleSubagentStop } from "./handlers/subagent";
import { handleStop } from "./handlers/stop";
import { handleNotification } from "./handlers/notification";
import { handleUserPromptSubmit } from "./handlers/prompt";

const sessionContexts = new Map<string, PluginContext>();

function getOrCreateContext(sessionId: string, cwd: string): PluginContext {
  let ctx = sessionContexts.get(sessionId);
  if (!ctx) {
    ctx = { sessionId, cwd, permissionMode: "default", transcriptPath: "" };
    sessionContexts.set(sessionId, ctx);
  }
  return ctx;
}

export const ClaudeCodeHooksPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const projectDir = input.directory || input.worktree || process.cwd();

  return {
    event: async ({ event }) => {
      try {
        const props = event.properties as Record<string, any> | undefined;
        const sessionId: string = props?.id ?? props?.sessionID ?? "unknown";

        if (event.type === "session.created") {
          const ctx = getOrCreateContext(sessionId, projectDir);
          await handleSessionStart(ctx, false);
        }
        if (event.type === "session.deleted") {
          const ctx = sessionContexts.get(sessionId);
          if (ctx) {
            await handleSessionEnd(ctx);
            sessionContexts.delete(sessionId);
          }
        }
        // Wire up Stop hook via session.idle / session.status idle
        if (event.type === "session.idle" || (event.type === "session.status" && props?.status?.type === "idle")) {
          const ctx = sessionContexts.get(sessionId);
          if (ctx) {
            await handleStop(ctx, "session_idle");
          }
        }
        // Wire up Notification hook via tui.toast.show
        if (event.type === "tui.toast.show") {
          const ctx = getOrCreateContext(sessionId, projectDir);
          const message = props?.message ?? "";
          const level = props?.level ?? "info";
          await handleNotification(ctx, message, level);
        }
      } catch (err) {
        // ignore
      }
    },

    "tool.execute.before": async (hookInput, output) => {
      try {
        const { tool: toolName, sessionID } = hookInput;
        const ctx = getOrCreateContext(sessionID, projectDir);
        const toolInput = output.args ?? {};

        // Handle subagent (Task tool)
        if (toolName === "Task") {
          const subagentType = (toolInput as Record<string, unknown>).subagent_type as string ?? "unknown";
          const taskDescription = (toolInput as Record<string, unknown>).description as string ?? "";
          const subagentResult = await handleSubagentStart(ctx, subagentType, taskDescription);
          if (subagentResult.blocked) {
            output.args = { _blocked: true, _reason: subagentResult.blockReason };
            return;
          }
        }

        const result = await handlePreToolUse(ctx, toolName, toolInput);
        if (result.blocked) {
          output.args = { _blocked: true, _reason: result.blockReason };
          return;
        }
        if (result.updatedInput) {
          output.args = { ...toolInput, ...result.updatedInput };
        }
      } catch (err) {
        // ignore
      }
    },

    "tool.execute.after": async (hookInput, output) => {
      try {
        const { tool: toolName, sessionID, args: toolArgs } = hookInput;
        const ctx = sessionContexts.get(sessionID);
        if (!ctx) return;

        const toolInput = (toolArgs as Record<string, unknown>) ?? {};

        // Handle subagent (Task tool)
        if (toolName === "Task") {
          await handleSubagentStop(ctx, "unknown", "", output.output);
        }

        const isError = output.title?.toLowerCase().includes("error") ||
                        output.output?.toLowerCase().startsWith("error");
        if (isError) {
          await handlePostToolUseFailure(ctx, toolName, toolInput, output.output);
        } else {
          await handlePostToolUse(ctx, toolName, toolInput, output.output);
        }
      } catch (err) {
        // ignore
      }
    },

    "chat.message": async (hookInput, _output) => {
      try {
        const { sessionID } = hookInput;
        const ctx = getOrCreateContext(sessionID, projectDir);
        const parts = _output.parts ?? [];
        // Extract text from user message parts for UserPromptSubmit
        const textParts = parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text ?? "")
          .join("\n");
        if (textParts) {
          await handleUserPromptSubmit(ctx, textParts);
        }
      } catch (err) {
        // ignore
      }
    },

    "permission.ask": async (hookInput, output) => {
      try {
        const sessionID = (hookInput as unknown as { sessionID?: string }).sessionID ?? "unknown";
        const ctx = getOrCreateContext(sessionID, projectDir);
        const toolName = (hookInput as unknown as { tool?: string }).tool ?? "unknown";
        const toolArgs = (hookInput as unknown as { args?: Record<string, unknown> }).args ?? {};
        const permissionType = (hookInput as unknown as { permission?: string }).permission ?? "unknown";

        const result = await handlePermissionRequest(ctx, toolName, toolArgs, permissionType);
        if (result.permissionDecision === "allow") {
          output.status = "allow";
        } else if (result.permissionDecision === "deny") {
          output.status = "deny";
        }
      } catch (err) {
        // ignore
      }
    },

    "experimental.session.compacting": async (hookInput, output) => {
      try {
        const { sessionID } = hookInput;
        const ctx = sessionContexts.get(sessionID);
        if (!ctx) return;

        const result = await handlePreCompact(ctx);
        if (result.additionalContext?.length) {
          output.context.push(...result.additionalContext);
        }
      } catch (err) {
        // ignore
      }
    },
  };
};

export default ClaudeCodeHooksPlugin;
