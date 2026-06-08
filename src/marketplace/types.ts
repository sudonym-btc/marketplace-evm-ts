import type { MarketplaceEvmClient } from '../client.js'
import type {
  MarketplaceDriverAmount,
  MarketplaceDriverAuctionPolicy,
  MarketplaceDriverAuctionSettlementIntent,
  MarketplaceDriverAuctionSettlementResult,
  MarketplaceDriverBolt11PaymentRequest,
  MarketplaceDriverOrderPolicy,
  MarketplaceDriverIdentity,
  MarketplaceDriverPaymentIntent,
  MarketplaceDriverPaymentProof,
  MarketplaceDriverPaymentState,
  MarketplaceDriverRecoveryItem,
  MarketplaceDriverRecoveryState,
  MarketplaceDriverStartContext,
  MarketplaceDriverStartResult,
  MarketplaceDriverValidationRequest,
  MarketplaceDriverValidationResult,
  MarketplaceDriverWatermarkContext,
  MarketplaceDriverWatermarkDiscovery,
} from '@sudonym-btc/marketplace-driver-interface'
import type {
  EvmAddress,
  EvmAmount,
  EvmChainConfig,
  EvmHex,
  EvmOperationStore,
  ResolvedEvmChainConfig,
} from '../types.js'

export type EvmEscrowPaymentPolicy = {
  method: 'evm'
  id: string
  type: 'evm:multi-escrow'
  hash: EvmHex
  chainId: number
  contractAddress: EvmAddress
}

export type EvmAuctionPaymentPolicy = {
  method: 'evm'
  id: string
  type: 'evm:multi-escrow-auction-v1'
  hash: EvmHex
  chainId: number
  contractAddress: EvmAddress
}

export type EvmPaymentPolicy = EvmEscrowPaymentPolicy | EvmAuctionPaymentPolicy

export type EvmPaymentAsset = {
  method: 'evm'
  assetId: string
  denomination: string
  decimals: number
  appId: string
  chainId: number
  assetAddress: EvmAddress
  boltzCurrency?: string
}

export type EvmMarketplaceChainConfig = EvmChainConfig & {
  multiEscrowAddress: EvmAddress
  multiEscrowBytecodeHash?: EvmHex
}

export type ResolvedEvmMarketplaceChainConfig = ResolvedEvmChainConfig & EvmMarketplaceChainConfig

export type EvmMarketplacePolicyState = {
  enabled: boolean
  started: boolean
  maxUsedIndex: number
  nextTradeIndex: number
  startSummary: string
  error?: string
}

export type EvmMarketplacePolicyOptions = {
  chains: EvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  appId?: string
}

export type GenericAmount = MarketplaceDriverAmount
export type GenericPaymentIdentity = MarketplaceDriverIdentity
export type GenericPaymentIntent = MarketplaceDriverPaymentIntent
export type GenericPaymentProof = MarketplaceDriverPaymentProof
export type GenericPaymentValidationRequest = MarketplaceDriverValidationRequest
export type GenericPaymentValidationResult = MarketplaceDriverValidationResult & { method: 'evm' }
export type GenericBolt11PaymentRequest = MarketplaceDriverBolt11PaymentRequest
export type GenericPolicyPaymentState = MarketplaceDriverPaymentState<GenericPaymentProof>
export type GenericPaymentRecoveryItem = MarketplaceDriverRecoveryItem<
  GenericPaymentProof,
  GenericPaymentValidationRequest['expected']
>
export type GenericPaymentRecoveryState = Exclude<MarketplaceDriverRecoveryState<GenericPaymentProof>, { type: 'settlement_ready' }>
export type GenericAuctionSettlementIntent = MarketplaceDriverAuctionSettlementIntent<
  GenericPaymentProof,
  GenericPaymentValidationRequest['expected']
>
export type GenericAuctionSettlementResult = MarketplaceDriverAuctionSettlementResult<GenericPaymentProof>

export type EvmEscrowPolicy = MarketplaceDriverOrderPolicy<
  GenericPolicyPaymentState,
  EvmEscrowPaymentPolicy,
  EvmPaymentAsset,
  GenericPaymentIntent,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  GenericPaymentRecoveryItem,
  GenericPaymentRecoveryState
> & {
  method: 'evm'
  id: 'evm:multi-escrow'
  policies(): EvmEscrowPaymentPolicy[]
  assets(): EvmPaymentAsset[]
  discoverHighWatermark(context: MarketplaceDriverWatermarkContext): Promise<
    MarketplaceDriverWatermarkDiscovery & {
    policy: 'evm:multi-escrow'
    maxUsedIndex: number
    nextUnusedIndex: number
    scannedFrom: number
    scannedThrough: number
    unusedWindow: number
    usedIndexes: number[]
    recoveryActions: unknown[]
  }>
  startup(context: MarketplaceDriverStartContext): Promise<
    MarketplaceDriverStartResult & {
    policy: 'evm:multi-escrow'
    data: Record<string, unknown>
  }>
  recover(payment: GenericPaymentRecoveryItem): AsyncIterable<GenericPaymentRecoveryState>
  pay(intent: GenericPaymentIntent): AsyncIterable<GenericPolicyPaymentState>
  validatePayment(request: GenericPaymentValidationRequest): Promise<GenericPaymentValidationResult>
  client(seed: string, tradeIndex?: number): MarketplaceEvmClient
  state(): EvmMarketplacePolicyState
}

export type EvmAuctionPolicy = MarketplaceDriverAuctionPolicy<
  GenericPolicyPaymentState,
  EvmAuctionPaymentPolicy,
  EvmPaymentAsset,
  GenericPaymentIntent,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  GenericPaymentRecoveryItem,
  GenericPaymentRecoveryState,
  GenericAuctionSettlementIntent,
  GenericAuctionSettlementResult
> & {
  method: 'evm'
  id: 'evm:multi-escrow-auction-v1'
  policies(): EvmAuctionPaymentPolicy[]
  assets(): EvmPaymentAsset[]
  discoverHighWatermark(context: MarketplaceDriverWatermarkContext): Promise<
    MarketplaceDriverWatermarkDiscovery & {
    policy: 'evm:multi-escrow-auction-v1'
    maxUsedIndex: number
    nextUnusedIndex: number
    scannedFrom: number
    scannedThrough: number
    unusedWindow: number
    usedIndexes: number[]
    recoveryActions: unknown[]
  }>
  startup(context: MarketplaceDriverStartContext): Promise<
    MarketplaceDriverStartResult & {
    policy: 'evm:multi-escrow-auction-v1'
    data: Record<string, unknown>
  }>
  recover(payment: GenericPaymentRecoveryItem): AsyncIterable<GenericPaymentRecoveryState>
  pay(intent: GenericPaymentIntent): AsyncIterable<GenericPolicyPaymentState>
  validatePayment(request: GenericPaymentValidationRequest): Promise<GenericPaymentValidationResult>
  refundPayment(intent: GenericAuctionSettlementIntent & {
    action: 'auction_refund'
    refundPercent: number
  }): Promise<GenericAuctionSettlementResult>
  recyclePayment(intent: GenericAuctionSettlementIntent & {
    action: 'auction_promote'
    targetTradeId: string
    targetOrderGroupId: string
  }): Promise<GenericAuctionSettlementResult>
  state(): EvmMarketplacePolicyState
}

export type EvmPayRequest = {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  intent: GenericPaymentIntent
  state: EvmMarketplacePolicyState
  setState(state: EvmMarketplacePolicyState): void
}

export type EvmResolvedPaymentIntent = {
  tradeId: string
  settlementId: string
  subject: 'order' | 'bid'
  accountIndex: number
  seed: string
  chain: ResolvedEvmMarketplaceChainConfig
  asset: EvmPaymentAsset
  contractAddress: EvmAddress
  contractBytecodeHash: EvmHex
  policy: {
    id: string
    type: string
  }
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  amount: EvmAmount
  fee: EvmAmount
  unlockAt: bigint
  metadata?: Record<string, unknown>
  description: string
}
