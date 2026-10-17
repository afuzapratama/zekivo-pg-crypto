import { NextRequest, NextResponse } from "next/server";
export async function GET(request: NextRequest) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  try {
    const hostname = new URL(`http://${request.headers.get("host") ?? ""}`)
      .hostname;
    const local =
      process.env.APP_ENV === "local" &&
      process.env.SOLANA_CLUSTER === "localnet" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    const publicUrl =
      process.env.API_PUBLIC_URL ??
      (local ? `http://${hostname}:4100` : undefined);
    if (!publicUrl) throw new Error("Public API URL not configured");
    const response = await fetch(
      new URL(
        "/openapi.json",
        process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100",
      ),
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error("API unavailable");
    const spec = await response.json();
    return NextResponse.json(
      {
        ...spec,
        servers: [
          {
            url: publicUrl,
            description: local ? "Localnet sandbox" : "Configured gateway",
          },
        ],
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "openapi_unavailable" },
      { status: 503, headers },
    );
  }
}
