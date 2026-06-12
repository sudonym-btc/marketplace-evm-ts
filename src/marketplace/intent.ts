import type { EvmAddress, EvmAmount, EvmHex } from '../types.js'
import { zeroAddress } from '../utils/hex.js'
import type {
  EvmPaymentAsset,
  EvmResolvedPaymentIntent,
  GenericPaymentIntent,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

function address(value: string | undefined, label: string): EvmAddress {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid ${label}`)
  return value as EvmAddress
}

function hash(value: string | undefined, label: string): EvmHex {
  if (!value) throw new Error(`Invalid ${label}`)
  const normalized = value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error(`Invalid ${label}`)
  return normalized as EvmHex
}

function logicalCurrency(denomination: string): string {
  const normalized = denomination.toUpperCase()
  if (normalized === 'USDT' || normalized === 'USDC') return 'USD'
  if (normalized === 'SAT' || normalized === 'SATS' || normalized === 'XBT') return 'BTC'
  return normalized
}

function chainFor(
  chains: ResolvedEvmMarketplaceChainConfig[],
  chainId: number | undefined,
): ResolvedEvmMarketplaceChainConfig {
  if (chainId === undefined) throw new Error('EVM payment intent is missing chainId')
  const chain = chains.find(candidate => candidate.chainId === chainId)
  if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${chainId}`)
  return chain
}

function assetForIntent(
  chain: ResolvedEvmMarketplaceChainConfig,
  intent: GenericPaymentIntent,
): EvmPaymentAsset {
  const assetAddress = address(intent.asset.assetAddress, 'assetAddress')
  const asset = [chain.nativeAsset, ...(chain.assets ?? [])].find(
    candidate => candidate.address.toLowerCase() === assetAddress.toLowerCase(),
  )
  if (!asset) throw new Error(`No EVM asset configured for ${assetAddress} on chain ${chain.chainId}`)
  return {
    method: 'evm',
    assetId: `${chain.chainId}:${asset.address.toLowerCase()}`,
    currency: intent.asset.currency ?? logicalCurrency(asset.denomination),
    denomination: asset.denomination,
    decimals: asset.decimals,
    appId: 'marketplace-evm-ts',
    chainId: chain.chainId,
    assetAddress: asset.address,
    ...(asset.boltzCurrency ? { boltzCurrency: asset.boltzCurrency } : {}),
    ...(asset.boltzRouteVia ? { boltzRouteVia: asset.boltzRouteVia } : {}),
  }
}

function evmAmount(amount: { value: string; currency?: string; denomination: string; decimals: number }, decimals: number): EvmAmount {
  return {
    value: BigInt(amount.value),
    ...(amount.currency ? { currency: amount.currency } : {}),
    denomination: amount.denomination,
    decimals,
  }
}

export function resolveEvmPaymentIntent(
  chains: ResolvedEvmMarketplaceChainConfig[],
  intent: GenericPaymentIntent,
): EvmResolvedPaymentIntent {
  if (intent.method !== 'evm') throw new Error(`EVM escrow policy cannot pay ${intent.method} intent`)
  if (intent.purpose !== 'order' && intent.purpose !== 'bid') {
    throw new Error(`EVM escrow policy cannot pay ${intent.purpose} intents`)
  }
  if (!intent.seed) throw new Error('EVM payment requires a marketplace seed')

  const chain = chainFor(chains, intent.contract.chainId ?? intent.asset.chainId ?? intent.policy.chainId)
  const asset = assetForIntent(chain, intent)
  const contractAddress = address(intent.contract.address ?? intent.policy.contractAddress, 'contractAddress')
  const sellerAddress = address(intent.participants.seller.address, 'sellerAddress')
  const arbiterAddress = address(intent.participants.arbiter.address, 'arbiterAddress')
  const contractBytecodeHash = hash(intent.contract.bytecodeHash ?? intent.policy.hash, 'contractBytecodeHash')

  return {
    tradeId: intent.tradeId,
    settlementId: intent.settlementId,
    purpose: intent.purpose,
    accountIndex: intent.accountIndex,
    seed: intent.seed,
    chain,
    asset,
    contractAddress,
    contractBytecodeHash,
    policy: {
      id: intent.policy.id,
      type: intent.policy.type ?? intent.contract.type,
    },
    sellerAddress,
    arbiterAddress,
    amount: evmAmount(intent.amount, asset.decimals),
    fee: evmAmount(intent.fee, asset.decimals),
    unlockAt: BigInt(intent.unlockAt),
    ...(intent.metadata ? { metadata: intent.metadata } : {}),
    description: intent.purpose === 'bid'
      ? `Marketplace auction bid ${intent.settlementId}`
      : `Marketplace escrow ${intent.settlementId}`,
  }
}

export function assetBalanceKey(assetAddress: EvmAddress): string {
  return assetAddress.toLowerCase() === zeroAddress ? 'native' : assetAddress.toLowerCase()
}
