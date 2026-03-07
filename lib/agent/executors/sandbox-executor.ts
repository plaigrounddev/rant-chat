/**
 * Sandbox Executor — Dispatches sandbox tool calls to the E2B virtual computer system.
 *
 * This executor bridges the agent's tool-calling interface with the E2B
 * SandboxManager, CodeExecutor, FileSystemManager, TerminalManager, and
 * DesktopController modules. When the agent invokes a sandbox_* tool, this
 * executor handles:
 * 1. Creating/reusing an E2B sandbox
 * 2. Routing to the correct module (code, files, terminal, desktop)
 * 3. Executing the action
 * 4. Formatting results for the agent
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
// State
// ---------------------------------------------------------------------------

let codeExecutor: CodeExecutor | null = null;
let fileManager: FileSystemManager | null = null;
let terminalManager: TerminalManager | null = null;
let desktopController: DesktopController | null = null;
let currentSandboxId: string | null = null;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a sandbox tool call.
 *
 * @param toolName - The sandbox tool name (e.g., "sandbox_execute_code")
 * @param args - The parsed tool arguments
 * @returns A string result for the agent
 */
export async function executeSandboxTool(
    toolName: string,
    args: Record<string, unknown>
): Promise<string> {
    if (!isSandboxTool(toolName)) {
        return JSON.stringify({ error: `Unknown sandbox tool: ${toolName}` });
    }

    try {
        // Desktop tools use a separate sandbox
        if (toolName.startsWith("sandbox_screenshot") ||
            toolName === "sandbox_click" ||
            toolName === "sandbox_type_text" ||
            toolName === "sandbox_press_key" ||
            toolName === "sandbox_scroll_desktop" ||
            toolName === "sandbox_drag") {
            return executeDesktopTool(toolName, args);
        }

        // Ensure we have an active sandbox for code/file/terminal tools
        await ensureSandboxConnection();

        // Dispatch to the correct handler
        switch (toolName) {
            // ------- Code Execution -------
            case "sandbox_execute_code": {
                if (!codeExecutor) {
                    return JSON.stringify({ error: "Code executor not initialized" });
                }
                const result = await codeExecutor.executeCode(args.code as string, {
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
                        filename: a.filename,
                        dataPreview: a.data.slice(0, 100) + "...",
                    })),
                    durationMs: result.durationMs,
                });
            }

            // ------- File Operations -------
            case "sandbox_read_file": {
                if (!fileManager) {
                    return JSON.stringify({ error: "File manager not initialized" });
                }
                const content = await fileManager.readFile(args.path as string);
                return JSON.stringify({
                    success: true,
                    path: content.path,
                    content: content.content.slice(0, 20000), // Limit for context
                    size: content.size,
                });
            }

            case "sandbox_write_file": {
                if (!fileManager) {
                    return JSON.stringify({ error: "File manager not initialized" });
                }
                await fileManager.writeFile(args.path as string, args.content as string);
                return JSON.stringify({
                    success: true,
                    action: "file_written",
                    path: args.path,
                    size: (args.content as string).length,
                });
            }

            case "sandbox_list_files": {
                if (!fileManager) {
                    return JSON.stringify({ error: "File manager not initialized" });
                }
                const files = await fileManager.listDirectory(
                    (args.path as string) ?? "/home/user"
                );
                return JSON.stringify({
                    success: true,
                    files,
                    total: files.length,
                });
            }

            case "sandbox_search_files": {
                if (!fileManager) {
                    return JSON.stringify({ error: "File manager not initialized" });
                }
                const results = await fileManager.searchFiles(
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
                if (!fileManager) {
                    return JSON.stringify({ error: "File manager not initialized" });
                }
                await fileManager.delete(
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
                if (!fileManager) {
                    return JSON.stringify({ error: "File manager not initialized" });
                }
                await fileManager.createArchive(
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
                if (!terminalManager) {
                    return JSON.stringify({ error: "Terminal manager not initialized" });
                }
                const result = await terminalManager.runCommand(args.command as string, {
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
                if (!terminalManager) {
                    return JSON.stringify({ error: "Terminal manager not initialized" });
                }
                const result = await terminalManager.installPackages(
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
                if (!terminalManager) {
                    return JSON.stringify({ error: "Terminal manager not initialized" });
                }
                const result = await terminalManager.downloadUrl(
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
        console.error(`[SandboxExecutor] Error executing ${toolName}:`, message);
        return JSON.stringify({
            success: false,
            error: message,
            tool: toolName,
        });
    }
}

// ---------------------------------------------------------------------------
// Desktop Tool Execution (separate sandbox)
// ---------------------------------------------------------------------------

async function executeDesktopTool(
    toolName: string,
    args: Record<string, unknown>
): Promise<string> {
    try {
        if (!desktopController) {
            desktopController = new DesktopController();
        }
        if (!desktopController.isActive()) {
            await desktopController.createDesktop();
        }

        switch (toolName) {
            case "sandbox_screenshot": {
                const screenshot = await desktopController.screenshot();
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
                        await desktopController.rightClick(args.x as number, args.y as number);
                        break;
                    case "double":
                        await desktopController.doubleClick(args.x as number, args.y as number);
                        break;
                    case "middle":
                        await desktopController.middleClick(args.x as number, args.y as number);
                        break;
                    default:
                        await desktopController.leftClick(args.x as number, args.y as number);
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
                await desktopController.type(args.text as string);
                return JSON.stringify({ success: true, action: "typed" });
            }

            case "sandbox_press_key": {
                await desktopController.press(args.key as string);
                return JSON.stringify({ success: true, action: "key_pressed", key: args.key });
            }

            case "sandbox_scroll_desktop": {
                await desktopController.scroll(
                    (args.direction as "up" | "down") ?? "down",
                    (args.ticks as number) ?? 3
                );
                return JSON.stringify({ success: true, action: "scrolled" });
            }

            case "sandbox_drag": {
                await desktopController.drag(
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
// Connection Management
// ---------------------------------------------------------------------------

async function ensureSandboxConnection(): Promise<void> {
    if (codeExecutor && fileManager && terminalManager) return;

    const manager = getSandboxManager();
    let instance: SandboxInstance;

    if (currentSandboxId) {
        const existing = manager.getSandbox(currentSandboxId);
        if (existing && existing.status === "running") {
            instance = existing;
        } else {
            instance = await manager.createSandbox({ timeoutMs: 10 * 60 * 1000 });
            currentSandboxId = instance.id;
        }
    } else {
        instance = await manager.getOrCreateSandbox({ timeoutMs: 10 * 60 * 1000 });
        currentSandboxId = instance.id;
    }

    codeExecutor = new CodeExecutor(instance.sandbox);
    fileManager = new FileSystemManager(instance.sandbox);
    terminalManager = new TerminalManager(instance.sandbox);
}

/**
 * Clean up all sandbox resources. Call during shutdown.
 */
export async function cleanupSandboxExecutor(): Promise<void> {
    codeExecutor = null;
    fileManager = null;
    terminalManager = null;
    currentSandboxId = null;

    if (desktopController) {
        await desktopController.kill();
        desktopController = null;
    }

    const manager = getSandboxManager();
    await manager.killAll();
}
