import type { EvmAddress, ResolvedEvmChainConfig } from '../types.js'
import type { EvmSeedConfig } from '../seed.js'

export type EvmIndexActivityReason =
  | 'smart_account_deployed'
  | 'entrypoint_nonce'
  | 'protocol_activity'

export type EvmProtocolActivityProbeContext = {
  chain: ResolvedEvmChainConfig
  tradeIndex: number
  ownerAddress: EvmAddress
  smartAccountAddress: EvmAddress
  seed: EvmSeedConfig
}

export type EvmProtocolActivity = {
  used: boolean
  reason?: string
  recoveryActions?: unknown[]
  data?: Record<string, unknown>
}

export type EvmProtocolActivityProbe = (
  context: EvmProtocolActivityProbeContext,
) => Promise<EvmProtocolActivity | null | undefined>

export type EvmSmartAccountAddressResolverContext = {
  chain: ResolvedEvmChainConfig
  tradeIndex: number
  ownerAddress: EvmAddress
  seed: EvmSeedConfig
}

export type EvmSmartAccountAddressResolver = (
  context: EvmSmartAccountAddressResolverContext,
) => Promise<EvmAddress>

export type EvmChainIndexActivity = {
  chainId: number
  ownerAddress: EvmAddress
  smartAccountAddress: EvmAddress
  smartAccountDeployed: boolean
  entryPointNonce: bigint
  used: boolean
  reasons: EvmIndexActivityReason[]
  protocolActivity?: EvmProtocolActivity
}

export type EvmTradeIndexActivity = {
  tradeIndex: number
  used: boolean
  chains: EvmChainIndexActivity[]
}

export type EvmDiscoverHighWatermarkOptions = {
  seed?: string | EvmSeedConfig
  highWaterMark?: number
  unusedWindow?: number
  fromTradeIndex?: number
  chainIds?: number[]
  protocolActivityProbe?: EvmProtocolActivityProbe
  smartAccountAddressResolver?: EvmSmartAccountAddressResolver
}

export type EvmHighWatermarkDiscovery = {
  driver: 'evm'
  maxUsedIndex: number
  nextUnusedIndex: number
  highWaterMark: number
  scannedFrom: number
  scannedThrough: number
  unusedWindow: number
  usedTradeIndexes: number[]
  trades: EvmTradeIndexActivity[]
  recoveryActions: unknown[]
}
