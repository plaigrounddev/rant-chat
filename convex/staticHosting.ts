// convex/staticHosting.ts
// Internal functions for secure static file uploads and deployment queries.
// Used by the CLI deploy script — not publicly accessible.

import { components } from "./_generated/api";
import {
    exposeUploadApi,
    exposeDeploymentQuery,
} from "@convex-dev/static-hosting";

// Internal functions for secure uploads (CLI only)
export const { generateUploadUrl, recordAsset, gcOldAssets, listAssets } =
    exposeUploadApi(components.selfHosting);

// Public query for live reload notifications
export const { getCurrentDeployment } =
    exposeDeploymentQuery(components.selfHosting);
