import type { Address, Hash, Hex, LocalAccount, PublicClient } from 'viem'
import type { EntryPointVersion } from 'viem/account-abstraction'
import type { MarketplaceDriverLogger } from '@sudonym-btc/marketplace-driver-interface'
import type { EvmProtocolActivityProbe, EvmSmartAccountAddressResolver } from './discovery/types.js'
import type { EvmSeedConfig } from './seed.js'

export type EvmHex = Hex
export type EvmAddress = Address
export type EvmHash = Hash

export type EvmBoltzRouteVia = {
  boltzCurrency: string
  assetAddress: EvmAddress
  decimals: number
  quoteCurrency?: string
}

export type EvmAsset = {
  chainId: number
  address: EvmAddress
  denomination: string
  decimals: number
  boltzCurrency?: string
  boltzRouteVia?: EvmBoltzRouteVia
}

export type EvmAmount = {
  value: bigint
  currency?: string
  denomination: string
  decimals: number
}

export type EvmChainConfig = {
  id: string
  chainId: number
  name?: string
  boltzCurrency?: string
  rpcUrl?: string
  publicClient?: PublicClient
  /**
   * Optional base URL for a human-facing block explorer for this chain.
   * Consumers can use this to build payment-proof links such as transaction pages.
   */
  blockExplorerUrl?: string
  nativeAsset: EvmAsset
  assets?: EvmAsset[]
  boltz?: EvmBoltzConfig
  accountAbstraction: EvmAaConfig
}

export type ResolvedEvmChainConfig = EvmChainConfig & {
  publicClient: PublicClient
}

export type EvmAaConfig = {
  entryPointAddress: EvmAddress
  factoryAddress: EvmAddress
  entryPointVersion?: EntryPointVersion
  bundlerUrl: string
  paymasterUrl?: string
  paymasterAddress?: EvmAddress
  paymasterContext?: unknown
  sponsorshipPolicyId?: string
  userOperationReceiptTimeoutMs?: number
  userOperationReceiptPollingIntervalMs?: number
}

export type EvmCall = {
  to: EvmAddress
  data: EvmHex
  value?: bigint
}

export type NamedEvmCall = EvmCall & {
  name: string
}

export type EvmExecutionOptions = {
  chainId: number
  operationId?: string
  waitForReceipt?: boolean
}

export type EvmExecutionResult = {
  txHash: EvmHash
  accountAddress: EvmAddress
  gasSponsored?: boolean
  userOperationHash?: EvmHash
}

export type EvmExecutor = {
  getAddress(chainId: number): Promise<EvmAddress>
  execute(calls: NamedEvmCall[], options: EvmExecutionOptions): Promise<EvmExecutionResult>
}

export type EvmOperationStatus =
  | 'initialised'
  | 'external_payment_required'
  | 'external_invoice_required'
  | 'awaiting_onchain'
  | 'claiming'
  | 'locking'
  | 'settling'
  | 'completed'
  | 'refunding'
  | 'refunded'
  | 'failed'

export type EvmOperationRecord = {
  id: string
  kind: 'swap_in' | 'swap_out' | 'escrow'
  status: EvmOperationStatus
  chainId: number
  tradeId?: string
  swapId?: string
  txHash?: EvmHash
  error?: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type EvmOperationQuery = {
  kind?: EvmOperationRecord['kind']
  status?: EvmOperationStatus | EvmOperationStatus[]
  chainId?: number
  tradeId?: string
  swapId?: string
}

export type EvmOperationStore = {
  get(id: string): Promise<EvmOperationRecord | null>
  put(record: EvmOperationRecord): Promise<void>
  list(query?: EvmOperationQuery): Promise<EvmOperationRecord[]>
  delete(id: string): Promise<void>
}

export type MarketplaceEvmClientOptions = {
  chains: EvmChainConfig[]
  operationStore: EvmOperationStore
  executor?: EvmExecutor
  account?: LocalAccount
  seed?: string | EvmSeedConfig
  tradeIndex?: number
  protocolActivityProbe?: EvmProtocolActivityProbe
  smartAccountAddressResolver?: EvmSmartAccountAddressResolver
  boltz?: EvmBoltzConfig
  now?: () => number
  logger?: MarketplaceDriverLogger
}

export type EvmBoltzConfig = {
  apiUrl: string
  wsUrl?: string
  nativeCurrencyByChainId?: Record<number, string>
}
