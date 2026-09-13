import process from "node:process";
import { URL } from "node:url";

const coreApiUrl = process.env.CORE_API_INTERNAL_URL ?? "http://127.0.0.1:48120";
const parsedCoreApiUrl = new URL(coreApiUrl);

if (!["http:", "https:"].includes(parsedCoreApiUrl.protocol)) {
  throw new TypeError("CORE_API_INTERNAL_URL must use HTTP or HTTPS.");
}

const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        destination: `${parsedCoreApiUrl.origin}/:path*`,
        source: "/api/core/:path*",
      },
    ];
  },
};

export default nextConfig;
