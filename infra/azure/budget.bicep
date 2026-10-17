targetScope = 'subscription'
param resourceGroupName string = 'rg-zekivo-pg-staging'
@description('Amount in subscription billing currency; confirm USD before applying.')
param amount int = 200
@description('First of a month, e.g. 2026-10-01T00:00:00Z; cannot be changed casually on an existing budget.')
param startDate string
@description('End of credit month; credit exact expiry must be confirmed separately.')
param endDate string = '2027-08-01T00:00:00Z'
@minLength(1)
param contactEmails array
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'zekivo-staging-monthly'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    filter: {
      dimensions: {
        name: 'ResourceGroupName'
        operator: 'In'
        values: [resourceGroupName, '${resourceGroupName}-managed']
      }
    }
    timePeriod: { startDate: startDate, endDate: endDate }
    notifications: {
      actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: contactEmails
      }
    }
  }
}
