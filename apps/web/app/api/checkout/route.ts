import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.headers.get("x-checkout-token");
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  try {
    const response = await fetch(
      new URL(
        "/v1/checkout",
        process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100",
      ),
      {
        headers: { "x-checkout-token": token },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    if (!response.ok)
      return NextResponse.json(
        { error: response.status === 404 ? "not_found" : "unavailable" },
        { status: response.status === 404 ? 404 : 503, headers },
      );
    return NextResponse.json(await response.json(), { headers });
  } catch {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers },
    );
  }
}
