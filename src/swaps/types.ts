import type { BoltzClient, BoltzStatusUpdate } from '../boltz/types.js'
import type { NamedEvmCall } from '../types.js'
import type {
  EvmAddress,
  EvmAmount,
  EvmBoltzChainTrust,
  EvmOperationRecord,
  EvmOperationStore,
  ResolvedEvmChainConfig,
} from '../types.js'
import type { EvmAccountManager } from '../accounts.js'
import type { EvmHex } from '../types.js'
import type { EvmSeedConfig } from '../seed.js'
import type { MarketplaceDriverLogger } from '@sudonym-btc/marketplace-driver-interface'

export type SwapAttemptRequest = {
  tradeIndex: number
  attemptIndex: number
}

export type SwapInRequest = SwapAttemptRequest & {
  chainId: number
  boltzCurrency: string
  lightningCurrency?: string
  assetAddress?: EvmAddress
  amount: EvmAmount
  boltzAmountSats?: number
  description?: string
  routeVia?: {
    boltzCurrency: string
    assetAddress: EvmAddress
    decimals: number
    quoteCurrency: string
  }
  postClaimCalls?: NamedEvmCall[]
  /** Public proof template used to reconstruct publication after a crash. */
  recoveryProof?: Record<string, unknown>
}

export type SwapOutRequest = SwapAttemptRequest & {
  chainId: number
  boltzCurrency: string
  lightningCurrency?: string
  assetAddress?: EvmAddress
  amount?: EvmAmount
  invoice?: string
  invoiceDescription?: string
  routeVia?: {
    boltzCurrency: string
    assetAddress: EvmAddress
    decimals: number
    quoteCurrency: string
  }
  preLockCalls?: NamedEvmCall[]
}

export type SwapAmountLimits = {
  source: 'boltz'
  direction: 'swap-in' | 'swap-out'
  from: string
  to: string
  amountSats?: number
  minimal: number | null
  maximal: number | null
  pairHash?: string
}

export type SwapInResult =
  | {
      type: 'external_payment_required'
      operation: EvmOperationRecord
      invoice: string
      swapId: string
      amount?: EvmAmount
      onchainAmount?: number
      preimage?: EvmHex
      preimageHash: EvmHex
      lockupAddress?: EvmAddress
      refundAddress?: EvmAddress
      claimAssetAddress?: EvmAddress
      postClaimCalls?: NamedEvmCall[]
      limits?: SwapAmountLimits
      timeoutBlockHeight: number
    }
  | {
      type: 'completed'
      operation: EvmOperationRecord
      txHash: string
    }

export type SwapOutResult =
  | {
      type: 'external_invoice_required'
      operation: EvmOperationRecord
      amount?: EvmAmount
      invoiceAmountSats?: number
      description?: string
      lockAssetAddress?: EvmAddress
      preLockCalls?: NamedEvmCall[]
      limits?: SwapAmountLimits
    }
  | {
      type: 'awaiting_resolution'
      operation: EvmOperationRecord
      swapId: string
      expectedAmount?: number
      claimAddress?: EvmAddress
      lockupAddress?: EvmAddress
      lockAssetAddress?: EvmAddress
      preLockCalls?: NamedEvmCall[]
      limits?: SwapAmountLimits
      timeoutBlockHeight: number
      preimageHash?: EvmHex
    }
  | {
      type: 'completed'
      operation: EvmOperationRecord
      preimage?: string
    }

export type SwapResumeResult = {
  operation: EvmOperationRecord
  latestStatus?: BoltzStatusUpdate
  /** Returned only at completion and never persisted by the service. */
  preimage?: EvmHex
  /** Provider signature for an early cooperative refund; never persisted. */
  cooperativeRefundSignature?: EvmHex
}

export type SwapServiceOptions = {
  boltz: BoltzClient
  store: EvmOperationStore
  seed: string | EvmSeedConfig
  accounts: EvmAccountManager
  chains: ResolvedEvmChainConfig[]
  trustByChainId?: Record<number, EvmBoltzChainTrust>
  now?: () => number
  logger?: MarketplaceDriverLogger
}

export type EvmSwapService = {
  swapIn(request: SwapInRequest): Promise<SwapInResult>
  swapOut(request: SwapOutRequest): Promise<SwapOutResult>
  resume(id: string): Promise<SwapResumeResult>
  listActive(): Promise<EvmOperationRecord[]>
}
