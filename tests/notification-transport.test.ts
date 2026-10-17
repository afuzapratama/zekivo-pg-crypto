import { afterEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { sendNotification } from "../packages/notifications/src/transport.js";
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
vi.mock("../packages/webhooks/src/transport.js", () => ({
  resolveTarget: vi.fn(async (target: { url: string }) => {
    if (target.url.includes("127.0.0.1")) throw new Error("unsafe_target");
    return { address: { address: "8.8.8.8", family: 4 } };
  }),
}));
const message = {
  id: "17",
  environment: "test",
  cluster: "devnet",
  title: "Payment confirmed",
  body: "Invoice fixture",
};
const smtp = {
  mode: "smtp" as const,
  host: "smtp.example.com",
  port: 587 as const,
  username: "admin",
  password: "fixture-only-password",
  from: "pg@example.com",
  to: "admin@example.com",
};
const telegram = {
  bot_token: `123456:${"a".repeat(35)}`,
  chat_id: "-100123456",
};
afterEach(() => vi.restoreAllMocks());
describe("notification transport", () => {
  it("allows only explicitly enabled local Mailpit capture without authentication", async () => {
    const config = {
      mode: "mailpit" as const,
      host: "127.0.0.1" as const,
      port: 1025 as const,
      from: smtp.from,
      to: smtp.to,
    };
    await expect(sendNotification("email", config, message)).rejects.toThrow(
      "mailpit_not_allowed",
    );
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: async () => ({ accepted: [smtp.to] }),
      close: vi.fn(),
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    await sendNotification("email", config, {
      ...message,
      allowLocalMailpit: true,
    });
    const options = vi
      .mocked(nodemailer.createTransport)
      .mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(options).toMatchObject({
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      ignoreTLS: true,
    });
    expect(options.auth).toBeUndefined();
  });
  it("pins SMTP public IP, requires TLS, prevents URL/file reads and uses stable message identity", async () => {
    const sendMail = vi.fn(async () => ({ accepted: [smtp.to] })),
      close = vi.fn();
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail,
      close,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    await sendNotification("email", smtp, message);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "8.8.8.8",
        secure: false,
        requireTLS: true,
        tls: { servername: "smtp.example.com", rejectUnauthorized: true },
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: smtp.to,
        messageId: "<zekivo-test-devnet-17@notifications.zekivo.invalid>",
      }),
    );
    expect(close).toHaveBeenCalled();
  });
  it("rejects private SMTP before authenticating", async () => {
    const before = vi.mocked(nodemailer.createTransport).mock.calls.length;
    await expect(
      sendNotification("email", { ...smtp, host: "127.0.0.1" }, message),
    ).rejects.toThrow("unsafe_target");
    expect(vi.mocked(nodemailer.createTransport).mock.calls.length).toBe(
      before,
    );
  });
  it("does not expose SMTP provider errors or credentials", async () => {
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: async () => {
        throw new Error(smtp.password);
      },
      close: vi.fn(),
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    await expect(sendNotification("email", smtp, message)).rejects.toThrow(
      "smtp_delivery_failed",
    );
  });
  it("Telegram requires ok=true and honors rate-limit retry_after without parsing message markup", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, parameters: { retry_after: 123 } }),
          { status: 429 },
        ),
      );
    await expect(
      sendNotification("telegram", telegram, message),
    ).rejects.toMatchObject({ code: "telegram_rate_limited", retryAfter: 123 });
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body.parse_mode).toBeUndefined();
    expect(body.chat_id).toBe(telegram.chat_id);
  });
  it("sanitizes Telegram network errors containing the bot-token URL", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error(telegram.bot_token),
    );
    await expect(
      sendNotification("telegram", telegram, message),
    ).rejects.toThrow("telegram_delivery_failed");
  });
});
