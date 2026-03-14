/**
 * lib/sandbox — Virtual Computer module using E2B.
 *
 * Provides isolated Linux sandboxes (Firecracker microVMs) for AI agent
 * code execution, file management, terminal operations, and desktop control.
 */

export {
    SandboxManager,
    getSandboxManager,
    type SandboxCreateOptions,
    type SandboxInstance,
    type SandboxInfo,
} from "./sandbox-manager";

export {
    CodeExecutor,
    type SupportedLanguage,
    type CodeExecutionOptions,
    type CodeExecutionResult,
    type ExecutionArtifact,
} from "./code-executor";

export {
    FileSystemManager,
    type FileInfo,
    type FileContent,
} from "./filesystem-manager";

export {
    TerminalManager,
    type CommandResult,
    type PackageManager,
    type ProcessInfo,
} from "./terminal-manager";

export {
    DesktopController,
    getDesktopController,
    disposeDesktopController,
    disposeAllDesktopControllers,
    type DesktopCreateOptions,
    type DesktopAction,
    type DesktopState,
} from "./desktop-controller";

export {
    SANDBOX_TOOLS,
    SANDBOX_TOOL_NAMES,
    isSandboxTool,
    getSandboxToolsByCategory,
    type SandboxToolDefinition,
    // Individual schemas
    sandboxExecuteCodeSchema,
    sandboxReadFileSchema,
    sandboxWriteFileSchema,
    sandboxRunCommandSchema,
    sandboxInstallPackageSchema,
    sandboxListFilesSchema,
    sandboxSearchFilesSchema,
    sandboxDeleteFileSchema,
    sandboxDownloadUrlSchema,
    sandboxCreateArchiveSchema,
    sandboxScreenshotSchema,
    sandboxClickSchema,
    sandboxTypeTextSchema,
    sandboxPressKeySchema,
    sandboxScrollDesktopSchema,
    sandboxDragSchema,
    sandboxExposePortSchema,
} from "./sandbox-tools";
