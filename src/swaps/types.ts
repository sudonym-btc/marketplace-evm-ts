import type { BoltzClient, BoltzStatusUpdate } from '../boltz/types.js'
import type { NamedEvmCall } from '../types.js'
import type { EvmAddress, EvmAmount, EvmOperationRecord, EvmOperationStore } from '../types.js'
import type { EvmAccountManager } from '../accounts.js'
import type { EvmHex } from '../types.js'
import type { EvmSeedConfig } from '../seed.js'

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
  postClaimCalls?: NamedEvmCall[]
}

export type SwapOutRequest = SwapAttemptRequest & {
  chainId: number
  boltzCurrency: string
  lightningCurrency?: string
  assetAddress?: EvmAddress
  amount?: EvmAmount
  invoice?: string
  invoiceDescription?: string
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
      description?: string
    }
  | {
      type: 'awaiting_resolution'
      operation: EvmOperationRecord
      swapId: string
      expectedAmount?: number
      claimAddress?: EvmAddress
      lockupAddress?: EvmAddress
      limits?: SwapAmountLimits
      timeoutBlockHeight: number
    }
  | {
      type: 'completed'
      operation: EvmOperationRecord
      preimage?: string
    }

export type SwapResumeResult = {
  operation: EvmOperationRecord
  latestStatus?: BoltzStatusUpdate
}

export type SwapServiceOptions = {
  boltz: BoltzClient
  store: EvmOperationStore
  seed: string | EvmSeedConfig
  accounts: EvmAccountManager
  now?: () => number
}

export type EvmSwapService = {
  swapIn(request: SwapInRequest): Promise<SwapInResult>
  swapOut(request: SwapOutRequest): Promise<SwapOutResult>
  resume(id: string): Promise<SwapResumeResult>
  listActive(): Promise<EvmOperationRecord[]>
}
