import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
