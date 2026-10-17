import { readFile } from "node:fs/promises";
const snapshot = JSON.parse(
  await readFile(
    new URL("../infra/azure/retail-prices.snapshot.json", import.meta.url),
    "utf8",
  ),
);
const rate = (name) => {
  const row = snapshot.rates.find((r) => r.meterName === name);
  if (!row) throw new Error(`Missing retail meter ${name}`);
  return row.retailPrice;
};
const days = 31,
  hours = days * 24,
  seconds = hours * 3600;
const items = {
  containerCpuAllActive: seconds * 1 * rate("Standard vCPU Active Usage"),
  containerMemoryAllActive: seconds * 2 * rate("Standard Memory Active Usage"),
  postgresB1ms: hours * rate("B1MS"),
  postgres32gb: 32 * rate("Storage Data Stored"),
  registryBasic: days * rate("Basic Registry Unit"),
  networkTwoPublicIps: hours * 2 * rate("Standard IPv4 Static Public IP"),
  networkOneLoadBalancer:
    hours * rate("Standard Included LB Rules and Outbound Rules"),
  logsAtDailyQuota: days * 0.1 * rate("Analytics Logs Data Ingestion"),
  privateDnsZone: rate("Private Zone"),
  privateDnsQueries100k: 0.1 * rate("Private Queries"),
  requests100k: 0.1 * rate("Standard Requests"),
  keyVault10kOperations: rate("Operations"),
  backupExtra1gb: rate("Backup Storage LRS Data Stored"),
  loadBalancerData1gb: rate("Standard Data Processed"),
  jobsBuildTrafficAllowance: 5,
  contingency: 15,
};
const total = Object.values(items).reduce((a, b) => a + b, 0);
console.log(
  JSON.stringify(
    {
      region: "southeastasia",
      days,
      replicas: 4,
      cpuPerReplica: 0.25,
      memoryGiBPerReplica: 0.5,
      currency: "USD",
      freeGrantsApplied: false,
      ratesAsOf: snapshot.retrievedAt,
      items: Object.fromEntries(
        Object.entries(items).map(([k, v]) => [k, Number(v.toFixed(2))]),
      ),
      estimatedTotal: Number(total.toFixed(2)),
      budget: 200,
      withinPlanningBudget: total <= 200,
    },
    null,
    2,
  ),
);
if (total > 200) process.exitCode = 1;
