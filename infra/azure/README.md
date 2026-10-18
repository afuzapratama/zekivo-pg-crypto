# Azure staging Devnet

Target: Southeast Asia, US$200/month planning budget, credit expiry month July 2027. No Mainnet, live treasury signer, local validator, Mailpit or test receiver
is deployed. GitHub Actions currently validate code/templates only; they do not
have Azure deployment credentials or permission to deploy.

## Files and validation

- `main.bicep`: subscription deployment creating only `rg-zekivo-pg-staging`
  plus the foundation module: VNet, dedicated delegated app/DB subnets, private
  PostgreSQL 17 B1ms/32 GB/7-day backup, private DNS, ACR Basic without admin login,
  Key Vault Standard/RBAC/purge protection, Log Analytics 30 days/0.1 GB daily cap,
  Consumption-only workload profile environment. No dedicated profile, NAT gateway,
  Container Apps private endpoint, HA or geo-redundant backup.
- `workloads.bicep`: four apps with separate managed identities and secret-level
  Key Vault permissions. One replica each at 0.25 vCPU/0.5 GiB; no scale-to-zero.
  API/web HTTPS ingress; worker/monitor have no ingress. Runtime DB role has DML,
  migrations use another credential. No Entra secret on worker/monitor.
- `jobs.bicep`: manually triggered bootstrap or migration job, 600s timeout,
  no retry, distinct identity with only corresponding Key Vault secret access.
  Deploying a job definition does not execute it.
- `budget.bicep`: subscription budget filtered to staging resource group **and**
  its explicit Container Apps managed resource group. Thresholds 50/80/100%
  actual and 100% forecast. Contact email and billing currency verification are
  required before deployment. Budget sends alerts; it does not stop spending.
- `database-bootstrap.mjs`: manual job creates migrator/runtime roles and grants
  defaults for future migrated tables. Credentials from Key Vault, no SQL secrets
  in logs. Runtime has no schema CREATE. This is not complete per-table least
  privilege: runtime can access all application tables, as current app expects.

```sh
az bicep build --file infra/azure/main.bicep --outfile /tmp/zekivo-foundation.json
az bicep build --file infra/azure/workloads.bicep --outfile /tmp/zekivo-workloads.json
az bicep build --file infra/azure/jobs.bicep --outfile /tmp/zekivo-jobs.json
az bicep build --file infra/azure/budget.bicep --outfile /tmp/zekivo-budget.json
node scripts/azure-staging-costs.mjs
```

Foundation subscription What-If succeeded on 17 October 2026, reporting creation
of a new resource group and nine resources. No resource was actually created.
The disposable secure password used for What-If was not committed or reused for
actual deployment. Workloads/jobs/budget compile locally; cloud validation of
those templates needs the foundation, image and secret resources first. What-If
is not capacity reservation or proof a real deployment will succeed.

## Reviewed cost model

`retail-prices.snapshot.json` records selected Microsoft Retail Prices API meters,
region, effective dates and retrieval time. `scripts/azure-staging-costs.mjs`
reproduces a 31-day calculation. All four apps are assumed active all month;
no free grants or startup credit discounts are subtracted. Approximate total
**US$197.44**, including US$15 contingency and US$5 jobs/build/traffic allowance.
Steady modeled services before those allowances cost about US$177.44.

The margin to US$200 is small in the all-active case. Log caps are not hard billing
caps, ingestion can overshoot, free grants are subscription-shared, network traffic
and deployment revision overlap vary, and 0.5 GiB may need increasing after load
measurements. B1ms is a staging starting point, not a production sizing guarantee.
A paid RPC provider, tax/exchange rates, higher traffic, other subscription services,
long build jobs and extra backup/storage can exceed this model. Public Key Vault
and ACR endpoints require RBAC; private endpoints/Premium ACR would change pricing.
Do not treat US$197.44 as a guaranteed invoice. Reprice and adjust capacity before
provisioning if the actual region/SKU, usage or billing currency differs.

Source:
[Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices),
[Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing),
[VNet managed-resource charges](https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks).

## Deployment order after review

1. Confirm active subscription, providers, region capacity, billing currency,
   alert recipient and cost model. The managed RG is explicitly named
   `rg-zekivo-pg-staging-managed`; budget must include it too.
2. Generate a unique admin password; pass via secure parameter file with mode
   0600 outside the repo. Deploy `main.bicep`. Do not use the random What-If
   password for a real database unless it has been saved securely. Store actual
   credentials in Key Vault; purge protection prevents immediate name reuse.
3. Build `infra/docker/Dockerfile` target `runtime`, push an immutable image to
   ACR and use its `@sha256:` digest in workloads/jobs. The build bundles monitor
   as well as API/worker/web. Image contains source and dependency tree; `.env*`,
   `.devnet`, Git metadata and test reports are excluded by `.dockerignore`.
4. Assign the operator/deploy identity necessary Key Vault secret write rights
   explicitly. Create bootstrap and migration secrets below; do not grant all
   runtime identities vault-wide secret access.
5. Deploy/start bootstrap job once from the private app network; verify success.
   Deploy/start migration job using migrator DSN; apply all migrations before
   apps. Do not run migrations from the public workstation by opening DB firewall.
6. Provision the **new** Azure database with Devnet mint/recipient/genesis/project
   configuration using controlled tooling; never restore localnet data or copy
   real local session/key histories. Current Devnet provision CLI must be reviewed
   and executed deliberately against the Azure staging database, not assumed
   automatically part of Bicep. No treasury private key is required.
7. Register/update Entra Web callback to the foundation's webUrl plus
   `/api/admin/auth/callback`; preserve localhost callback for local development.
   Confirm dashboard tenant/client IDs and operator allowlist. Hosted origin is
   HTTPS, so Secure cookies become effective. Verify MFA separately.
8. Deploy `workloads.bicep` with foundation defaultDomain, registry/vault names,
   digest, tenant and client IDs. API/web probes and runtime readiness must pass.
   RBAC propagation may require retrying revision deployment; do not broaden roles
   to work around it. Worker/monitor stay running but do not have HTTP liveness
   endpoints; observe their DB heartbeats and external monitor separately.
9. Verify HTTPS login/checkout/API, migration, chain config and alerts; then set
   up receiver staging and delivery tests. Webhook delivery remains **false** in
   this initial template. No external test endpoint is auto-registered.

## Required secret names (values never in Git)

| Secret                        | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `database-admin-url`          | Bootstrap only; `zkpgbootstrap` DSN to gateway_staging |
| `database-migrator-password`  | Random base64url, 32–128 chars; bootstrap              |
| `database-runtime-password`   | Separate random base64url; bootstrap                   |
| `database-migration-url`      | `zkpg_migrator` DSN; migration job only                |
| `database-runtime-url`        | `zkpg_runtime` DSN; API/worker/monitor                 |
| `solana-devnet-rpc-url`       | Devnet RPC endpoint; no Mainnet                        |
| `webhook-encryption-key`      | New staging 64-hex key, API/worker                     |
| `notification-encryption-key` | Separate new staging 64-hex key, API/worker/monitor    |
| `entra-client-secret`         | Dashboard Entra app, API only                          |
| `admin-allowed-identities`    | JSON object UUID → role, API only                      |
| `coingecko-demo-api-key`      | CoinGecko Demo pricing, staging API only               |

All DSNs use `sslmode=verify-full`, percent-encoded credentials, and the Azure
PostgreSQL FQDN (not a private IP). No secrets are created by Bicep from source
values except the secure DB admin parameter. Bootstrap passwords and DSNs must
agree; writing an incorrect DSN is not fixed by identity RBAC. The bootstrap job
requires admin credential access; remove its job/permissions after bootstrap if
not needed. Its script is idempotent but rerunning changes role passwords.

## Remaining deployment work

Foundation, registry, database bootstrap/provision and initial workloads are already
running in Azure staging. Subsequent releases use the migration job before updating
workloads to an immutable image digest. Do not rerun bootstrap or replace staging
credentials for an application update. Pricing requires `coingecko-demo-api-key` in
Key Vault; only the API receives that secret and pricing configuration. The
60-second cache is demand-driven and shared through PostgreSQL. The 9,000-call
budget is per database/key, so monitor total account usage if local Devnet shares
the same CoinGecko credential.

GitHub CI validates releases; Azure deployment currently runs manually. Azure OIDC
automatic deployment, external uptime, backup restore drill and remaining failure
checks remain tracked in `docs/STAGING-READINESS.md`. Webhook delivery stays disabled
until a staging receiver is configured and verified.

The manual `provision` job initializes the dedicated `gateway_staging` database
with the pinned USDC and Mock USDT Devnet accounts. Its explicit future-only
opening balance policy records existing test funds in the initial-boundary audit;
it does not create payments or ledger credit from them. Initialization refuses
any invoice/payment-attempt history before creating a missing checkpoint, and
reruns never move an existing checkpoint. The local Devnet CLI retains its
zero-opening-balance default. Provision job credentials are `staging-project-id`
and `staging-api-key` in Key Vault; never include them in deployment output.
