import { NextRequest, NextResponse } from "next/server";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  const allowed =
    request.method === "POST" ? ["login", "logout"] : ["session", "callback"];
  if (!allowed.includes(action))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:3100";
  if (
    request.headers.get("host") !== new URL(origin).host ||
    (request.method === "POST" && request.headers.get("origin") !== origin)
  )
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const url = new URL(
      `/admin/auth/${action}`,
      process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100",
    );
    if (action === "callback") url.search = request.nextUrl.search;
    const headers = new Headers();
    for (const name of ["cookie", "origin", "x-csrf-token"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetch(url, {
      method: request.method,
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const outgoing = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    for (const cookie of response.headers.getSetCookie())
      outgoing.append("Set-Cookie", cookie);
    const location = response.headers.get("location");
    if (location) outgoing.set("Location", location);
    outgoing.set(
      "Content-Type",
      response.headers.get("content-type") ?? "application/json",
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return NextResponse.json(
      { error: "admin_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
