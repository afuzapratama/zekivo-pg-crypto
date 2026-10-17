import { NextRequest, NextResponse } from "next/server";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (
      !origin ||
      new URL(origin).host !== request.headers.get("host") ||
      new URL(origin).protocol !== new URL(request.url).protocol
    )
      return NextResponse.json(
        { error: "forbidden_origin" },
        { status: 403, headers },
      );
  } catch {
    return NextResponse.json(
      { error: "forbidden_origin" },
      { status: 403, headers },
    );
  }
  const token = request.headers.get("x-checkout-token");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers },
    );
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024) {
        await reader.cancel();
        return NextResponse.json(
          { error: "body_too_large" },
          { status: 413, headers },
        );
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      !body ||
      !["USDT", "USDC"].includes(body.asset) ||
      !Number.isInteger(body.expected_version) ||
      body.expected_version < 1 ||
      body.expected_version > 2147483647 ||
      Object.keys(body).some(
        (key) => !["asset", "expected_version"].includes(key),
      )
    )
      throw new Error("Invalid body");
  } catch {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers },
    );
  }
  try {
    const response = await fetch(
      new URL(
        "/v1/checkout/asset",
        process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100",
      ),
      {
        method: "POST",
        headers: {
          "x-checkout-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      const status = [400, 404, 409, 429].includes(response.status)
        ? response.status
        : 503;
      return NextResponse.json(
        {
          error:
            status === 409
              ? "invoice_changed_or_selection_closed"
              : "unavailable",
        },
        { status, headers },
      );
    }
    return NextResponse.json(await response.json(), { headers });
  } catch {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers },
    );
  }
}
