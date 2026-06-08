import type { EvmAddress, EvmHash, EvmHex } from '../types.js'
import type { components } from './openapi.generated.js'

type OpenApiReverseRequest = components['schemas']['ReverseRequest']
type OpenApiReverseResponse = components['schemas']['ReverseResponse']
type OpenApiReversePair = components['schemas']['ReversePair']
type OpenApiSubmarineRequest = components['schemas']['SubmarineRequest']
type OpenApiSubmarineResponse = components['schemas']['SubmarineResponse']
type OpenApiSubmarinePair = components['schemas']['SubmarinePair']
type OpenApiSwapStatus = components['schemas']['SwapStatus']

export type BoltzSwapStatus =
  | 'swap.created'
  | 'invoice.set'
  | 'invoice.pending'
  | 'invoice.paid'
  | 'transaction.mempool'
  | 'transaction.confirmed'
  | 'transaction.claimed'
  | 'transaction.refunded'
  | 'swap.expired'
  | 'swap.failed'

export type BoltzStatusUpdate = Omit<OpenApiSwapStatus, 'status' | 'transaction'> & {
  id?: string
  status: BoltzSwapStatus | string
  transaction?: {
    id?: EvmHash
    hex?: string
  }
  transactionHash?: EvmHash
  error?: string
}

export type BoltzReverseSwapRequest = Omit<
  OpenApiReverseRequest,
  'claimAddress' | 'claimCovenant' | 'preimageHash'
> & {
  preimageHash: EvmHex
  claimAddress: EvmAddress
  /** Boltz 3.12.1's OpenAPI marks this required even though the API defaults it to false. */
  claimCovenant?: boolean
}

export type BoltzReverseSwapResponse = Omit<
  OpenApiReverseResponse,
  'lockupAddress' | 'refundAddress' | 'timeoutBlockHeight'
> & {
  lockupAddress?: EvmAddress
  refundAddress?: EvmAddress
  timeoutBlockHeight: number
}

export type BoltzSubmarineSwapRequest = Omit<OpenApiSubmarineRequest, 'invoice'> & {
  invoice: string
}

export type BoltzSubmarineSwapResponse = Omit<
  OpenApiSubmarineResponse,
  'address' | 'expectedAmount' | 'timeoutBlockHeight'
> & {
  address?: EvmAddress
  /** EVM submarine swaps return this at runtime, but Boltz 3.12.1's OpenAPI schema omits it. */
  claimAddress?: EvmAddress
  expectedAmount?: number
  timeoutBlockHeight: number
}

export type BoltzPairTable<Pair> = Record<string, Record<string, Pair>>

export type BoltzReversePair = OpenApiReversePair

export type BoltzSubmarinePair = OpenApiSubmarinePair

export type BoltzClient = {
  getReversePairs(): Promise<BoltzPairTable<BoltzReversePair>>
  getSubmarinePairs(): Promise<BoltzPairTable<BoltzSubmarinePair>>
  createReverseSwap(request: BoltzReverseSwapRequest): Promise<BoltzReverseSwapResponse>
  createSubmarineSwap(request: BoltzSubmarineSwapRequest): Promise<BoltzSubmarineSwapResponse>
  getSwap(id: string): Promise<BoltzStatusUpdate>
  subscribeSwap(id: string): AsyncIterable<BoltzStatusUpdate>
  getSubmarinePreimage(id: string): Promise<EvmHex>
  getCooperativeRefundSignature(id: string): Promise<EvmHex | null>
}

export type BoltzCurrencyResolver = {
  currencyForAsset(chainId: number, assetAddress?: EvmAddress): string
}
