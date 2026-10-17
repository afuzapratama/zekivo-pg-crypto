param name string
param location string
param environmentName string
param registryName string
param vaultName string
param image string
param command array
param env array
param secrets array
param port int = 0
param external bool = false
resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = { name: environmentName }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: registryName }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-identity'
  location: location
}
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
resource kvSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = [
  for secret in secrets: { parent: vault, name: secret.name }
]
resource secretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
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
var secretEnv = [for secret in secrets: { name: secret.env, secretRef: secret.name }]
resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  tags: { application: 'zekivo-pg', environment: 'staging', cluster: 'devnet' }
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [
        for secret in secrets: {
          name: secret.name
          keyVaultUrl: '${vault.properties.vaultUri}secrets/${secret.name}'
          identity: identity.id
        }
      ]
      ingress: port > 0 ? { external: external, targetPort: port, transport: 'http', allowInsecure: false } : null
    }
    template: {
      containers: [
        {
          name: name
          image: image
          command: command
          env: concat(env, secretEnv)
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          probes: port > 0
            ? [
                {
                  type: 'Startup'
                  tcpSocket: { port: port }
                  initialDelaySeconds: 5
                  periodSeconds: 5
                  failureThreshold: 60
                }
                {
                  type: 'Liveness'
                  httpGet: { path: port == 4100 ? '/health' : '/login', port: port }
                  periodSeconds: 30
                  failureThreshold: 3
                }
                {
                  type: 'Readiness'
                  httpGet: { path: port == 4100 ? '/ready' : '/login', port: port }
                  periodSeconds: 30
                  timeoutSeconds: 15
                  failureThreshold: 3
                }
              ]
            : []
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [pull, secretAccess]
}
output name string = app.name
