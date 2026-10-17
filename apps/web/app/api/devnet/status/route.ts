import { NextRequest, NextResponse } from "next/server";
export async function GET(request: NextRequest) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  try {
    const hostname = new URL(`http://${request.headers.get("host") ?? ""}`)
      .hostname;
    if (
      process.env.APP_ENV !== "staging" ||
      process.env.SOLANA_CLUSTER !== "devnet" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    )
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers },
      );
    const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:14100";
    const health = await fetch(new URL("/health", base), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json());
    if (health.environment !== "staging" || health.cluster !== "devnet")
      throw new Error("scope");
    const ready = await fetch(new URL("/ready", base), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    return NextResponse.json(
      { environment: "staging", cluster: "devnet", ready: ready.ok },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "devnet_unavailable" },
      { status: 503, headers },
    );
  }
}
