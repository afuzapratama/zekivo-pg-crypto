import { NextRequest, NextResponse } from "next/server";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9]{1,18}$/.test(id))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:3100";
  if (
    request.headers.get("host") !== new URL(origin).host ||
    request.headers.get("origin") !== origin
  )
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 12288) {
          await reader.cancel();
          return NextResponse.json(
            { error: "body_too_large" },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    const body = Buffer.concat(chunks).toString("utf8");
    const headers = new Headers({ "Content-Type": "application/json" });
    for (const name of [
      "cookie",
      "origin",
      "x-csrf-token",
      "idempotency-key",
    ]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetch(
      new URL(
        `/admin/reviews/${id}`,
        process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100",
      ),
      {
        method: "POST",
        headers,
        body: body || "{}",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "request_outcome_unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
