import type { EvmAsset } from '../types.js'
import type { EvmPaymentAsset, EvmMarketplaceChainConfig } from './types.js'

function chainAssetId(chainId: number, asset: EvmAsset): string {
  return `${chainId}:${asset.address.toLowerCase()}`
}

function logicalCurrency(denomination: string): string {
  const normalized = denomination.toUpperCase()
  if (normalized === 'USDT' || normalized === 'USDC') return 'USD'
  if (normalized === 'SAT' || normalized === 'SATS' || normalized === 'XBT') return 'BTC'
  return normalized
}

export function evmPaymentAssets(
  chains: EvmMarketplaceChainConfig[],
  appId = 'marketplace-evm-ts',
): EvmPaymentAsset[] {
  return chains.flatMap(chain =>
    [chain.nativeAsset, ...(chain.assets ?? [])].map(asset => ({
      method: 'evm',
      assetId: chainAssetId(chain.chainId, asset),
      currency: logicalCurrency(asset.denomination),
      denomination: asset.denomination,
      decimals: asset.decimals,
      appId,
      chainId: chain.chainId,
      assetAddress: asset.address,
      ...(asset.boltzCurrency ? { boltzCurrency: asset.boltzCurrency } : {}),
    })),
  )
}
