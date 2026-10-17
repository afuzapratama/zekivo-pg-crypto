targetScope = 'resourceGroup'
param location string = 'southeastasia'
param prefix string = 'zkpgstg'
param environmentName string = '${prefix}-env'
param registryName string
param vaultName string
param image string
@allowed(['bootstrap', 'migrate'])
param kind string
resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = { name: environmentName }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: registryName }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-${kind}-identity'
  location: location
}
var secrets = kind == 'bootstrap'
  ? [
      { name: 'database-admin-url', env: 'DATABASE_URL' }
      { name: 'database-migrator-password', env: 'MIGRATOR_PASSWORD' }
      { name: 'database-runtime-password', env: 'RUNTIME_PASSWORD' }
    ]
  : [{ name: 'database-migration-url', env: 'DATABASE_URL' }]
resource kvSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = [
  for secret in secrets: { parent: vault, name: secret.name }
]
resource permissions 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (secret, i) in secrets: {
    name: guid(kvSecrets[i].id, identity.id, 'secrets-user')
    scope: kvSecrets[i]
    properties: {
      principalId: identity.properties.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId(
        'Microsoft.Authorization/roleDefinitions',
        '4633458b-17de-408a-b874-0445c86b69e6'
      )
    }
  }
]
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}
var secretEnv = [for secret in secrets: { name: secret.env, secretRef: secret.name }]
resource job 'Microsoft.App/jobs@2025-01-01' = {
  name: '${prefix}-${kind}'
  location: location
  tags: { application: 'zekivo-pg', environment: 'staging', cluster: 'devnet' }
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [
        for secret in secrets: {
          name: secret.name
          keyVaultUrl: '${vault.properties.vaultUri}secrets/${secret.name}'
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: kind
          image: image
          command: kind == 'bootstrap' ? ['node', 'infra/azure/database-bootstrap.mjs'] : ['pnpm', 'db:migrate']
          env: concat([{ name: 'APP_ENV', value: 'staging' }, { name: 'SOLANA_CLUSTER', value: 'devnet' }], secretEnv)
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
    }
  }
  dependsOn: [permissions, pull]
}
output jobName string = job.name
