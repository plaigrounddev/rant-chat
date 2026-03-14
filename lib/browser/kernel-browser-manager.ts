/**
 * KernelBrowserManager — Manages browser instance lifecycle using the Kernel SDK.
 *
 * Kernel provides sandboxed, cloud-hosted Chrome browsers that our agent
 * connects to via Chrome DevTools Protocol (CDP). Each browser instance is
 * isolated in its own VM with full Chrome capabilities.
 */

import Kernel from "@onkernel/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserCreateOptions {
    profileId?: string;
    timeoutMs?: number;
    enableLiveView?: boolean;
    enableRecording?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
}

export interface BrowserInstance {
    id: string;
    cdpWsUrl: string;
    liveViewUrl?: string;
    createdAt: Date;
    expiresAt: Date;
    status: "creating" | "running" | "paused" | "terminated";
    creationOptions: BrowserCreateOptions;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MIN_TIMEOUT_MS = 5_000; // 5 seconds minimum
const MAX_TIMEOUT_MS = 72 * 60 * 60 * 1000; // 72 hours

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class KernelBrowserManager {
    private kernel: InstanceType<typeof Kernel>;
    private activeBrowsers: Map<string, BrowserInstance> = new Map();

    constructor() {
        this.kernel = new Kernel();
    }

    async createBrowser(options: BrowserCreateOptions = {}): Promise<BrowserInstance> {
        const requestedTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const timeoutMs = Math.max(
            MIN_TIMEOUT_MS,
            Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
        );

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const createParams: any = {};
            if (options.profileId) {
                createParams.profile = { id: options.profileId };
            }
            if (options.enableLiveView !== undefined) {
                createParams.enable_live_view = options.enableLiveView;
            }
            if (options.enableRecording !== undefined) {
                createParams.enable_recording = options.enableRecording;
            }
            if (options.viewportWidth || options.viewportHeight) {
                createParams.viewport = {
                    width: options.viewportWidth ?? 1280,
                    height: options.viewportHeight ?? 720,
                };
            }
            createParams.timeout_ms = timeoutMs;

            const kernelBrowser = await this.kernel.browsers.create(createParams);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = kernelBrowser as any;
            const browserId: string = raw.session_id ?? crypto.randomUUID();

            const instance: BrowserInstance = {
                id: browserId,
                cdpWsUrl: kernelBrowser.cdp_ws_url,
                liveViewUrl: raw.browser_live_view_url ?? raw.live_view_url ?? undefined,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + timeoutMs),
                status: "running",
                creationOptions: options,
            };

            this.activeBrowsers.set(instance.id, instance);

            console.log(
                `[KernelBrowserManager] Browser created: ${instance.id} (CDP: ***masked***)`
            );

            return instance;
        } catch (error: unknown) {
            console.error("[KernelBrowserManager] Failed to create browser:", error);
            throw new Error(
                `Failed to create browser: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    getBrowser(id: string): BrowserInstance | undefined {
        return this.activeBrowsers.get(id);
    }

    async closeBrowser(id: string): Promise<void> {
        const instance = this.activeBrowsers.get(id);
        if (!instance) {
            console.warn(`[KernelBrowserManager] Browser ${id} not found`);
            return;
        }

        try {
            // Terminate the remote Kernel browser to prevent cloud resource leaks
            await this.kernel.browsers.deleteByID(id);
            instance.status = "terminated";
            this.activeBrowsers.delete(id);
            console.log(`[KernelBrowserManager] Browser ${id} terminated (remote + local)`);
        } catch (error: unknown) {
            console.error(`[KernelBrowserManager] Failed to close browser ${id}:`, error);
            // Keep local entry so caller can retry; mark as paused, not terminated
            instance.status = "paused";
        }
    }

    listBrowsers(): BrowserInstance[] {
        const now = new Date();
        for (const [id, browser] of this.activeBrowsers) {
            if (browser.expiresAt < now) {
                browser.status = "terminated";
                this.activeBrowsers.delete(id);
                // Fire-and-forget remote cleanup to avoid orphaned Kernel browsers
                this.kernel.browsers.deleteByID(id).catch((err: unknown) => {
                    console.warn(`[KernelBrowserManager] Failed to clean up expired browser ${id}:`, err);
                });
            }
        }
        return Array.from(this.activeBrowsers.values());
    }

    async getOrCreateBrowser(options: BrowserCreateOptions = {}): Promise<BrowserInstance> {
        // Match by profileId AND creation options to prevent mismatched reuse
        const existing = Array.from(this.activeBrowsers.values()).find(
            (b) =>
                b.status === "running" &&
                b.expiresAt > new Date() &&
                (b.creationOptions.profileId ?? "") === (options.profileId ?? "") &&
                !!b.creationOptions.enableLiveView === !!options.enableLiveView &&
                !!b.creationOptions.enableRecording === !!options.enableRecording &&
                (b.creationOptions.viewportWidth ?? 1280) === (options.viewportWidth ?? 1280) &&
                (b.creationOptions.viewportHeight ?? 720) === (options.viewportHeight ?? 720)
        );

        if (existing) {
            console.log(`[KernelBrowserManager] Reusing existing browser: ${existing.id} (profile=${options.profileId ?? 'default'})`);
            return existing;
        }

        return this.createBrowser(options);
    }

    async closeAll(): Promise<void> {
        const ids = Array.from(this.activeBrowsers.keys());
        await Promise.all(ids.map((id) => this.closeBrowser(id)));
        console.log(`[KernelBrowserManager] All ${ids.length} browsers closed`);
    }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: KernelBrowserManager | null = null;

export function getKernelBrowserManager(): KernelBrowserManager {
    if (!_instance) {
        _instance = new KernelBrowserManager();
    }
    return _instance;
}
