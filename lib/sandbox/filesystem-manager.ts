/**
 * FileSystemManager — File operations inside E2B sandboxes.
 *
 * Like Manus's file_read/file_write tools — read, write, search, upload,
 * and download files within the sandboxed Linux filesystem.
 */

import type { Sandbox } from "@e2b/code-interpreter";

// ---------------------------------------------------------------------------
// Shell Escaping Utility
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use in shell commands.
 * Uses single quotes and escapes embedded single quotes.
 */
export function shellEscape(str: string): string {
    return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileInfo {
    name: string;
    path: string;
    type: "file" | "directory";
    size?: number;
}

export interface FileContent {
    path: string;
    content: string;
    encoding: "utf-8" | "base64";
    size: number;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class FileSystemManager {
    constructor(private sandbox: Sandbox) { }

    /**
     * Read a file from the sandbox.
     */
    async readFile(path: string): Promise<FileContent> {
        try {
            const content = await this.sandbox.files.read(path);
            const contentStr = typeof content === "string" ? content : String(content);
            return {
                path,
                content: contentStr,
                encoding: "utf-8",
                size: contentStr.length,
            };
        } catch (error) {
            throw new Error(
                `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Read a binary file from the sandbox and return as base64.
     */
    async readFileBinary(path: string): Promise<FileContent> {
        try {
            const content = await this.sandbox.files.read(path);
            const buffer = Buffer.from(String(content));
            return {
                path,
                content: buffer.toString("base64"),
                encoding: "base64",
                size: buffer.length,
            };
        } catch (error) {
            throw new Error(
                `Failed to read binary file ${path}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Write content to a file in the sandbox.
     * Creates parent directories if they don't exist.
     */
    async writeFile(path: string, content: string): Promise<void> {
        try {
            // Ensure parent directory exists
            const dir = path.substring(0, path.lastIndexOf("/"));
            if (dir) {
                await this.sandbox.commands.run(`mkdir -p ${shellEscape(dir)}`);
            }

            await this.sandbox.files.write(path, content);
            console.log(`[FileSystemManager] File written: ${path}`);
        } catch (error) {
            throw new Error(
                `Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * List contents of a directory.
     */
    async listDirectory(path: string): Promise<FileInfo[]> {
        try {
            const result = await this.sandbox.commands.run(
                `ls -la ${shellEscape(path)} | tail -n +2`
            );

            if (result.exitCode !== 0) {
                throw new Error(result.stderr);
            }

            const lines = result.stdout.trim().split("\n").filter(Boolean);
            const files: FileInfo[] = [];

            for (const line of lines) {
                const parts = line.split(/\s+/);
                if (parts.length < 9) continue;

                const permissions = parts[0];
                const size = parseInt(parts[4], 10);
                const name = parts.slice(8).join(" ");

                if (name === "." || name === "..") continue;

                files.push({
                    name,
                    path: `${path}/${name}`.replace("//", "/"),
                    type: permissions.startsWith("d") ? "directory" : "file",
                    size: permissions.startsWith("d") ? undefined : size,
                });
            }

            return files;
        } catch (error) {
            throw new Error(
                `Failed to list directory ${path}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Delete a file or directory from the sandbox.
     */
    async delete(path: string, recursive = false): Promise<void> {
        try {
            const flag = recursive ? "-rf" : "-f";
            const result = await this.sandbox.commands.run(`rm ${flag} ${shellEscape(path)}`);
            if (result.exitCode !== 0) {
                throw new Error(result.stderr);
            }
            console.log(`[FileSystemManager] Deleted: ${path}`);
        } catch (error) {
            throw new Error(
                `Failed to delete ${path}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Check if a file or directory exists.
     */
    async exists(path: string): Promise<boolean> {
        const result = await this.sandbox.commands.run(`test -e ${shellEscape(path)} && echo "yes" || echo "no"`);
        return result.stdout.trim() === "yes";
    }

    /**
     * Search for files matching a glob pattern.
     */
    async searchFiles(
        directory: string,
        pattern: string
    ): Promise<string[]> {
        try {
            const result = await this.sandbox.commands.run(
                `find ${shellEscape(directory)} -name ${shellEscape(pattern)} -type f 2>/dev/null | head -50`
            );
            if (result.exitCode !== 0) return [];
            return result.stdout.trim().split("\n").filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Create a zip archive of files/directories.
     */
    async createArchive(
        outputPath: string,
        sourcePaths: string[]
    ): Promise<void> {
        const sources = sourcePaths.map((s) => shellEscape(s)).join(" ");
        const result = await this.sandbox.commands.run(
            `zip -r ${shellEscape(outputPath)} ${sources}`
        );
        if (result.exitCode !== 0) {
            throw new Error(`Failed to create archive: ${result.stderr}`);
        }
    }

    /**
     * Extract a zip archive.
     */
    async extractArchive(archivePath: string, destDir: string): Promise<void> {
        await this.sandbox.commands.run(`mkdir -p ${shellEscape(destDir)}`);
        const result = await this.sandbox.commands.run(
            `unzip -o ${shellEscape(archivePath)} -d ${shellEscape(destDir)}`
        );
        if (result.exitCode !== 0) {
            throw new Error(`Failed to extract archive: ${result.stderr}`);
        }
    }

    /**
     * Get file size and metadata.
     */
    async getFileInfo(path: string): Promise<FileInfo & { size: number }> {
        const result = await this.sandbox.commands.run(
            `stat -c '%s %F' ${shellEscape(path)} 2>/dev/null || stat -f '%z %HT' ${shellEscape(path)}`
        );
        if (result.exitCode !== 0) {
            throw new Error(`File not found: ${path}`);
        }

        const parts = result.stdout.trim().split(" ");
        const size = parseInt(parts[0], 10);
        const typeStr = parts.slice(1).join(" ").toLowerCase();
        const type = typeStr.includes("directory") ? "directory" : "file";
        const name = path.split("/").pop() ?? path;

        return { name, path, type, size };
    }
}
