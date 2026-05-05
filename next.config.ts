import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  allowedDevOrigins: ["192.168.195.100"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // Self-contained server bundle for the macOS .app embedder.
  // .next/standalone/ ships its own minimal node_modules and a server.js
  // entry point that the Swift launcher spawns directly.
  output: "standalone",
};

export default config;
