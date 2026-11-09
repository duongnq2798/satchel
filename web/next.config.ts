import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The docs compile MDX and highlight code on the server at build time; neither needs bundling.
  serverExternalPackages: ["@mdx-js/mdx", "shiki"],
};

export default config;
