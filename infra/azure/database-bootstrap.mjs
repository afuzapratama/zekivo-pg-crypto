// Run only as a manually started staging bootstrap job on the private Azure network.
// Values come from distinct Key Vault secrets, never command-line arguments.
import pg from "pg";
if (
  process.env.APP_ENV !== "staging" ||
  process.env.SOLANA_CLUSTER !== "devnet"
)
  throw new Error("Database bootstrap is staging/devnet only");
const roles = [
  ["zkpg_migrator", process.env.MIGRATOR_PASSWORD],
  ["zkpg_runtime", process.env.RUNTIME_PASSWORD],
];
for (const [, password] of roles)
  if (!password || !/^[A-Za-z0-9_-]{32,128}$/.test(password))
    throw new Error(
      "Use separate random base64url passwords of 32–128 characters",
    );
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !url.hostname.endsWith(".postgres.database.azure.com") ||
  url.pathname !== "/gateway_staging" ||
  url.searchParams.get("sslmode") !== "verify-full"
)
  throw new Error(
    "Expected Azure staging database with certificate verification",
  );
const client = new pg.Client({
  connectionString: url.href,
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(70104)");
  for (const [role, password] of roles) {
    const exists = (
      await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])
    ).rowCount;
    // Identifiers are fixed constants, and passwords are restricted base64url above.
    if (!exists)
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    else await client.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
    await client.query(`GRANT CONNECT ON DATABASE gateway_staging TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  }
  await client.query("GRANT CREATE ON SCHEMA public TO zkpg_migrator");
  await client.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO zkpg_runtime",
  );
  await client.query(
    "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO zkpg_runtime",
  );
  // Azure's server admin must be a member to manage another role's defaults.
  await client.query(
    `GRANT zkpg_migrator TO ${pg.escapeIdentifier(url.username)}`,
  );
  await client.query(
    "ALTER DEFAULT PRIVILEGES FOR ROLE zkpg_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO zkpg_runtime",
  );
  await client.query(
    "ALTER DEFAULT PRIVILEGES FOR ROLE zkpg_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO zkpg_runtime",
  );
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      event: "staging.database_roles_ready",
      roles: roles.map(([role]) => role),
    }),
  );
} catch {
  await client.query("ROLLBACK").catch(() => {});
  // Do not expose SQL/password/connection strings via pg error objects.
  throw new Error(
    "Staging database bootstrap failed; inspect permissions and connectivity securely",
  );
} finally {
  await client.end();
}
