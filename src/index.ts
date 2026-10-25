/**
 * OpenCode Plugin: Claude Code Hooks Compatibility
 * V2 implementation
 */

import { Plugin } from "@opencode/plugin";
import type { PluginContext } from "./types";
import { handleSessionStart, handleSessionEnd } from "./handlers/session";
import { handlePreToolUse, handlePostToolUse, handlePostToolUseFailure } from "./handlers/tool";
import { handlePermissionRequest } from "./handlers/permission";
import { handlePreCompact } from "./handlers/compact";
import { handleSubagentStart, handleSubagentStop } from "./handlers/subagent";

class HookBlockedError extends Error {}

const sessionContexts = new Map<string, PluginContext>();

function getOrCreateContext(sessionId: string, cwd: string): PluginContext {
  let ctx = sessionContexts.get(sessionId);
  if (!ctx) {
    ctx = { sessionId, cwd, permissionMode: "default", transcriptPath: "" };
    sessionContexts.set(sessionId, ctx);
  }
  return ctx;
}

function extractToolOutput(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  const r = result as { content?: unknown; output?: unknown };
  if (typeof r.content === "string") return r.content;
  if (Array.isArray(r.content)) {
    return r.content
      .map((part) => {
        if (part && typeof part === "object" && "type" in part && (part as { type: string }).type === "text") {
          return String((part as { text?: unknown }).text ?? "");
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (typeof r.output === "string") return r.output;
  if (r.output !== undefined) return String(r.output);
  return JSON.stringify(result);
}

export default Plugin.define({
  id: "opencode-claude-hooks",
  async setup(ctx) {
    const projectDir = ctx.location?.directory || process.cwd();

    // Session lifecycle via event stream
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type === "session.created") {
            const sessionId = (event as { data?: { sessionID?: string } }).data?.sessionID ?? "unknown";
            const pluginCtx = getOrCreateContext(sessionId, projectDir);
            await handleSessionStart(pluginCtx, false);
          } else if (event.type === "session.deleted") {
            const sessionId = (event as { data?: { sessionID?: string } }).data?.sessionID ?? "unknown";
            const pluginCtx = sessionContexts.get(sessionId);
            if (pluginCtx) {
              await handleSessionEnd(pluginCtx);
              sessionContexts.delete(sessionId);
            }
          }
        }
      } catch {
        // ignore
      }
    })();

    // Tool execution before
    await ctx.tool.hook("execute.before", async (event) => {
      try {
        const toolName = (event as { tool?: string }).tool ?? "unknown";
        const sessionID = (event as { sessionID?: string }).sessionID ?? "unknown";
        const pluginCtx = getOrCreateContext(sessionID, projectDir);
        const toolInput = ((event as { input?: unknown }).input ?? {}) as Record<string, unknown>;

        // Subagent (Task tool)
        if (toolName === "Task" || toolName === "task") {
          const subagentType = (toolInput as Record<string, unknown>).subagent_type as string ?? "unknown";
          const taskDescription = (toolInput as Record<string, unknown>).description as string ?? "";
          const subagentResult = await handleSubagentStart(pluginCtx, subagentType, taskDescription);
          if (subagentResult.blocked) {
            throw new HookBlockedError(subagentResult.blockReason ?? "Blocked by hook");
          }
        }

        const result = await handlePreToolUse(pluginCtx, toolName, toolInput);
        if (result.blocked) {
          throw new HookBlockedError(result.blockReason ?? "Blocked by hook");
        }
        if (result.updatedInput) {
          (event as { input?: unknown }).input = { ...toolInput, ...result.updatedInput };
        }
      } catch (err) {
        if (err instanceof HookBlockedError) throw err;
        // swallow other errors
      }
    });

    // Tool execution after
    await ctx.tool.hook("execute.after", async (event) => {
      try {
        const toolName = (event as { tool?: string }).tool ?? "unknown";
        const sessionID = (event as { sessionID?: string }).sessionID ?? "unknown";
        const pluginCtx = sessionContexts.get(sessionID);
        if (!pluginCtx) return;

        if (toolName === "Task" || toolName === "task") {
          await handleSubagentStop(pluginCtx, "unknown", "", extractToolOutput((event as { result?: unknown }).result ?? (event as { output?: unknown }).output));
        }

        const status = (event as { status?: string }).status;
        const isError = status === "error";
        const toolInput = ((event as { input?: unknown }).input ?? {}) as Record<string, unknown>;

        if (isError) {
          const err = (event as { error?: unknown }).error;
          const errText = err instanceof Error ? err.message : String(err ?? "");
          await handlePostToolUseFailure(pluginCtx, toolName, toolInput, errText);
        } else {
          const result = (event as { result?: unknown }).result ?? (event as { output?: unknown }).output;
          const outputText = extractToolOutput(result);
          await handlePostToolUse(pluginCtx, toolName, toolInput, outputText);
        }
      } catch {
        // ignore
      }
    });

    // Permission evaluation
    await ctx.permission.hook("evaluate", async (event) => {
      try {
        const sessionID = (event as { sessionID?: string }).sessionID ?? "unknown";
        const pluginCtx = getOrCreateContext(sessionID, projectDir);
        const action = (event as { action?: string }).action ?? "unknown";
        const toolArgs = (event as { metadata?: Record<string, unknown> }).metadata ?? {};
        const args = (toolArgs && typeof toolArgs === "object" && "args" in toolArgs) ? (toolArgs as { args?: Record<string, unknown> }).args ?? {} : {};
        const permissionType = action;

        const result = await handlePermissionRequest(pluginCtx, action, args, permissionType);
        if (result.permissionDecision === "allow") {
          (event as { effect?: string }).effect = "allow";
        } else if (result.permissionDecision === "deny") {
          (event as { effect?: string }).effect = "deny";
          if (result.permissionDecisionReason) {
            (event as { message?: string }).message = result.permissionDecisionReason;
          }
        }
      } catch {
        // ignore
      }
    });

    // Compaction
    await ctx.session.hook("compaction", async (event) => {
      try {
        const sessionID = (event as { sessionID?: string }).sessionID ?? "unknown";
        const pluginCtx = sessionContexts.get(sessionID);
        if (!pluginCtx) return;

        const result = await handlePreCompact(pluginCtx);
        if (result.additionalContext?.length) {
          const system = (event as { system?: Array<{ type: string; text: string }> }).system;
          if (Array.isArray(system)) {
            for (const c of result.additionalContext) {
              system.push({ type: "text", text: c });
            }
          }
        }
      } catch {
        // ignore
      }
    });

    return () => controller.abort();
  },
});