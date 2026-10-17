import { loadConfig } from "../../../packages/config/src/index.js";
import { createPool } from "../../../packages/database/src/pool.js";
import { buildReceiver } from "./app.js";
const config = loadConfig();
if (config.APP_ENV !== "local") throw new Error("Local receiver only");
const secret =
    process.env.LOCAL_WEBHOOK_SECRET ?? "whsec_local_development_only",
  controlToken =
    process.env.LOCAL_RECEIVER_CONTROL_TOKEN ?? "local_receiver_control_only";
if (!secret || !controlToken)
  throw new Error("Local receiver credentials missing");
const pool = createPool(config.DATABASE_URL),
  app = buildReceiver(pool, {
    APP_ENV: "local",
    secret,
    controlToken,
    projectId: "00000000-0000-4000-8000-000000000001",
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    await pool.end();
  });
await app.listen({ host: config.HOST, port: 4200 });
