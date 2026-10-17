# Security and repository handling

Do not commit environment files, wallet/private keys, Azure/Entra credentials,
webhook secrets, real checkout capabilities or database dumps. `.env.example`
contains development placeholders only. Local `.devnet/`, test reports and
compiled output are excluded from Git and Docker build context.

Report vulnerabilities privately through this repository's GitHub Security
Advisories when enabled, or contact the repository owner privately. Do not file
public issues containing credentials, customer payment data or exploit secrets.

GitHub checks validate code and infrastructure; passing CI is not evidence of
production readiness. Only staging Devnet is currently intended; production and
Mainnet remain disabled. No server workload should receive treasury private keys.

Changes should use a branch and pull request. Do not force-push or delete main.
The initial commit imports the existing working project; subsequent releases
should record commit SHA, image digest and database migration version.
