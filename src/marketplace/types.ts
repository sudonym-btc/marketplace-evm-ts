import type { MarketplaceEvmClient } from '../client.js'
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
  type: 'evm:multi-auction'
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
  multiAuctionAddress?: EvmAddress
  multiAuctionBytecodeHash?: EvmHex
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

export type GenericAmount = {
  value: string
  denomination: string
  decimals: number
}

export type GenericPaymentIdentity = {
  pubkey?: string
  address?: string
  data?: Record<string, unknown>
}

export type GenericPaymentIntent = {
  method: string
  subject: 'order' | 'bid'
  tradeId: string
  settlementId: string
  accountIndex: number
  seed?: string
  amount: GenericAmount
  fee: GenericAmount
  asset: {
    method: string
    assetId: string
    denomination: string
    decimals: number
    chainId?: number
    assetAddress?: string
    data?: Record<string, unknown>
  }
  policy: {
    method: string
    id: string
    type?: string
    hash?: string
    chainId?: number
    contractAddress?: string
    data?: Record<string, unknown>
  }
  contract: {
    type: string
    chainId?: number
    address?: string
    bytecodeHash?: string
    params: Record<string, unknown>
  }
  participants: {
    buyer?: GenericPaymentIdentity
    seller: GenericPaymentIdentity
    escrow: GenericPaymentIdentity
  }
  unlockAt: number
  metadata?: Record<string, unknown>
}

export type GenericPaymentProof = {
  method: string
  params: Record<string, unknown>
}

export type GenericPaymentValidationRequest = {
  method: string
  proof: GenericPaymentProof
  expected: {
    settlementId: string
    tradeId?: string
    amount?: GenericAmount
    contract?: {
      chainId?: number
      address?: string
      bytecodeHash?: string
      params?: Record<string, unknown>
    }
    participants?: {
      buyer?: GenericPaymentIdentity
      seller?: GenericPaymentIdentity
      escrow?: GenericPaymentIdentity
    }
    fee?: GenericAmount
  }
  now?: number
}

export type GenericPaymentValidationResult = {
  method: 'evm'
  status: 'valid' | 'invalid' | 'pending' | 'expired' | 'unverifiable'
  confirmations?: number
  amountMatched?: boolean
  assetMatched?: boolean
  recipientMatched?: boolean
  escrowMatched?: boolean
  data?: Record<string, unknown>
  error?: string
}

export type GenericBolt11PaymentRequest = {
  type: 'bolt11'
  bolt11: string
  amount?: GenericAmount
  description?: string
  expiresAt?: number
  data?: Record<string, unknown>
}

export type GenericPolicyPaymentState =
  | {
      type: 'payment_required'
      request: GenericBolt11PaymentRequest
      proof?: GenericPaymentProof | null
      data?: Record<string, unknown>
    }
  | {
      type: 'payment_progress'
      status: string
      proof?: GenericPaymentProof | null
      data?: Record<string, unknown>
    }
  | {
      type: 'paid'
      proof: GenericPaymentProof
      data?: Record<string, unknown>
    }
  | {
      type: 'completed'
      proof?: GenericPaymentProof | null
      data?: Record<string, unknown>
    }

export type GenericPaymentRecoveryItem = {
  subject: 'order' | 'bid'
  group?: unknown
  payment?: unknown
  proof: GenericPaymentProof
  expected?: GenericPaymentValidationRequest['expected']
}

export type GenericPaymentRecoveryState =
  | { type: 'noop'; data?: Record<string, unknown> }
  | { type: 'progress'; status: string; data?: Record<string, unknown> }
  | { type: 'recovered'; data?: Record<string, unknown> }

export type EvmEscrowPolicy = {
  method: 'evm'
  id: 'evm:multi-escrow'
  subject: 'order'
  family: 'escrow'
  policies(): EvmEscrowPaymentPolicy[]
  assets(): EvmPaymentAsset[]
  discoverHighWatermark(context: {
    seed: string
    highWaterMark: number
    unusedWindow: number
    now?: number
  }): Promise<{
    policy: 'evm:multi-escrow'
    maxUsedIndex: number
    nextUnusedIndex: number
    scannedFrom: number
    scannedThrough: number
    unusedWindow: number
    usedIndexes: number[]
    recoveryActions: unknown[]
  }>
  startup(context: {
    seed: string
    highWaterMark: number
    nextUnusedIndex: number
    unusedWindow: number
    discovery: unknown
    now?: number
  }): Promise<{
    policy: 'evm:multi-escrow'
    data: Record<string, unknown>
  }>
  recover(payment: GenericPaymentRecoveryItem): AsyncIterable<GenericPaymentRecoveryState>
  pay(intent: GenericPaymentIntent): AsyncIterable<GenericPolicyPaymentState>
  validatePayment(request: GenericPaymentValidationRequest): Promise<GenericPaymentValidationResult>
  client(seed: string, tradeIndex?: number): MarketplaceEvmClient
  state(): EvmMarketplacePolicyState
}

export type EvmAuctionPolicy = {
  method: 'evm'
  id: 'evm:multi-auction'
  subject: 'bid'
  family: 'auction'
  policies(): EvmAuctionPaymentPolicy[]
  assets(): EvmPaymentAsset[]
  discoverHighWatermark(context: {
    seed: string
    highWaterMark: number
    unusedWindow: number
    now?: number
  }): Promise<{
    policy: 'evm:multi-auction'
    maxUsedIndex: number
    nextUnusedIndex: number
    scannedFrom: number
    scannedThrough: number
    unusedWindow: number
    usedIndexes: number[]
    recoveryActions: unknown[]
  }>
  startup(context: {
    seed: string
    highWaterMark: number
    nextUnusedIndex: number
    unusedWindow: number
    discovery: unknown
    now?: number
  }): Promise<{
    policy: 'evm:multi-auction'
    data: Record<string, unknown>
  }>
  recover(payment: GenericPaymentRecoveryItem): AsyncIterable<GenericPaymentRecoveryState>
  pay(intent: GenericPaymentIntent): AsyncIterable<GenericPolicyPaymentState>
  validatePayment(request: GenericPaymentValidationRequest): Promise<GenericPaymentValidationResult>
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
  description: string
}
