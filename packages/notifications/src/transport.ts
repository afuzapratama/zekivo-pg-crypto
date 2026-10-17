import nodemailer from "nodemailer";
import { resolveTarget } from "../../webhooks/src/transport.js";
import { smtpSchema, telegramSchema, type ChannelConfig } from "./config.js";
export class NotificationError extends Error {
  constructor(
    public code: string,
    public retryAfter = 0,
  ) {
    super(code);
  }
}
export async function sendNotification(
  channel: string,
  config: ChannelConfig,
  message: {
    id: string;
    environment: string;
    cluster: string;
    title: string;
    body: string;
    allowLocalMailpit?: boolean;
  },
) {
  const subject = `[Zekivo PG ${message.cluster}] ${message.title}`;
  const text = `${subject}\n\n${message.body}\n\nNotification #${message.id} · ${message.environment}/${message.cluster}`;
  if (channel === "email") {
    const c = smtpSchema.parse(config);
    if (c.mode === "mailpit" && !message.allowLocalMailpit)
      throw new NotificationError("mailpit_not_allowed");
    const resolved =
      c.mode === "smtp"
        ? await resolveTarget(
            { url: `https://${c.host}/`, kind: "external" },
            message.environment,
          )
        : null;
    const smtp = nodemailer.createTransport({
      host: resolved?.address.address ?? c.host,
      port: c.port,
      secure: c.mode === "smtp" && c.port === 465,
      requireTLS: c.mode === "smtp",
      ignoreTLS: c.mode === "mailpit",
      ...(c.mode === "smtp"
        ? {
            tls: { servername: c.host, rejectUnauthorized: true },
            auth: { user: c.username, pass: c.password },
          }
        : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    try {
      const result = await smtp.sendMail({
        from: c.from,
        to: c.to,
        subject,
        text,
        messageId: `<zekivo-${message.environment}-${message.cluster}-${message.id}@notifications.zekivo.invalid>`,
      });
      if (!result.accepted?.length)
        throw new NotificationError("smtp_rejected");
    } catch {
      throw new NotificationError("smtp_delivery_failed");
    } finally {
      smtp.close();
    }
  } else {
    const c = telegramSchema.parse(config);
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${c.bot_token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: c.chat_id,
            text,
            link_preview_options: { is_disabled: true },
          }),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        parameters?: { retry_after?: number };
      };
      if (!response.ok || data.ok !== true)
        throw new NotificationError(
          response.status === 429
            ? "telegram_rate_limited"
            : "telegram_delivery_failed",
          Math.min(
            86400,
            Math.max(0, Number(data.parameters?.retry_after) || 0),
          ),
        );
    } catch (error) {
      if (error instanceof NotificationError) throw error;
      throw new NotificationError("telegram_delivery_failed");
    }
  }
}
