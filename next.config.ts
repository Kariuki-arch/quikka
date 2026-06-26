import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["2793-102-210-28-18.ngrok-free.app"],
  async rewrites() {
    return [
      {
        source: "/",
        destination: "/landing.html",
      },
      {
        source: "/checkout/:path*",
        destination: "/index.html",
      },
      {
        source: "/receipt",
        destination: "/receipt.html",
      },
      {
        source: "/receipt/:path*",
        destination: "/receipt.html",
      },
      {
        source: "/privacy",
        destination: "/privacy.html",
      },
      {
        source: "/terms",
        destination: "/terms.html",
      },
      {
        source: "/@:handle",
        destination: "/profile.html",
      }
    ];
  },
};

export default nextConfig;
