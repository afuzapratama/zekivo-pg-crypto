import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  signWebhook,
  verifyWebhook,
} from "../packages/webhooks/src/crypto.js";
import {
  resolveTarget,
  isPublicAddress,
} from "../packages/webhooks/src/transport.js";
import { retryDelaySeconds } from "../packages/webhooks/src/queue.js";
const key = "a".repeat(64);
describe("webhook cryptography", () => {
  it("authenticates the exact raw body and timestamp", () => {
    const signed = signWebhook('{"id":1}', "secret", 1000);
    expect(
      verifyWebhook(
        '{"id":1}',
        "secret",
        signed.timestamp,
        signed.signature,
        1000,
      ),
    ).toBe(true);
    expect(
      verifyWebhook(
        '{ "id":1}',
        "secret",
        signed.timestamp,
        signed.signature,
        1000,
      ),
    ).toBe(false);
    expect(
      verifyWebhook(
        '{"id":1}',
        "wrong",
        signed.timestamp,
        signed.signature,
        1000,
      ),
    ).toBe(false);
    expect(
      verifyWebhook(
        '{"id":1}',
        "secret",
        signed.timestamp,
        signed.signature,
        1301,
      ),
    ).toBe(false);
    expect(
      verifyWebhook('{"id":1}', "secret", signed.timestamp, "short", 1000),
    ).toBe(false);
  });
  it("encrypts secrets with an authenticated randomized envelope", () => {
    const a = encryptSecret("secret", key),
      b = encryptSecret("secret", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("secret");
    expect(a).not.toContain("secret");
    expect(() => decryptSecret(a, "b".repeat(64))).toThrow();
    const parts = a.split(":");
    parts[2] = "0".repeat(32);
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
  });
});
describe("webhook targets", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks non-public address %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(false),
  );
  it("rejects private DNS answers including mixed public/private results", async () => {
    await expect(
      resolveTarget(
        { url: "https://merchant.example/hook", kind: "external" },
        "local",
        async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      ),
    ).rejects.toThrow("unsafe_target");
  });
  it("resolves a public endpoint to a pinned address", async () => {
    const target = await resolveTarget(
      { url: "https://merchant.example/hook", kind: "external" },
      "test",
      async () => [{ address: "8.8.8.8", family: 4 }],
    );
    expect(target.address.address).toBe("8.8.8.8");
    expect(target.hostname).toBe("merchant.example");
  });
  it.each([
    "http://merchant.example/hook",
    "https://user:pass@merchant.example/",
    "https://merchant.example:8443/hook",
    "https://merchant.example/#fragment",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(
      resolveTarget({ url, kind: "external" }, "local"),
    ).rejects.toThrow();
  });
  it("restricts the local bypass to an exact fixture URL in local mode", async () => {
    const resolver = async () => [{ address: "127.0.0.1", family: 4 }];
    await expect(
      resolveTarget(
        { url: "http://localhost:4200/webhooks/zekivo", kind: "local_inbox" },
        "local",
        resolver,
      ),
    ).resolves.toBeDefined();
    for (const [url, env] of [
      ["http://localhost:4200/webhooks/zekivo", "test"],
      ["http://localhost:4200/admin", "local"],
      ["http://169.254.169.254:4200/webhooks/zekivo", "local"],
    ])
      await expect(
        resolveTarget({ url: url!, kind: "local_inbox" }, env!, resolver),
      ).rejects.toThrow("unsafe_target");
  });
});
it("caps retry backoff with bounded jitter", () => {
  expect(retryDelaySeconds(1, 1)).toBe(10);
  expect(retryDelaySeconds(2, 1)).toBe(20);
  expect(retryDelaySeconds(20, 1)).toBe(3600);
  expect(retryDelaySeconds(20, 0)).toBe(2880);
});

it("does not let local fixture DNS resolve to public or metadata targets", async () => {
  for (const ip of ["8.8.8.8", "169.254.169.254"])
    await expect(
      resolveTarget(
        {
          url: "http://webhook-receiver:4200/webhooks/zekivo",
          kind: "local_inbox",
        },
        "local",
        async () => [{ address: ip, family: 4 }],
      ),
    ).rejects.toThrow("unsafe_target");
});
