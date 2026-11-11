import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The docs compile MDX and highlight code on the server at build time; neither needs bundling.
  serverExternalPackages: ["@mdx-js/mdx", "shiki"],
  // Vercel sends Strict-Transport-Security itself (max-age=63072000 on satchelnft.xyz, 2026-11-11).
  // No Content-Security-Policy, no Permissions-Policy and no X-Frame-Options: they could break NEAR
  // Connect's wallet iframes, Ledger over WebHID and WebUSB, copying to the clipboard, or a wallet
  // that opens the app in its own frame (near-connect's ParentFrameWallet).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
