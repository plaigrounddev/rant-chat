// convex/auth.config.ts
import { AuthConfig } from "convex/server";

export default {
    providers: [
        {
            // Configure this in your .env.local as CLERK_JWT_ISSUER_DOMAIN
            // Development format: https://verb-noun-00.clerk.accounts.dev
            // Production format: https://clerk.<your-domain>.com
            domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
            applicationID: "convex",
        },
    ],
} satisfies AuthConfig;
