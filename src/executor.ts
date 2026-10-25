import type {
  CommandHook,
  HookConfig,
  HookDefinition,
  HookExecutionResult,
  HookInput,
  HookOutput,
  HooksResult,
  PromptHook,
  PromptHookResult,
} from "./types";
import { matchTool } from "./matchers";

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Execute a command hook with stdin input
 */
async function executeCommandHook(
  hook: CommandHook,
  input: HookInput,
  projectDir: string
): Promise<HookExecutionResult> {
  const timeout = hook.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    // Background mode is the default: spawn and return immediately without waiting for exit.
    // Set background: false to wait for the command to finish.
    if (hook.background !== false) {
      const proc = Bun.spawn(["sh", "-c", hook.command], {
        cwd: projectDir,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
          OPENCODE_COMPAT: "true",
        },
      });
      // Intentionally do not await proc.exited — fire-and-forget.
      void proc;
      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        blocked: false,
      };
    }

    const proc = Bun.spawn(["sh", "-c", hook.command], {
      cwd: projectDir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        OPENCODE_COMPAT: "true",
      },
    });

    // Write input as JSON to stdin
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    // Wait for completion with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Hook timed out")), timeout);
    });

    const exitCode = await Promise.race([proc.exited, timeoutPromise]);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // Exit code 2 means block/deny
    const blocked = exitCode === 2;

    // Try to parse JSON output
    let output: HookOutput | undefined;
    if (stdout.trim()) {
      try {
        output = JSON.parse(stdout.trim());
      } catch {
        // stdout is not JSON, that's fine
      }
    }

    return {
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      output,
      blocked,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: errorMessage,
      blocked: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute a prompt-based hook using the LLM
 */
async function executePromptHook(
  hook: PromptHook,
  input: HookInput,
  client: { chat: (opts: { messages: Array<{ role: string; content: string }> }) => Promise<{ content: string }> }
): Promise<HookExecutionResult> {
  const systemPrompt = `You are a hook evaluator. Analyze the following hook input and decide whether to allow or deny the action.
Respond ONLY with a JSON object in this exact format: {"ok": true, "reason": "explanation"} or {"ok": false, "reason": "explanation"}`;

  const userPrompt = `Hook condition to evaluate:
${hook.prompt}

Hook input:
${JSON.stringify(input, null, 2)}`;

  try {
    const response = await client.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    // Parse the LLM response
    const content = response.content.trim();
    let result: PromptHookResult;

    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch {
      // Default to allowing if we can't parse
      result = { ok: true, reason: "Failed to parse LLM response, defaulting to allow" };
    }

    return {
      success: true,
      exitCode: result.ok ? 0 : 2,
      stdout: JSON.stringify(result),
      stderr: "",
      blocked: !result.ok,
      output: result.ok
        ? undefined
        : {
            continue: false,
            stopReason: result.reason,
          },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: errorMessage,
      blocked: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute a single hook definition
 */
export async function executeHook(
  hook: HookDefinition,
  input: HookInput,
  projectDir: string,
  client?: { chat: (opts: { messages: Array<{ role: string; content: string }> }) => Promise<{ content: string }> }
): Promise<HookExecutionResult> {
  if (hook.type === "command") {
    return executeCommandHook(hook, input, projectDir);
  }

  if (hook.type === "prompt") {
    if (!client) {
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Prompt hooks require an LLM client",
        blocked: false,
        error: "Prompt hooks require an LLM client",
      };
    }
    return executePromptHook(hook, input, client);
  }

  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: `Unknown hook type: ${(hook as HookDefinition).type}`,
    blocked: false,
    error: `Unknown hook type: ${(hook as HookDefinition).type}`,
  };
}

/**
 * Execute all matching hooks for an event
 */
export async function executeHooks(
  hookConfigs: HookConfig[],
  input: HookInput,
  projectDir: string,
  toolName?: string,
  client?: { chat: (opts: { messages: Array<{ role: string; content: string }> }) => Promise<{ content: string }> }
): Promise<HooksResult> {
  const result: HooksResult = {
    blocked: false,
    additionalContext: [],
    errors: [],
  };

  // Ensure hookConfigs is an array
  const configs = Array.isArray(hookConfigs) ? hookConfigs : [];

  // Filter configs that match the tool name (if applicable)
  const matchingConfigs = toolName
    ? configs.filter((config) => matchTool(toolName, config?.matcher))
    : configs;

  // Collect all hooks to execute
  const hooksToExecute: HookDefinition[] = [];
  for (const config of matchingConfigs) {
    const hooks = Array.isArray(config?.hooks) ? config.hooks : [];
    hooksToExecute.push(...hooks);
  }

  if (hooksToExecute.length === 0) {
    return result;
  }

  // Execute all hooks in parallel
  const execResults = await Promise.all(
    hooksToExecute.map((hook) => executeHook(hook, input, projectDir, client))
  );

  // Process results
  for (const execResult of execResults) {
    if (execResult.error) {
      result.errors.push(execResult.error);
    }

    if (execResult.blocked) {
      result.blocked = true;
      result.blockReason =
        execResult.output?.stopReason ?? execResult.stderr ?? "Hook blocked execution";
    }

    // Process hook-specific output
    if (execResult.output?.hookSpecificOutput) {
      const hookOutput = execResult.output.hookSpecificOutput;

      if (hookOutput.permissionDecision) {
        result.permissionDecision = hookOutput.permissionDecision;
        result.permissionDecisionReason = hookOutput.permissionDecisionReason;
      }

      if (hookOutput.updatedInput) {
        result.updatedInput = {
          ...result.updatedInput,
          ...hookOutput.updatedInput,
        };
      }

      if (hookOutput.additionalContext) {
        result.additionalContext?.push(hookOutput.additionalContext);
      }
    }
  }

  return result;
}
