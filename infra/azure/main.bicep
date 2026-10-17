targetScope = 'subscription'
@allowed(['southeastasia'])
param location string = 'southeastasia'
param resourceGroupName string = 'rg-zekivo-pg-staging'
@secure()
@minLength(24)
param databaseAdminPassword string
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: { application: 'zekivo-pg', environment: 'staging', cluster: 'devnet' }
}
module foundation './modules/foundation.bicep' = {
  name: 'staging-foundation'
  scope: rg
  params: { location: location, databaseAdminPassword: databaseAdminPassword }
}
output resourceGroup string = rg.name
output infrastructure object = foundation.outputs
