import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Appends `?dpl=<id>` to static asset URLs, worker scripts included. The
  // voice worker's bootstrap file keeps the same name from build to build and
  // browsers cache it as immutable, so without a fresh URL a returning visitor
  // reuses a copy served before the isolation headers below existed, and the
  // browser refuses to start the worker under them.
  ...(process.env.VERCEL_DEPLOYMENT_ID
    ? { deploymentId: process.env.VERCEL_DEPLOYMENT_ID }
    : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Enable cross-origin isolation so ONNX Runtime WASM can use
          // multi-threaded SIMD (SharedArrayBuffer). "credentialless" keeps
          // external HTTPS images in Markdown documents working cleanly.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
