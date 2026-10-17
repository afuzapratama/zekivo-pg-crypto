import { encryptSecret } from "../../webhooks/src/crypto.js";
import { createHash } from "node:crypto";
import { loadConfig } from "../../config/src/index.js";
import { createPool } from "./pool.js";
const config = loadConfig();
if (config.APP_ENV !== "local" || config.SOLANA_CLUSTER !== "localnet")
  throw new Error("Seed is localnet only");
const pool = createPool(config.DATABASE_URL);
try {
  await pool.query(
    "INSERT INTO projects(id,name,environment) VALUES('00000000-0000-4000-8000-000000000001','Local sandbox','local') ON CONFLICT DO NOTHING",
  );
  await pool.query(
    "INSERT INTO api_keys(id,project_id,key_hash) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',$1) ON CONFLICT DO NOTHING",
    [createHash("sha256").update("zk_local_development_only").digest("hex")],
  );
  if (
    config.WEBHOOK_ENCRYPTION_KEY &&
    process.env.LOCAL_WEBHOOK_URL &&
    process.env.LOCAL_WEBHOOK_SECRET
  ) {
    const { resolveTarget } = await import("../../webhooks/src/transport.js");
    await resolveTarget(
      { url: process.env.LOCAL_WEBHOOK_URL, kind: "local_inbox" },
      config.APP_ENV,
    );
    await pool.query(
      `INSERT INTO webhook_endpoints(id,project_id,url,kind,secret_ciphertext) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',$1,'local_inbox',$2) ON CONFLICT(id) DO UPDATE SET url=excluded.url,secret_ciphertext=excluded.secret_ciphertext WHERE webhook_endpoints.kind='local_inbox'`,
      [
        process.env.LOCAL_WEBHOOK_URL,
        encryptSecret(
          process.env.LOCAL_WEBHOOK_SECRET,
          config.WEBHOOK_ENCRYPTION_KEY,
        ),
      ],
    );
  }
  console.log(
    "Local sandbox seeded. Development-only API key is documented in README.",
  );
} finally {
  await pool.end();
}
