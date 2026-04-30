import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
