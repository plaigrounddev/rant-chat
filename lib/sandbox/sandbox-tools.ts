/**
 * SandboxToolDefinitions — JSON schema tool definitions for the agent.
 *
 * These are the tools the AI agent can invoke to interact with E2B sandboxes
 * for code execution, file management, terminal operations, and desktop control.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Tool Schemas (Zod)
// ---------------------------------------------------------------------------

export const sandboxExecuteCodeSchema = z.object({
    language: z
        .enum(["python", "javascript", "bash"])
        .default("python")
        .describe("Programming language to execute"),
    code: z.string().describe("The source code to run"),
    variables: z
        .record(z.unknown())
        .optional()
        .describe("Optional input variables to inject into the code environment"),
});

export const sandboxReadFileSchema = z.object({
    path: z.string().describe("Absolute path of the file to read in the sandbox"),
});

export const sandboxWriteFileSchema = z.object({
    path: z
        .string()
        .describe("Absolute path where the file should be written in the sandbox"),
    content: z.string().describe("Content to write to the file"),
});

export const sandboxRunCommandSchema = z.object({
    command: z.string().describe("Shell command to execute"),
    cwd: z
        .string()
        .optional()
        .describe("Working directory for the command"),
    timeoutMs: z
        .number()
        .optional()
        .default(30000)
        .describe("Command timeout in milliseconds (default: 30000)"),
});

export const sandboxInstallPackageSchema = z.object({
    manager: z
        .enum(["pip", "npm", "apt"])
        .describe("Package manager to use"),
    packages: z
        .array(z.string())
        .describe("List of package names to install"),
});

export const sandboxListFilesSchema = z.object({
    path: z
        .string()
        .default("/home/user")
        .describe("Directory path to list (default: /home/user)"),
});

export const sandboxSearchFilesSchema = z.object({
    directory: z
        .string()
        .default("/home/user")
        .describe("Directory to search in"),
    pattern: z.string().describe("Glob pattern to match file names (e.g., *.py, *.csv)"),
});

export const sandboxDeleteFileSchema = z.object({
    path: z.string().describe("Path to delete"),
    recursive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to delete directories recursively"),
});

export const sandboxDownloadUrlSchema = z.object({
    url: z.string().url().describe("URL to download"),
    destPath: z
        .string()
        .describe("Destination path in the sandbox for the downloaded file"),
});

export const sandboxCreateArchiveSchema = z.object({
    outputPath: z.string().describe("Output path for the zip archive"),
    sourcePaths: z
        .array(z.string())
        .describe("Files/directories to include in the archive"),
});

// Desktop / Computer Use tools
export const sandboxScreenshotSchema = z.object({}).describe(
    "Capture a screenshot of the desktop"
);

export const sandboxClickSchema = z.object({
    x: z.number().describe("X coordinate to click"),
    y: z.number().describe("Y coordinate to click"),
    type: z
        .enum(["left", "right", "double", "middle"])
        .default("left")
        .describe("Click type"),
});

export const sandboxTypeTextSchema = z.object({
    text: z.string().describe("Text to type on the desktop"),
});

export const sandboxPressKeySchema = z.object({
    key: z
        .string()
        .describe('Key to press (e.g., "Enter", "Tab", "Escape", "ctrl+c")'),
});

export const sandboxScrollDesktopSchema = z.object({
    direction: z.enum(["up", "down"]).describe("Scroll direction"),
    ticks: z
        .number()
        .optional()
        .default(3)
        .describe("Number of scroll ticks"),
});

export const sandboxDragSchema = z.object({
    startX: z.number().describe("Start X coordinate"),
    startY: z.number().describe("Start Y coordinate"),
    endX: z.number().describe("End X coordinate"),
    endY: z.number().describe("End Y coordinate"),
});

export const sandboxExposePortSchema = z.object({
    port: z
        .number()
        .describe(
            "Local port number running in the sandbox to expose publicly (e.g., 3000, 5173, 8080)"
        ),
});

// ---------------------------------------------------------------------------
// Tool Definitions for Agent Registration
// ---------------------------------------------------------------------------

export interface SandboxToolDefinition {
    name: string;
    description: string;
    schema: z.ZodType;
    category: "code" | "file" | "terminal" | "desktop" | "deploy";
}

export const SANDBOX_TOOLS: SandboxToolDefinition[] = [
    // Code Execution
    {
        name: "sandbox_execute_code",
        description:
            "Execute Python, JavaScript, or Bash code in a secure sandbox. Supports stateful execution (variables persist across calls), matplotlib chart generation, and data analysis. Use this for calculations, data processing, API calls, and generating visualizations.",
        schema: sandboxExecuteCodeSchema,
        category: "code",
    },

    // File Operations
    {
        name: "sandbox_read_file",
        description:
            "Read the contents of a file from the sandbox filesystem. Use this to read data files, check code output, or inspect generated artifacts.",
        schema: sandboxReadFileSchema,
        category: "file",
    },
    {
        name: "sandbox_write_file",
        description:
            "Write content to a file in the sandbox filesystem. Creates parent directories automatically. Use this to save data, create scripts, or generate documents.",
        schema: sandboxWriteFileSchema,
        category: "file",
    },
    {
        name: "sandbox_list_files",
        description:
            "List the contents of a directory in the sandbox. Shows file names, types, and sizes.",
        schema: sandboxListFilesSchema,
        category: "file",
    },
    {
        name: "sandbox_search_files",
        description:
            "Search for files matching a glob pattern in the sandbox filesystem.",
        schema: sandboxSearchFilesSchema,
        category: "file",
    },
    {
        name: "sandbox_delete_file",
        description:
            "Delete a file or directory from the sandbox filesystem.",
        schema: sandboxDeleteFileSchema,
        category: "file",
    },
    {
        name: "sandbox_create_archive",
        description:
            "Create a zip archive of files/directories in the sandbox. Useful for packaging results to share.",
        schema: sandboxCreateArchiveSchema,
        category: "file",
    },

    // Terminal / Shell
    {
        name: "sandbox_run_command",
        description:
            "Execute a shell command in the sandbox terminal. Use for system operations, running scripts, managing processes, git operations, or any command-line task.",
        schema: sandboxRunCommandSchema,
        category: "terminal",
    },
    {
        name: "sandbox_install_package",
        description:
            "Install packages using pip (Python), npm (Node.js), or apt (system). Use when you need a library that isn't pre-installed.",
        schema: sandboxInstallPackageSchema,
        category: "terminal",
    },
    {
        name: "sandbox_download_url",
        description:
            "Download a file from a URL into the sandbox. Use for fetching datasets, images, or other resources from the internet.",
        schema: sandboxDownloadUrlSchema,
        category: "terminal",
    },

    // Desktop / Computer Use
    {
        name: "sandbox_screenshot",
        description:
            "Capture a screenshot of the desktop sandbox. Returns a base64-encoded PNG image. Use for visual verification or to see the current state of a GUI application.",
        schema: sandboxScreenshotSchema,
        category: "desktop",
    },
    {
        name: "sandbox_click",
        description:
            "Click at specific coordinates on the desktop. Supports left, right, double, and middle click.",
        schema: sandboxClickSchema,
        category: "desktop",
    },
    {
        name: "sandbox_type_text",
        description:
            "Type text on the desktop. The text is typed at the current cursor position.",
        schema: sandboxTypeTextSchema,
        category: "desktop",
    },
    {
        name: "sandbox_press_key",
        description:
            'Press a keyboard key on the desktop. Supports key combinations like "ctrl+c", "alt+f4".',
        schema: sandboxPressKeySchema,
        category: "desktop",
    },
    {
        name: "sandbox_scroll_desktop",
        description:
            "Scroll up or down on the desktop at the current cursor position.",
        schema: sandboxScrollDesktopSchema,
        category: "desktop",
    },
    {
        name: "sandbox_drag",
        description:
            "Drag from one position to another on the desktop. Use for drag-and-drop operations.",
        schema: sandboxDragSchema,
        category: "desktop",
    },

    // Deploy / Port Exposure
    {
        name: "sandbox_expose_port",
        description:
            "Expose a local port from the sandbox for temporary public access. Use this after starting a dev server (e.g., npm run dev on port 3000) to get a public URL that the user can view in the preview panel. Returns a public hostname URL.",
        schema: sandboxExposePortSchema,
        category: "deploy",
    },
];

/**
 * Get all sandbox tool names for quick lookup.
 */
export const SANDBOX_TOOL_NAMES = new Set(SANDBOX_TOOLS.map((t) => t.name));

/**
 * Check if a tool name is a sandbox tool.
 */
export function isSandboxTool(name: string): boolean {
    return SANDBOX_TOOL_NAMES.has(name);
}

/**
 * Get sandbox tools filtered by category.
 */
export function getSandboxToolsByCategory(
    category: SandboxToolDefinition["category"]
): SandboxToolDefinition[] {
    return SANDBOX_TOOLS.filter((t) => t.category === category);
}
