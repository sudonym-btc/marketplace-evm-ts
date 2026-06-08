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
} from './types.js'
import type { paths } from './openapi.generated.js'

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
