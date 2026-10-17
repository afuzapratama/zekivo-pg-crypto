import { loadConfig } from "../../../packages/config/src/index.js";
import { createPool } from "../../../packages/database/src/pool.js";
import { buildApp } from "./app.js";
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = buildApp(pool, config);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await app.close();
    await pool.end();
  });
await app.listen({ host: config.HOST, port: config.PORT });
