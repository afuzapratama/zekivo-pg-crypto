import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const password = randomBytes(24).toString("hex");
const file = fileURLToPath(new URL("../../../.env.devnet", import.meta.url));
const content = `# Generated Devnet-only credentials. Do not commit or reuse in localnet/mainnet.
APP_ENV=staging
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
ENABLED_ASSETS=USDC
SCAN_INTERVAL_MS=10000
CHAIN_MONITORING=true
WEBHOOK_DELIVERY=false
WEBHOOK_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}
NOTIFICATION_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}
DATABASE_URL=postgres://gateway_devnet:${password}@127.0.0.1:55433/gateway_devnet
DEVNET_DB_PASSWORD=${password}
DEVNET_PROJECT_ID=${randomUUID()}
DEVNET_API_KEY=zk_devnet_${randomBytes(32).toString("hex")}
DEVNET_API_URL=http://127.0.0.1:14100
WEB_ORIGIN=http://localhost:13100
`;
try {
  await writeFile(file, content, { flag: "wx", mode: 0o600 });
  console.log(
    "Created .env.devnet (mode 0600). Credentials are not printed. Existing localnet configuration untouched.",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  console.log(".env.devnet already exists; credentials preserved.");
}
