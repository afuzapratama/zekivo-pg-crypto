import { describe, it, expect } from "vitest";
import {
  adminAuthConfig,
  adminPermissions,
} from "../packages/auth/src/config.js";
const id = "11111111-1111-4111-8111-111111111111";
const valid = {
  ADMIN_AUTH_ENABLED: "true",
  ENTRA_TENANT_ID: id,
  ENTRA_CLIENT_ID: id,
  ENTRA_CLIENT_SECRET: "only-a-test-secret-for-config",
  WEB_ORIGIN: "http://localhost:3100",
  ADMIN_ALLOWED_IDENTITIES: JSON.stringify({ [id]: "read-only" }),
};
describe("admin configuration", () => {
  it("is explicitly disabled by default and fails closed for incomplete enabled configuration", () => {
    expect(adminAuthConfig({})).toBeUndefined();
    expect(() => adminAuthConfig({ ADMIN_AUTH_ENABLED: "true" })).toThrow();
    expect(() => adminAuthConfig({ ADMIN_AUTH_ENABLED: "tru" })).toThrow();
    expect(adminAuthConfig(valid)?.allowed[id]).toBe("read-only");
  });
  it("rejects arbitrary HTTP origins, unpinned tenants and empty or invalid role grants", () => {
    for (const patch of [
      { WEB_ORIGIN: "http://example.com" },
      { ENTRA_TENANT_ID: "common" },
      { ADMIN_ALLOWED_IDENTITIES: "{}" },
      { ADMIN_ALLOWED_IDENTITIES: JSON.stringify({ [id]: "owner" }) },
    ])
      expect(() => adminAuthConfig({ ...valid, ...patch })).toThrow();
  });
  it("defines least privilege roles without giving read-only operational actions", () => {
    expect(adminPermissions("read-only")).toEqual(["dashboard:read"]);
    expect(adminPermissions("operator")).not.toContain("project:manage");
    expect(adminPermissions("admin")).toContain("project:manage");
  });
});
