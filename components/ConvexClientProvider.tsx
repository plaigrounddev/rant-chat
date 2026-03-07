"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Convex client — only create if URL is configured
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export default function ConvexClientProvider({
    children,
}: {
    children: ReactNode;
}) {
    // If Convex is not configured, render children without Convex
    if (!convex) {
        return <>{children}</>;
    }

    return (
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            {children}
        </ConvexProviderWithClerk>
    );
}
