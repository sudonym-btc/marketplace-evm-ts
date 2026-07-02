export function evmPurchaseInvoiceDescription(tradeId: string): string {
  return `Marketplace Purchase ${tradeId}`
}

export function evmPayoutInvoiceDescription(tradeId: string): string {
  return `Marketplace Payout ${tradeId}`
}
