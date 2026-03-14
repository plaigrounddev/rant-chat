/**
 * lib/browser — Browser-as-a-Service module using Kernel.
 *
 * Provides cloud-hosted Chrome browser instances for AI agent web automation.
 * Uses Kernel SDK for browser lifecycle and Playwright for page interaction.
 */

export {
    KernelBrowserManager,
    getKernelBrowserManager,
    type BrowserCreateOptions,
    type BrowserInstance,
} from "./kernel-browser-manager";

export {
    BrowserNavigator,
    type NavigateResult,
    type ExtractedContent,
    type FormField,
    type InteractiveElement,
    type PageSummary,
} from "./browser-navigator";

export {
    BrowserAuthManager,
    getBrowserAuthManager,
    type AuthProfile,
    type SessionData,
    type CookieData,
} from "./browser-auth-manager";

export {
    BROWSER_TOOLS,
    BROWSER_TOOL_NAMES,
    isBrowserTool,
    type BrowserToolDefinition,
    // Individual schemas
    browserNavigateSchema,
    browserClickSchema,
    browserTypeSchema,
    browserScrollSchema,
    browserExtractTextSchema,
    browserScreenshotSchema,
    browserFillFormSchema,
    browserEvaluateJsSchema,
    browserWaitSchema,
    browserGetLinksSchema,
    browserGetPageSummarySchema,
    browserFindElementsSchema,
    browserPressKeySchema,
    browserNewTabSchema,
    browserCloseTabSchema,
    browserGoBackSchema,
    browserCloseSchema,
} from "./browser-tools";
