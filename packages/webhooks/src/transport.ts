import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import ipaddr from "ipaddr.js";
export interface DeliveryTarget {
  url: string;
  kind: "external" | "local_inbox";
}
export type ResolveHost = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
const resolveHost: ResolveHost = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });
export function isPublicAddress(ip: string) {
  try {
    return ipaddr.process(ip).range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolveTarget(
  target: DeliveryTarget,
  environment: string,
  resolver: ResolveHost = resolveHost,
) {
  const url = new URL(target.url);
  if (url.username || url.password || url.hash)
    throw new Error("unsafe_target");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (target.kind === "local_inbox") {
    if (
      environment !== "local" ||
      url.protocol !== "http:" ||
      !["webhook-receiver", "localhost", "127.0.0.1"].includes(hostname) ||
      url.port !== "4200" ||
      url.pathname !== "/webhooks/zekivo" ||
      url.search
    )
      throw new Error("unsafe_target");
  } else if (url.protocol !== "https:" || (url.port && url.port !== "443"))
    throw new Error("unsafe_target");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    resolver(hostname),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), 10000);
      timer.unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (!addresses.length || addresses.some((ip) => !isIP(ip.address)))
    throw new Error("unsafe_target");
  if (
    target.kind === "external" &&
    addresses.some((ip) => !isPublicAddress(ip.address))
  )
    throw new Error("unsafe_target");
  if (
    target.kind === "local_inbox" &&
    addresses.some((ip) => {
      const range = ipaddr.process(ip.address).range();
      return hostname === "webhook-receiver"
        ? !["private", "uniqueLocal", "loopback"].includes(range)
        : range !== "loopback";
    })
  )
    throw new Error("unsafe_target");
  return { url, address: addresses[0]!, hostname };
}
export async function sendWebhook(
  target: DeliveryTarget,
  environment: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 10000,
) {
  // The same deadline covers DNS, connect, TLS, headers and body. Pin the validated IP.
  const signal = AbortSignal.timeout(timeoutMs);
  const resolved = await Promise.race([
    resolveTarget(target, environment),
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error("timeout")), {
        once: true,
      }),
    ),
  ]);
  return new Promise<number>((resolve, reject) => {
    let done = false;
    const finish = (error: Error | null, status = 0) => {
      if (done) return;
      done = true;
      if (error) reject(error);
      else resolve(status);
    };
    const request =
      resolved.url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      {
        hostname: resolved.address.address,
        family: resolved.address.family,
        port: resolved.url.port || 443,
        path: resolved.url.pathname + resolved.url.search,
        method: "POST",
        agent: false,
        signal,
        ...(resolved.url.protocol === "https:"
          ? {
              servername: isIP(resolved.hostname)
                ? undefined
                : resolved.hostname,
              rejectUnauthorized: true,
            }
          : {}),
        headers: {
          ...headers,
          host: resolved.url.host,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 4096) {
            finish(new Error("response_too_large"));
            res.destroy();
          }
        });
        res.on("end", () => finish(null, status));
        res.on("error", () => finish(new Error("response_error")));
      },
    );
    req.on("error", () =>
      finish(new Error(signal.aborted ? "timeout" : "network_error")),
    );
    req.end(body);
  });
}
