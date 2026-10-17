// Read retries only. A broadcast/airdrop timeout must never be retried implicitly.
export class SolanaRpc {
  private id = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  private readonly minIntervalMs: number;
  constructor(
    readonly url: string,
    private readonly options: {
      minIntervalMs?: number;
      retries?: number;
      backoffMs?: number;
    } = {},
  ) {
    this.minIntervalMs =
      options.minIntervalMs ?? (new URL(url).protocol === "https:" ? 350 : 0);
  }
  call<T>(method: string, params: unknown[] = []): Promise<T> {
    const task = this.queue.then(() => this.request<T>(method, params));
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const reads = method.startsWith("get");
    const limit = reads ? (this.options.retries ?? 3) : 0;
    for (let attempt = 0; ; attempt++) {
      const wait = this.nextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.nextAt = Date.now() + this.minIntervalMs;
      let response: Response;
      try {
        response = await fetch(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.id,
            method,
            params,
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        if (attempt >= limit)
          throw new Error(`RPC ${method} transport unavailable`);
        await this.backoff(attempt);
        continue;
      }
      if (!response.ok) {
        const status = response.status;
        const retryAfter = response.headers.get("retry-after");
        await response.body?.cancel();
        if (attempt >= limit || ![429, 502, 503, 504].includes(status))
          throw new Error(`RPC HTTP ${status}`);
        const delay =
          retryAfter == null
            ? undefined
            : /^\d+$/.test(retryAfter)
              ? Number(retryAfter) * 1000
              : Math.max(0, Date.parse(retryAfter) - Date.now());
        if (delay !== undefined && (!Number.isFinite(delay) || delay > 30000))
          throw new Error(`RPC HTTP ${status}; retry later`);
        await this.backoff(attempt, delay);
        continue;
      }
      const data = (await response.json()) as {
        result: T;
        error?: { code: number; message: string };
      };
      if (data.error) {
        if (attempt < limit && [-32005, -32016].includes(data.error.code)) {
          await this.backoff(attempt);
          continue;
        }
        throw new Error(`RPC ${method} failed: ${data.error.message}`);
      }
      return data.result;
    }
  }
  private backoff(attempt: number, requested?: number) {
    const delay = Math.max(
      requested ?? 0,
      Math.min(10000, (this.options.backoffMs ?? 1000) * 2 ** attempt),
    );
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
export function assertLocalRpc(
  url: string,
  environment: string,
  cluster: string,
) {
  const parsed = new URL(url);
  if (
    environment !== "local" ||
    cluster !== "localnet" ||
    !["localhost", "127.0.0.1", "validator"].includes(parsed.hostname) ||
    parsed.protocol !== "http:"
  )
    throw new Error(
      "Test tools require local/localnet and a local validator HTTP endpoint",
    );
}
