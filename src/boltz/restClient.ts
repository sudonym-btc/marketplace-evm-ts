import createOpenApiClient from 'openapi-fetch'

import type {
  BoltzClient,
  BoltzReversePair,
  BoltzReverseSwapRequest,
  BoltzReverseSwapResponse,
  BoltzSubmarinePair,
  BoltzStatusUpdate,
  BoltzSubmarineSwapRequest,
  BoltzSubmarineSwapResponse,
  BoltzPairTable,
  BoltzDexQuote,
  BoltzDexQuoteRequest,
  BoltzDexEncodeRequest,
} from './types.js'
import type { paths } from './openapi.generated.js'
import type { EvmHex } from '../types.js'

export type BoltzRestClientOptions = {
  apiUrl: string
  fetch?: typeof fetch
}

export class BoltzApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload)
    super(`Boltz API ${status}: ${message}`)
    this.name = 'BoltzApiError'
  }
}

export function isBoltzMissingSwapError(error: unknown): boolean {
  return (
    error instanceof BoltzApiError &&
    error.status === 404 &&
    typeof error.payload === 'object' &&
    error.payload !== null &&
    typeof (error.payload as Record<string, unknown>).error === 'string' &&
    (error.payload as Record<string, string>).error.includes('could not find swap')
  )
}

function normalizeBaseUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/v2') ? trimmed : `${trimmed}/v2`
}

function boltzApiError(status: number, error: unknown): Error {
  return new BoltzApiError(status, error)
}

function readData<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    throw boltzApiError(result.response.status, result.error)
  }
  if (result.data === undefined) throw boltzApiError(result.response.status, 'missing response body')
  return result.data
}

function firstQuote(quotes: Array<{ quote: string; data: Record<string, unknown> }>, label: string): {
  quote: bigint
  data: Record<string, unknown>
} {
  const quote = quotes[0]
  if (!quote) throw new Error(`No Boltz DEX quote available for ${label}`)
  return {
    quote: BigInt(quote.quote),
    data: quote.data,
  }
}

function prefixedHex(value: string): EvmHex {
  return (value.startsWith('0x') ? value : `0x${value}`) as EvmHex
}

export function createBoltzRestClient(options: BoltzRestClientOptions): BoltzClient {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const client = createOpenApiClient<paths>({
    baseUrl: normalizeBaseUrl(options.apiUrl),
    fetch: fetchImpl as (input: Request) => Promise<Response>,
  })

  return {
    async getReversePairs(): Promise<BoltzPairTable<BoltzReversePair>> {
      return readData(
        await client.GET('/swap/reverse'),
      ) as BoltzPairTable<BoltzReversePair>
    },

    async getSubmarinePairs(): Promise<BoltzPairTable<BoltzSubmarinePair>> {
      return readData(
        await client.GET('/swap/submarine'),
      ) as BoltzPairTable<BoltzSubmarinePair>
    },

    async createReverseSwap(request: BoltzReverseSwapRequest): Promise<BoltzReverseSwapResponse> {
      return readData(
        await client.POST('/swap/reverse', {
          body: {
            ...request,
            claimCovenant: request.claimCovenant ?? false,
            preimageHash: request.preimageHash.replace(/^0x/, ''),
          },
        }),
      ) as BoltzReverseSwapResponse
    },

    async createSubmarineSwap(request: BoltzSubmarineSwapRequest): Promise<BoltzSubmarineSwapResponse> {
      return readData(
        await client.POST('/swap/submarine', {
          body: request,
        }),
      ) as BoltzSubmarineSwapResponse
    },

    async quoteTokenAmountIn(currency: string, request: BoltzDexQuoteRequest): Promise<BoltzDexQuote> {
      const quotes = readData(
        await client.GET('/quote/{currency}/in', {
          params: {
            path: { currency },
            query: {
              tokenIn: request.tokenIn,
              tokenOut: request.tokenOut,
              amountIn: request.amount.toString(),
            },
          },
        }),
      ) as Array<{ quote: string; data: Record<string, unknown> }>
      const quote = firstQuote(quotes, `${request.tokenIn}->${request.tokenOut}`)
      return {
        amountIn: request.amount,
        amountOut: quote.quote,
        data: quote.data,
      }
    },

    async quoteTokenAmountOut(currency: string, request: BoltzDexQuoteRequest): Promise<BoltzDexQuote> {
      const quotes = readData(
        await client.GET('/quote/{currency}/out', {
          params: {
            path: { currency },
            query: {
              tokenIn: request.tokenIn,
              tokenOut: request.tokenOut,
              amountOut: request.amount.toString(),
            },
          },
        }),
      ) as Array<{ quote: string; data: Record<string, unknown> }>
      const quote = firstQuote(quotes, `${request.tokenIn}->${request.tokenOut}`)
      return {
        amountIn: quote.quote,
        amountOut: request.amount,
        data: quote.data,
      }
    },

    async encodeTokenSwap(currency: string, request: BoltzDexEncodeRequest) {
      const encoded = readData(
        await client.POST('/quote/{currency}/encode', {
          params: { path: { currency } },
          body: {
            recipient: request.recipient,
            amountIn: request.amountIn.toString(),
            amountOutMin: request.amountOutMin.toString(),
            data: request.data,
          },
        }),
      ) as { calls: Array<{ to: string; value?: string; data: string }> }

      return encoded.calls.map((call, index) => ({
        name: `DEX.${index}`,
        to: call.to as `0x${string}`,
        value: BigInt(call.value ?? '0'),
        data: prefixedHex(call.data),
      }))
    },

    async getSwap(id: string): Promise<BoltzStatusUpdate> {
      return readData(
        await client.GET('/swap/{id}', {
          params: { path: { id } },
        }),
      ) as BoltzStatusUpdate
    },

    async *subscribeSwap(id: string): AsyncIterable<BoltzStatusUpdate> {
      yield await this.getSwap(id)
    },

    async getSubmarinePreimage(id: string) {
      const response = readData(
        await client.GET('/swap/submarine/{id}/preimage', {
          params: { path: { id } },
        }),
      )
      return response.preimage as `0x${string}`
    },

    async getCooperativeRefundSignature(id: string) {
      const response = readData(
        await client.GET('/swap/submarine/{id}/refund', {
          params: { path: { id } },
        }),
      ) as { signature?: string | null }
      return (response.signature ?? null) as `0x${string}` | null
    },
  }
}
