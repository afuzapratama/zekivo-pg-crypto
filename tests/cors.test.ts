import { describe, expect, it } from "vitest";
import type pg from "pg";
import { buildApp } from "../apps/api/src/app.js";
const config = {
  APP_ENV: "local",
  SOLANA_CLUSTER: "localnet",
  WEB_ORIGIN: "http://localhost:3100",
};
describe("API reference browser access", () => {
  it("permits local docs authorization headers without cookies or wildcard origins", async () => {
    const app = buildApp({} as pg.Pool, config, false);
    try {
      for (const origin of ["http://localhost:3100", "http://127.0.0.1:3100"]) {
        const r = await app.inject({
          method: "OPTIONS",
          url: "/v1/invoices",
          headers: {
            origin,
            "access-control-request-method": "POST",
            "access-control-request-headers":
              "authorization,content-type,idempotency-key",
          },
        });
        expect(r.statusCode).toBe(204);
        expect(r.headers["access-control-allow-origin"]).toBe(origin);
        expect(r.headers["access-control-allow-credentials"]).toBeUndefined();
        expect(r.headers["access-control-allow-headers"]).toContain(
          "Authorization",
        );
      }
      const unauthorized = await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: { origin: config.WEB_ORIGIN },
        payload: { order_id: "test", asset: "USDC", amount: "1" },
      });
      expect(unauthorized.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
  it("does not grant CORS to other hosts, ports or unconfigured staging origins", async () => {
    for (const cfg of [
      config,
      {
        ...config,
        APP_ENV: "staging",
        SOLANA_CLUSTER: "devnet",
        WEB_ORIGIN: "https://docs.example.com",
      },
    ]) {
      const app = buildApp({} as pg.Pool, cfg, false);
      try {
        for (const origin of [
          "https://evil.example",
          "http://localhost:9999",
          "null",
          "https://localhost:3100",
        ]) {
          const r = await app.inject({
            method: "GET",
            url: "/health",
            headers: { origin },
          });
          expect(r.headers["access-control-allow-origin"]).toBeUndefined();
        }
        const r = await app.inject({
          method: "GET",
          url: "/health",
          headers: { origin: cfg.WEB_ORIGIN },
        });
        expect(r.headers["access-control-allow-origin"]).toBe(cfg.WEB_ORIGIN);
      } finally {
        await app.close();
      }
    }
  });
});
