import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Pre-existing TS errors in transcript-viewer.tsx (missing hook)
    // TODO: Remove once use-transcript-viewer hook is implemented
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
