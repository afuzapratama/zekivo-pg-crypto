import * as oidc from "openid-client";
import type { AdminAuthConfig } from "./config.js";
export interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
}
export interface AdminIdentity {
  tenant: string;
  objectId: string;
  authenticatedAt?: number;
}
export interface IdentityProvider {
  begin(): Promise<LoginState & { url: string }>;
  complete(url: URL, state: LoginState): Promise<AdminIdentity>;
}
export function entraProvider(config: AdminAuthConfig): IdentityProvider {
  let discovered: Promise<oidc.Configuration> | undefined;
  const issuer = new URL(
    `https://login.microsoftonline.com/${config.tenant}/v2.0`,
  );
  const get = () =>
    (discovered ??= oidc
      .discovery(issuer, config.clientId, config.secret)
      .catch((error) => {
        discovered = undefined;
        throw error;
      }));
  const redirect = `${config.origin}/api/admin/auth/callback`;
  return {
    async begin() {
      const server = await get();
      const verifier = oidc.randomPKCECodeVerifier(),
        state = oidc.randomState(),
        nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(server, {
        redirect_uri: redirect,
        scope: "openid profile",
        response_type: "code",
        prompt: "login",
        max_age: "0",
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return { url: url.href, verifier, state, nonce };
    },
    async complete(url, state) {
      const tokens = await oidc.authorizationCodeGrant(await get(), url, {
        pkceCodeVerifier: state.verifier,
        expectedState: state.state,
        expectedNonce: state.nonce,
        idTokenExpected: true,
        maxAge: 600,
      });
      const claims = tokens.claims();
      if (
        !claims ||
        claims.tid !== config.tenant ||
        typeof claims.oid !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(claims.oid)
      )
        throw new Error("Identity tenant/object mismatch");
      if (typeof claims.auth_time !== "number")
        throw new Error("Authentication time missing");
      return {
        tenant: config.tenant,
        objectId: claims.oid.toLowerCase(),
        authenticatedAt: claims.auth_time,
      };
    },
  };
}
