targetScope = 'resourceGroup'
param location string = 'southeastasia'
param prefix string = 'zkpgstg'
@description('Digest reference only, e.g. <acr>.azurecr.io/gateway@sha256:<64 hex>')
param image string
param environmentName string = '${prefix}-env'
param registryName string
param vaultName string
param entraTenantId string
param entraClientId string
param domain string
var origin = 'https://${prefix}-web.${domain}'
var api = 'https://${prefix}-api.${domain}'
var common = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'APP_ENV', value: 'staging' }
  { name: 'SOLANA_CLUSTER', value: 'devnet' }
  { name: 'ENABLED_ASSETS', value: 'USDT,USDC' }
  { name: 'SCAN_INTERVAL_MS', value: '10000' }
  { name: 'CHAIN_MONITORING', value: 'true' }
  { name: 'WEBHOOK_DELIVERY', value: 'false' }
  { name: 'LOCAL_PLAYGROUND', value: 'false' }
  { name: 'LOCAL_MAILPIT_ENABLED', value: 'false' }
  { name: 'WEB_ORIGIN', value: origin }
  { name: 'HOST', value: '0.0.0.0' }
  { name: 'PORT', value: '4100' }
]
var databaseSecret = { name: 'database-runtime-url', env: 'DATABASE_URL' }
var rpcSecret = { name: 'solana-devnet-rpc-url', env: 'SOLANA_RPC_URL' }
var notificationSecret = { name: 'notification-encryption-key', env: 'NOTIFICATION_ENCRYPTION_KEY' }
var webhookSecret = { name: 'webhook-encryption-key', env: 'WEBHOOK_ENCRYPTION_KEY' }
var specs = [
  {
    role: 'web'
    port: 3100
    external: true
    command: ['node', 'apps/web/node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '3100']
    env: [
      { name: 'NODE_ENV', value: 'production' }
      { name: 'APP_ENV', value: 'staging' }
      { name: 'SOLANA_CLUSTER', value: 'devnet' }
      { name: 'WEB_ORIGIN', value: origin }
      { name: 'API_INTERNAL_URL', value: api }
      { name: 'API_PUBLIC_URL', value: api }
      { name: 'LOCAL_PLAYGROUND', value: 'false' }
    ]
    secrets: []
  }
  {
    role: 'api'
    port: 4100
    external: true
    command: ['node', 'apps/api/dist/main.js']
    env: concat(
      common,
      [
        { name: 'ADMIN_AUTH_ENABLED', value: 'true' }
        { name: 'ENTRA_TENANT_ID', value: entraTenantId }
        { name: 'ENTRA_CLIENT_ID', value: entraClientId }
      ]
    )
    secrets: [
      databaseSecret
      rpcSecret
      notificationSecret
      webhookSecret
      { name: 'entra-client-secret', env: 'ENTRA_CLIENT_SECRET' }
      { name: 'admin-allowed-identities', env: 'ADMIN_ALLOWED_IDENTITIES' }
    ]
  }
  {
    role: 'worker'
    port: 0
    external: false
    command: ['node', 'apps/worker/dist/main.js']
    env: common
    secrets: [databaseSecret, rpcSecret, notificationSecret, webhookSecret]
  }
  {
    role: 'monitor'
    port: 0
    external: false
    command: ['node', 'packages/monitoring/dist/main.js']
    env: concat(common, [{ name: 'MONITOR_API_URL', value: api }])
    secrets: [databaseSecret, rpcSecret, notificationSecret]
  }
]
module apps './modules/app.bicep' = [
  for spec in specs: {
    name: 'app-${spec.role}'
    params: {
      name: '${prefix}-${spec.role}'
      location: location
      environmentName: environmentName
      registryName: registryName
      vaultName: vaultName
      image: image
      command: spec.command
      env: spec.env
      secrets: spec.secrets
      port: spec.port
      external: spec.external
    }
  }
]
output webUrl string = origin
output apiUrl string = api
