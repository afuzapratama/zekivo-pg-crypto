import { z } from "zod";
export const roles = ["admin", "operator", "read-only"] as const;
export type AdminRole = (typeof roles)[number];
const schema = z.object({
  tenant: z
    .string()
    .uuid()
    .transform((v) => v.toLowerCase()),
  clientId: z.string().uuid(),
  secret: z.string().min(16),
  origin: z.string().url(),
  allowed: z
    .record(z.string().uuid(), z.enum(roles))
    .refine((v) => Object.keys(v).length > 0),
});
export type AdminAuthConfig = z.infer<typeof schema>;
export function adminAuthConfig(
  env: NodeJS.ProcessEnv,
): AdminAuthConfig | undefined {
  const enabled = z
    .enum(["true", "false"])
    .default("false")
    .parse(env.ADMIN_AUTH_ENABLED);
  if (enabled !== "true") return undefined;
  const parsed = schema.parse({
    tenant: env.ENTRA_TENANT_ID,
    clientId: env.ENTRA_CLIENT_ID,
    secret: env.ENTRA_CLIENT_SECRET,
    origin: env.WEB_ORIGIN,
    allowed: JSON.parse(env.ADMIN_ALLOWED_IDENTITIES ?? "{}"),
  });
  parsed.allowed = Object.fromEntries(
    Object.entries(parsed.allowed).map(([id, role]) => [
      id.toLowerCase(),
      role,
    ]),
  );
  const origin = new URL(parsed.origin);
  if (
    origin.origin !== parsed.origin ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error("Admin origin requires HTTPS or explicit loopback HTTP");
  return parsed;
}
const permissions = {
  admin: [
    "dashboard:read",
    "review:write",
    "refund:write",
    "project:manage",
    "webhook:replay",
    "notification:manage",
  ],
  operator: ["dashboard:read", "review:write", "webhook:replay"],
  "read-only": ["dashboard:read"],
} as const;
export function adminPermissions(role: AdminRole): readonly string[] {
  return permissions[role];
}
