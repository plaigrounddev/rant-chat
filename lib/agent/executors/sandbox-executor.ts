/**
 * Sandbox Executor — Dispatches sandbox tool calls to the E2B virtual computer system.
 *
 * This executor bridges the agent's tool-calling interface with the E2B
 * SandboxManager, CodeExecutor, FileSystemManager, TerminalManager, and
 * DesktopController modules. When the agent invokes a sandbox_* tool, this
 * executor handles:
 * 1. Creating/reusing an E2B sandbox (scoped per session)
 * 2. Routing to the correct module (code, files, terminal, desktop)
 * 3. Executing the action
 * 4. Formatting results for the agent
 *
 * IMPORTANT: Each agent session (task run) gets its own isolated sandbox
 * to prevent cross-session state leakage (filesystem, env vars, processes).
 */

import {
    getSandboxManager,
    CodeExecutor,
    FileSystemManager,
    TerminalManager,
    DesktopController,
    isSandboxTool,
    type SandboxInstance,
} from "../../sandbox";

// ---------------------------------------------------------------------------
// Per-session sandbox state (isolated per task run)
// ---------------------------------------------------------------------------

interface SandboxSession {
    codeExecutor: CodeExecutor;
    fileManager: FileSystemManager;
    terminalManager: TerminalManager;
    sandboxId: string;
}

interface DesktopSession {
    controller: DesktopController;
}

/** Map of sessionId → sandbox state. Each task run gets its own sandbox. */
const sandboxSessions: Map<string, SandboxSession> = new Map();
const desktopSessions: Map<string, DesktopSession> = new Map();

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a sandbox tool call, scoped to a session.
 *
 * @param toolName - The sandbox tool name (e.g., "sandbox_execute_code")
 * @param args - The parsed tool arguments
 * @param sessionId - Unique session/task ID for isolation (required)
 * @returns A string result for the agent
 */
export async function executeSandboxTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string
): Promise<string> {
    if (!isSandboxTool(toolName)) {
        return JSON.stringify({ error: `Unknown sandbox tool: ${toolName}` });
    }

    // Use a default session if none provided (single-user fallback)
    const sid = sessionId || "__default__";

    try {
        // Desktop tools use a separate sandbox
        if (toolName.startsWith("sandbox_screenshot") ||
            toolName === "sandbox_click" ||
            toolName === "sandbox_type_text" ||
            toolName === "sandbox_press_key" ||
            toolName === "sandbox_scroll_desktop" ||
            toolName === "sandbox_drag") {
            return executeDesktopTool(toolName, args, sid);
        }

        // Ensure we have an active sandbox for this session
        const session = await ensureSandboxConnection(sid);

        // Dispatch to the correct handler
        switch (toolName) {
            // ------- Code Execution -------
            case "sandbox_execute_code": {
                const result = await session.codeExecutor.executeCode(args.code as string, {
                    language: (args.language as "python" | "javascript" | "bash") ?? "python",
                    variables: args.variables as Record<string, unknown> | undefined,
                });
                return JSON.stringify({
                    success: result.success,
                    stdout: result.stdout.slice(0, 10000),
                    stderr: result.stderr.slice(0, 5000),
                    error: result.error,
                    artifacts: result.artifacts.map((a) => ({
                        type: a.type,
                        mimeType: a.mimeType,
                        data: a.data,
                        filename: a.filename,
                    })),
                    durationMs: result.durationMs,
                });
            }

            // ------- File Operations -------
            case "sandbox_read_file": {
                const content = await session.fileManager.readFile(args.path as string);
                return JSON.stringify({
                    success: true,
                    path: content.path,
                    content: content.content.slice(0, 20000), // Limit for context
                    size: content.size,
                });
            }

            case "sandbox_write_file": {
                await session.fileManager.writeFile(args.path as string, args.content as string);
                return JSON.stringify({
                    success: true,
                    action: "file_written",
                    path: args.path,
                    size: (args.content as string).length,
                });
            }

            case "sandbox_list_files": {
                const files = await session.fileManager.listDirectory(
                    (args.path as string) ?? "/home/user"
                );
                return JSON.stringify({
                    success: true,
                    files,
                    total: files.length,
                });
            }

            case "sandbox_search_files": {
                const results = await session.fileManager.searchFiles(
                    (args.directory as string) ?? "/home/user",
                    args.pattern as string
                );
                return JSON.stringify({
                    success: true,
                    matches: results,
                    total: results.length,
                });
            }

            case "sandbox_delete_file": {
                await session.fileManager.delete(
                    args.path as string,
                    (args.recursive as boolean) ?? false
                );
                return JSON.stringify({
                    success: true,
                    action: "deleted",
                    path: args.path,
                });
            }

            case "sandbox_create_archive": {
                await session.fileManager.createArchive(
                    args.outputPath as string,
                    args.sourcePaths as string[]
                );
                return JSON.stringify({
                    success: true,
                    action: "archive_created",
                    path: args.outputPath,
                });
            }

            // ------- Terminal / Shell -------
            case "sandbox_run_command": {
                const result = await session.terminalManager.runCommand(args.command as string, {
                    cwd: args.cwd as string | undefined,
                    timeoutMs: (args.timeoutMs as number) ?? 30000,
                });
                return JSON.stringify({
                    success: result.success,
                    exitCode: result.exitCode,
                    stdout: result.stdout.slice(0, 10000),
                    stderr: result.stderr.slice(0, 5000),
                    durationMs: result.durationMs,
                });
            }

            case "sandbox_install_package": {
                const result = await session.terminalManager.installPackages(
                    args.manager as "pip" | "npm" | "apt",
                    args.packages as string[]
                );
                return JSON.stringify({
                    success: result.success,
                    stdout: result.stdout.slice(0, 5000),
                    stderr: result.stderr.slice(0, 2000),
                });
            }

            case "sandbox_download_url": {
                const result = await session.terminalManager.downloadUrl(
                    args.url as string,
                    args.destPath as string
                );
                return JSON.stringify({
                    success: result.success,
                    action: "downloaded",
                    destPath: args.destPath,
                    stderr: result.stderr || undefined,
                });
            }

            default:
                return JSON.stringify({ error: `Unhandled sandbox tool: ${toolName}` });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[SandboxExecutor] Error executing ${toolName} (session=${sid}):`, message);
        return JSON.stringify({
            success: false,
            error: message,
            tool: toolName,
        });
    }
}

// ---------------------------------------------------------------------------
// Desktop Tool Execution (per-session)
// ---------------------------------------------------------------------------

async function executeDesktopTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId: string
): Promise<string> {
    try {
        let session = desktopSessions.get(sessionId);
        if (!session) {
            const controller = new DesktopController();
            session = { controller };
            desktopSessions.set(sessionId, session);
        }
        if (!session.controller.isActive()) {
            await session.controller.createDesktop();
        }

        switch (toolName) {
            case "sandbox_screenshot": {
                const screenshot = await session.controller.screenshot();
                return JSON.stringify({
                    success: true,
                    screenshotBase64: screenshot,
                    format: "png",
                });
            }

            case "sandbox_click": {
                const clickType = (args.type as string) ?? "left";
                switch (clickType) {
                    case "right":
                        await session.controller.rightClick(args.x as number, args.y as number);
                        break;
                    case "double":
                        await session.controller.doubleClick(args.x as number, args.y as number);
                        break;
                    case "middle":
                        await session.controller.middleClick(args.x as number, args.y as number);
                        break;
                    default:
                        await session.controller.leftClick(args.x as number, args.y as number);
                }
                return JSON.stringify({
                    success: true,
                    action: "clicked",
                    x: args.x,
                    y: args.y,
                    type: clickType,
                });
            }

            case "sandbox_type_text": {
                await session.controller.type(args.text as string);
                return JSON.stringify({ success: true, action: "typed" });
            }

            case "sandbox_press_key": {
                await session.controller.press(args.key as string);
                return JSON.stringify({ success: true, action: "key_pressed", key: args.key });
            }

            case "sandbox_scroll_desktop": {
                await session.controller.scroll(
                    (args.direction as "up" | "down") ?? "down",
                    (args.ticks as number) ?? 3
                );
                return JSON.stringify({ success: true, action: "scrolled" });
            }

            case "sandbox_drag": {
                await session.controller.drag(
                    [args.startX as number, args.startY as number],
                    [args.endX as number, args.endY as number]
                );
                return JSON.stringify({ success: true, action: "dragged" });
            }

            default:
                return JSON.stringify({ error: `Unhandled desktop tool: ${toolName}` });
        }
    } catch (error) {
        return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

// ---------------------------------------------------------------------------
// Connection Management (per-session)
// ---------------------------------------------------------------------------

async function ensureSandboxConnection(sessionId: string): Promise<SandboxSession> {
    const existing = sandboxSessions.get(sessionId);
    if (existing) return existing;

    const manager = getSandboxManager();
    let instance: SandboxInstance;

    // Always create a new sandbox for a new session — no cross-session reuse
    instance = await manager.createSandbox({
        timeoutMs: 10 * 60 * 1000,
        metadata: { sessionId },
    });

    const session: SandboxSession = {
        codeExecutor: new CodeExecutor(instance.sandbox),
        fileManager: new FileSystemManager(instance.sandbox),
        terminalManager: new TerminalManager(instance.sandbox),
        sandboxId: instance.id,
    };

    sandboxSessions.set(sessionId, session);
    console.log(`[SandboxExecutor] New sandbox session: ${sessionId} → sandbox ${instance.id}`);
    return session;
}

/**
 * Clean up a specific session's sandbox resources.
 * Call this when a task run completes.
 */
export async function cleanupSandboxSession(sessionId: string): Promise<void> {
    const session = sandboxSessions.get(sessionId);
    if (session) {
        const manager = getSandboxManager();
        await manager.killSandbox(session.sandboxId);
        sandboxSessions.delete(sessionId);
    }

    const desktop = desktopSessions.get(sessionId);
    if (desktop) {
        await desktop.controller.kill();
        desktopSessions.delete(sessionId);
    }

    console.log(`[SandboxExecutor] Cleaned up session: ${sessionId}`);
}

/**
 * Clean up ALL sandbox resources. Call during shutdown.
 */
export async function cleanupSandboxExecutor(): Promise<void> {
    const sids = Array.from(sandboxSessions.keys());
    for (const sid of sids) {
        await cleanupSandboxSession(sid);
    }

    const manager = getSandboxManager();
    await manager.killAll();
}
