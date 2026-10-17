export default {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
  logging: {
    incomingRequests: {
      ignore: [/^\/pay(?:\/|\?)/, /^\/api\/admin\/auth\/callback(?:\?|$)/],
    },
    browserToTerminal: false,
  },
  async headers() {
    return [
      ...["/login", "/dashboard/:path*", "/api/admin/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "no-store" },
          {
            key: "Referrer-Policy",
            value: source === "/login" ? "same-origin" : "no-referrer",
          },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      })),
      {
        source: "/docs/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/pay/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
