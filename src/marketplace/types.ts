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
  MarketplaceDriverPaymentSettlementIntent,
  MarketplaceDriverPaymentSettlementState,
  MarketplaceDriverPaymentProof,
  MarketplaceDriverPaymentState,
  MarketplaceDriverPaymentSweepInput,
  MarketplaceDriverPaymentSweepState,
  MarketplaceDriverStartContext,
  MarketplaceDriverStartResult,
  MarketplaceDriverSwapResumeContext,
  MarketplaceDriverSwapResumeState,
  MarketplaceDriverValidationExpected,
  MarketplaceDriverValidationRequest,
  MarketplaceDriverValidationResult,
  MarketplaceDriverWatermarkContext,
  MarketplaceDriverWatermarkDiscovery,
  MarketplaceDriverLogger,
} from '@sudonym-btc/marketplace-driver-interface'
import type {
  EvmAddress,
  EvmAmount,
  EvmBoltzRouteVia,
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
  currency?: string
  denomination: string
  decimals: number
  appId: string
  chainId: number
  assetAddress: EvmAddress
  boltzCurrency?: string
  boltzRouteVia?: EvmBoltzRouteVia
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
  logger?: MarketplaceDriverLogger
}

export type GenericAmount = MarketplaceDriverAmount
export type GenericPaymentIdentity = MarketplaceDriverIdentity
export type GenericPaymentIntent = MarketplaceDriverPaymentIntent
export type GenericPaymentProof = MarketplaceDriverPaymentProof
export type GenericPaymentValidationRequest = MarketplaceDriverValidationRequest
export type GenericPaymentValidationResult = MarketplaceDriverValidationResult & { driver: 'evm' }
export type GenericBolt11PaymentRequest = MarketplaceDriverBolt11PaymentRequest
export type GenericPolicyPaymentState = MarketplaceDriverPaymentState<GenericPaymentProof>
export type GenericPaymentSweepInput = MarketplaceDriverPaymentSweepInput<
  GenericPaymentProof,
  MarketplaceDriverValidationExpected
>
export type GenericPaymentSweepState = MarketplaceDriverPaymentSweepState<GenericPaymentProof>
export type GenericPaymentSettlementIntent = MarketplaceDriverPaymentSettlementIntent<
  GenericPaymentProof,
  MarketplaceDriverValidationExpected
>
export type GenericPaymentSettlementState = MarketplaceDriverPaymentSettlementState<GenericPaymentProof>
export type GenericSwapResumeContext = MarketplaceDriverSwapResumeContext
export type GenericSwapResumeState = MarketplaceDriverSwapResumeState
export type GenericAuctionSettlementIntent = MarketplaceDriverAuctionSettlementIntent<
  GenericPaymentProof,
  MarketplaceDriverValidationExpected
>
export type GenericAuctionSettlementResult = MarketplaceDriverAuctionSettlementResult<GenericPaymentProof>

export type EvmEscrowPolicy = MarketplaceDriverOrderPolicy<
  GenericPolicyPaymentState,
  EvmEscrowPaymentPolicy,
  EvmPaymentAsset,
  GenericPaymentIntent,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  GenericPaymentSweepInput,
  GenericPaymentSweepState,
  GenericPaymentSettlementIntent,
  GenericPaymentSettlementState,
  GenericSwapResumeContext,
  GenericSwapResumeState
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
  resumeSwapOperations(context: GenericSwapResumeContext): AsyncIterable<GenericSwapResumeState>
  sweepPayment(payment: GenericPaymentSweepInput): AsyncIterable<GenericPaymentSweepState>
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
  GenericPaymentSweepInput,
  GenericPaymentSweepState,
  GenericPaymentSettlementIntent,
  GenericPaymentSettlementState,
  GenericSwapResumeContext,
  GenericSwapResumeState,
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
  resumeSwapOperations(context: GenericSwapResumeContext): AsyncIterable<GenericSwapResumeState>
  sweepPayment(payment: GenericPaymentSweepInput): AsyncIterable<GenericPaymentSweepState>
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
  logger?: MarketplaceDriverLogger
}

export type EvmResolvedPaymentIntent = {
  tradeId: string
  settlementId: string
  purpose: 'order' | 'bid'
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
