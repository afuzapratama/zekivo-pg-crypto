import { NextRequest, NextResponse } from "next/server";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const host = request.headers.get("host");
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    /* Invalid host fails closed. */
  }
  if (
    process.env.LOCAL_PLAYGROUND !== "true" ||
    process.env.APP_ENV !== "local" ||
    process.env.SOLANA_CLUSTER !== "localnet" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(hostname)
  )
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  const path = (await context.params).path.join("/");
  const id = "[0-9a-fA-F-]{36}";
  const allowed =
    request.method === "GET"
      ? path === "openapi" ||
        path === "health" ||
        new RegExp(`^invoices/${id}$`).test(path)
      : path === "invoices" || new RegExp(`^invoices/${id}/pay$`).test(path);
  if (!allowed)
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  let body: string | undefined;
  if (request.method === "POST") {
    try {
      const origin = new URL(request.headers.get("origin") ?? "");
      if (
        origin.host !== host ||
        origin.protocol !== new URL(request.url).protocol
      )
        throw new Error("origin");
    } catch {
      return NextResponse.json(
        { error: "forbidden_origin" },
        { status: 403, headers },
      );
    }
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return NextResponse.json(
        { error: "invalid_body" },
        { status: 400, headers },
      );
    const reader = request.body?.getReader();
    if (!reader)
      return NextResponse.json(
        { error: "invalid_body" },
        { status: 400, headers },
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return NextResponse.json(
          { error: "body_too_large" },
          { status: 413, headers },
        );
      }
      chunks.push(part.value);
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const helper = new URL(
      process.env.LOCAL_PLAYGROUND_URL ?? "http://127.0.0.1:4300",
    );
    if (
      helper.protocol !== "http:" ||
      !["local-tools", "localhost", "127.0.0.1"].includes(helper.hostname) ||
      helper.port !== "4300" ||
      helper.username ||
      helper.password ||
      !process.env.LOCAL_PLAYGROUND_TOKEN
    )
      throw new Error("helper_config");
    const response = await fetch(new URL(`/${path}`, helper), {
      method: request.method,
      headers: {
        authorization: `Bearer ${process.env.LOCAL_PLAYGROUND_TOKEN}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "local_tools_unavailable" },
      { status: 503, headers },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
