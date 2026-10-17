import { z } from "zod";
export const channelNames = ["email", "telegram"] as const;
const mail = z.email().max(254);
const smtpTlsSchema = z
  .object({
    mode: z.literal("smtp").default("smtp"),
    host: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i),
    port: z.union([z.literal(465), z.literal(587)]),
    username: z
      .string()
      .min(1)
      .max(254)
      .regex(/^[^\r\n]+$/),
    password: z.string().min(1).max(1024),
    from: mail,
    to: mail,
  })
  .strict();
const mailpitSchema = z
  .object({
    mode: z.literal("mailpit"),
    host: z.enum(["127.0.0.1", "localhost", "host.docker.internal"]),
    port: z.literal(1025),
    from: mail,
    to: mail,
  })
  .strict();
export const smtpSchema = z.union([smtpTlsSchema, mailpitSchema]);
export const telegramSchema = z
  .object({
    bot_token: z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{30,100}$/),
    chat_id: z.string().regex(/^-?\d{1,20}$/),
  })
  .strict();
export type ChannelConfig =
  z.infer<typeof smtpSchema> | z.infer<typeof telegramSchema>;
export function mailpitAllowed(scope: {
  APP_ENV: string;
  SOLANA_CLUSTER: string;
  LOCAL_MAILPIT_ENABLED?: string;
}) {
  return (
    (scope.APP_ENV === "local" && scope.SOLANA_CLUSTER === "localnet") ||
    (scope.APP_ENV === "staging" &&
      scope.SOLANA_CLUSTER === "devnet" &&
      scope.LOCAL_MAILPIT_ENABLED === "true")
  );
}
export function parseChannel(channel: string, value: unknown): ChannelConfig {
  return channel === "email"
    ? smtpSchema.parse(value)
    : telegramSchema.parse(value);
}
export function redactChannel(channel: string, config: ChannelConfig) {
  return channel === "email"
    ? {
        ...(config as z.infer<typeof smtpSchema>),
        password: undefined,
        password_set: (config as z.infer<typeof smtpSchema>).mode !== "mailpit",
      }
    : {
        chat_id: (config as z.infer<typeof telegramSchema>).chat_id,
        bot_token_set: true,
      };
}
