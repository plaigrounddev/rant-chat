/**
 * TerminalManager — Shell command execution inside E2B sandboxes.
 *
 * Like Manus's shell_exec tool — execute commands, install packages,
 * manage processes. Provides the agent with a full Linux terminal.
 */

import type { Sandbox } from "@e2b/code-interpreter";
import { shellEscape } from "./filesystem-manager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandResult {
    /** Exit code (0 = success) */
    exitCode: number;
    /** Standard output */
    stdout: string;
    /** Standard error */
    stderr: string;
    /** Whether the command succeeded */
    success: boolean;
    /** Execution duration in milliseconds */
    durationMs: number;
}

export type PackageManager = "pip" | "npm" | "apt";

export interface ProcessInfo {
    pid: string;
    command: string;
    cpu: string;
    memory: string;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class TerminalManager {
    private persistentEnvs: Map<string, string> = new Map();

    constructor(private sandbox: Sandbox) { }

    /**
     * Execute a shell command and return the result.
     */
    async runCommand(
        command: string,
        options?: { timeoutMs?: number; cwd?: string }
    ): Promise<CommandResult> {
        const startTime = Date.now();
        const timeoutMs = options?.timeoutMs ?? 30000;

        try {
            // Prepend persistent env exports
            let envPrefix = "";
            if (this.persistentEnvs.size > 0) {
                const exports = Array.from(this.persistentEnvs.entries())
                    .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
                    .join(" && ");
                envPrefix = exports + " && ";
            }

            // Wrap with cd if cwd is specified
            const fullCommand = options?.cwd
                ? `${envPrefix}cd ${shellEscape(options.cwd)} && ${command}`
                : `${envPrefix}${command}`;

            const result = await this.sandbox.commands.run(fullCommand, {
                timeoutMs,
            });

            return {
                exitCode: result.exitCode,
                stdout: result.stdout.trim(),
                stderr: result.stderr.trim(),
                success: result.exitCode === 0,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            return {
                exitCode: -1,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
                success: false,
                durationMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Install packages using a package manager.
     */
    async installPackages(
        manager: PackageManager,
        packages: string[]
    ): Promise<CommandResult> {
        const packageList = packages.map((p) => shellEscape(p)).join(" ");

        const commands: Record<PackageManager, string> = {
            pip: `pip install ${packageList}`,
            npm: `npm install ${packageList}`,
            apt: `apt-get update && apt-get install -y ${packageList}`,
        };

        const command = commands[manager];
        if (!command) {
            throw new Error(`Unsupported package manager: ${manager}`);
        }

        console.log(
            `[TerminalManager] Installing packages via ${manager}: ${packageList}`
        );

        return this.runCommand(command, { timeoutMs: 120000 }); // 2 minute timeout for installs
    }

    /**
     * Start a background process.
     * Returns the PID of the started process.
     */
    async startProcess(command: string): Promise<string> {
        const result = await this.runCommand(
            `nohup ${command} > /tmp/process_output.log 2>&1 & echo $!`
        );

        if (!result.success) {
            throw new Error(`Failed to start process: ${result.stderr}`);
        }

        const pid = result.stdout.trim();
        console.log(`[TerminalManager] Started background process: PID ${pid}`);
        return pid;
    }

    /**
     * Stop a running process by PID.
     */
    async stopProcess(pid: string): Promise<void> {
        if (!/^\d+$/.test(pid)) {
            throw new Error(`Invalid PID: ${pid}`);
        }
        await this.runCommand(`kill -9 ${pid} 2>/dev/null || true`);
        console.log(`[TerminalManager] Stopped process: PID ${pid}`);
    }

    /**
     * List running processes.
     */
    async listProcesses(): Promise<ProcessInfo[]> {
        const result = await this.runCommand(
            `ps aux --sort=-%mem | head -20`
        );

        if (!result.success) return [];

        const lines = result.stdout.split("\n").slice(1); // Skip header
        return lines
            .filter((line) => line.trim())
            .map((line) => {
                const parts = line.trim().split(/\s+/);
                return {
                    pid: parts[1],
                    cpu: parts[2],
                    memory: parts[3],
                    command: parts.slice(10).join(" "),
                };
            });
    }

    /**
     * Check if a command/tool is available in the sandbox.
     */
    async hasCommand(command: string): Promise<boolean> {
        const result = await this.runCommand(`which ${shellEscape(command)} 2>/dev/null`);
        return result.success;
    }

    /**
     * Get the current working directory.
     */
    async getCwd(): Promise<string> {
        const result = await this.runCommand("pwd");
        return result.stdout.trim();
    }

    /**
     * Get system information (OS, memory, disk, etc.).
     */
    async getSystemInfo(): Promise<string> {
        const result = await this.runCommand(
            `echo "=== OS ===" && cat /etc/os-release 2>/dev/null | head -3 && echo "" && echo "=== Memory ===" && free -h 2>/dev/null | head -2 && echo "" && echo "=== Disk ===" && df -h / 2>/dev/null | head -2 && echo "" && echo "=== Python ===" && python3 --version 2>/dev/null && echo "=== Node ===" && node --version 2>/dev/null`
        );
        return result.stdout;
    }

    /**
     * Download a file from a URL into the sandbox.
     */
    async downloadUrl(url: string, destPath: string): Promise<CommandResult> {
        return this.runCommand(
            `curl -fsSL -o ${shellEscape(destPath)} ${shellEscape(url)}`,
            { timeoutMs: 60000 }
        );
    }

    /**
     * Set environment variables that persist across commands.
     * Stored locally and prepended to each command execution.
     */
    async setEnvironmentVariable(
        key: string,
        value: string
    ): Promise<void> {
        this.persistentEnvs.set(key, value);
        console.log(`[TerminalManager] Environment variable set: ${key}`);
    }
}
