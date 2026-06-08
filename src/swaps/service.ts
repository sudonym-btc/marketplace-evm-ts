import type { BoltzPairTable, BoltzReversePair, BoltzSubmarinePair } from '../boltz/types.js'
import type { EvmOperationRecord, EvmOperationStatus } from '../types.js'
import { deriveEvmSwapMaterial, resolveEvmSeedConfig } from '../seed.js'
import { btcAmountToSats } from './amounts.js'
import type { EvmSwapService, SwapAmountLimits, SwapInRequest, SwapOutRequest, SwapServiceOptions } from './types.js'

const duplicatePreimageHashError = 'Boltz API 400: {"error":"a swap with this preimage hash exists already"}'
const maxSwapInCreateAttempts = 25

type LimitReason = 'unsupported_pair' | 'below_minimum' | 'above_maximum'

export class SwapAmountLimitError extends Error {
  readonly name = 'SwapAmountLimitError'
  readonly code = 'PAYMENT_AMOUNT_LIMIT'

  constructor(
    readonly reason: LimitReason,
    readonly limits: SwapAmountLimits,
  ) {
    super(formatLimitMessage(reason, limits))
  }
}

function nowSeconds(now?: () => number): number {
  return now ? now() : Math.floor(Date.now() / 1000)
}

function isDuplicatePreimageHashError(error: unknown): boolean {
  return error instanceof Error && error.message === duplicatePreimageHashError
}

function formatLimitMessage(reason: LimitReason, limits: SwapAmountLimits): string {
  if (reason === 'unsupported_pair') {
    return `No Boltz ${limits.direction} pair is configured for ${limits.from} -> ${limits.to}`
  }
  if (reason === 'below_minimum') {
    return `Payment amount ${limits.amountSats} sats is below the Boltz ${limits.direction} minimum ${limits.minimal} sats for ${limits.from} -> ${limits.to}`
  }
  return `Payment amount ${limits.amountSats} sats is above the Boltz ${limits.direction} maximum ${limits.maximal} sats for ${limits.from} -> ${limits.to}`
}

function pairFor<Pair extends { hash?: string; limits?: { minimal?: number; maximal?: number } }>(
  pairs: BoltzPairTable<Pair>,
  from: string,
  to: string,
): Pair | undefined {
  return pairs[from]?.[to] ?? pairs[from.toUpperCase()]?.[to] ?? pairs[from]?.[to.toUpperCase()]
}

function assertBoltzLimits(input: {
  direction: SwapAmountLimits['direction']
  from: string
  to: string
  amountSats?: number
  pair?: { hash?: string; limits?: { minimal?: number; maximal?: number } }
}): SwapAmountLimits {
  const limits: SwapAmountLimits = {
    source: 'boltz',
    direction: input.direction,
    from: input.from,
    to: input.to,
    minimal: input.pair?.limits?.minimal ?? null,
    maximal: input.pair?.limits?.maximal ?? null,
    ...(input.amountSats !== undefined ? { amountSats: input.amountSats } : {}),
    ...(input.pair?.hash ? { pairHash: input.pair.hash } : {}),
  }
  if (!input.pair) throw new SwapAmountLimitError('unsupported_pair', limits)
  if (input.amountSats !== undefined && limits.minimal !== null && input.amountSats < limits.minimal) {
    throw new SwapAmountLimitError('below_minimum', limits)
  }
  if (input.amountSats !== undefined && limits.maximal !== null && input.amountSats > limits.maximal) {
    throw new SwapAmountLimitError('above_maximum', limits)
  }
  return limits
}

function operation(
  request: { id: string; chainId: number },
  kind: EvmOperationRecord['kind'],
  status: EvmOperationStatus,
  data: Record<string, unknown>,
  now?: () => number,
): EvmOperationRecord {
  const timestamp = nowSeconds(now)
  return {
    id: request.id,
    kind,
    status,
    chainId: request.chainId,
    data,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function publicSwapRequest<T extends SwapInRequest | SwapOutRequest>(
  request: T,
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...request,
    id,
    ...extra,
  }
}

export function createEvmSwapService(options: SwapServiceOptions): EvmSwapService {
  const seed = resolveEvmSeedConfig(options.seed)

  return {
    async swapIn(request: SwapInRequest) {
      const claimAddress = await options.accounts.smartAccountAddress(request.tradeIndex, request.chainId)
      const from = request.lightningCurrency ?? 'BTC'
      const to = request.boltzCurrency
      const pairs = await options.boltz.getReversePairs()
      const pair = pairFor<BoltzReversePair>(pairs, from, to)
      if (!pair) {
        assertBoltzLimits({ direction: 'swap-in', from, to })
        throw new Error('unreachable')
      }
      const requestedOnchainAmount = request.boltzAmountSats ?? btcAmountToSats(request.amount)
      const limits = assertBoltzLimits({
        direction: 'swap-in',
        from,
        to,
        amountSats: requestedOnchainAmount,
        pair,
      })

      for (let offset = 0; offset < maxSwapInCreateAttempts; offset += 1) {
        const attemptIndex = request.attemptIndex + offset
        const attemptRequest = { ...request, attemptIndex }
        const material = deriveEvmSwapMaterial(seed.seed, {
          tradeIndex: request.tradeIndex,
          chainId: request.chainId,
          direction: 'swap-in',
          attemptIndex,
        })

        try {
          const reverse = await options.boltz.createReverseSwap({
            from,
            to,
            preimageHash: material.preimageHash,
            claimAddress,
            onchainAmount: requestedOnchainAmount,
            ...(limits.pairHash ? { pairHash: limits.pairHash } : {}),
            ...(request.description ? { description: request.description } : {}),
          })
          const onchainAmount = reverse.onchainAmount ?? requestedOnchainAmount
          const record = operation(
            { id: material.operationId, chainId: request.chainId },
            'swap_in',
            'external_payment_required',
            {
              request: publicSwapRequest(attemptRequest, material.operationId, {
                preimageHash: material.preimageHash,
                claimAddress,
              }),
              swapId: reverse.id,
              invoice: reverse.invoice,
              onchainAmount,
              lockupAddress: reverse.lockupAddress,
              refundAddress: reverse.refundAddress,
              timeoutBlockHeight: reverse.timeoutBlockHeight,
              postClaimCalls: request.postClaimCalls,
            },
            options.now,
          )
          record.swapId = reverse.id
          await options.store.put(record)
          return {
            type: 'external_payment_required',
            operation: record,
            invoice: reverse.invoice,
            swapId: reverse.id,
            amount: request.amount,
            onchainAmount,
            preimage: material.preimage,
            preimageHash: material.preimageHash,
            limits,
            ...(reverse.lockupAddress ? { lockupAddress: reverse.lockupAddress } : {}),
            ...(reverse.refundAddress ? { refundAddress: reverse.refundAddress } : {}),
            timeoutBlockHeight: reverse.timeoutBlockHeight,
          }
        } catch (error) {
          if (!isDuplicatePreimageHashError(error)) throw error
        }
      }

      throw new Error(`Could not create swap-in after ${maxSwapInCreateAttempts} deterministic attempts`)
    },

    async swapOut(request: SwapOutRequest) {
      const material = deriveEvmSwapMaterial(seed.seed, {
        tradeIndex: request.tradeIndex,
        chainId: request.chainId,
        direction: 'swap-out',
        attemptIndex: request.attemptIndex,
      })
      const senderAddress = await options.accounts.smartAccountAddress(request.tradeIndex, request.chainId)
      if (!request.invoice) {
        const record = operation(
          { id: material.operationId, chainId: request.chainId },
          'swap_out',
          'external_invoice_required',
          {
            request: publicSwapRequest(request, material.operationId, { senderAddress }),
            senderAddress,
            preLockCalls: request.preLockCalls,
          },
          options.now,
        )
        await options.store.put(record)
        return {
          type: 'external_invoice_required',
          operation: record,
          ...(request.amount ? { amount: request.amount } : {}),
          ...(request.invoiceDescription ? { description: request.invoiceDescription } : {}),
        }
      }

      const from = request.boltzCurrency
      const to = request.lightningCurrency ?? 'BTC'
      const pairs = await options.boltz.getSubmarinePairs()
      const pair = pairFor<BoltzSubmarinePair>(pairs, from, to)
      if (!pair) {
        assertBoltzLimits({ direction: 'swap-out', from, to })
        throw new Error('unreachable')
      }
      const amountSats = request.amount ? btcAmountToSats(request.amount) : undefined
      const limits = assertBoltzLimits({
        direction: 'swap-out',
        from,
        to,
        ...(amountSats !== undefined ? { amountSats } : {}),
        pair,
      })
      const submarine = await options.boltz.createSubmarineSwap({
        from,
        to,
        invoice: request.invoice,
        ...(limits.pairHash ? { pairHash: limits.pairHash } : {}),
      })
      const record = operation(
        { id: material.operationId, chainId: request.chainId },
        'swap_out',
        'awaiting_onchain',
        {
          request: publicSwapRequest(request, material.operationId, { senderAddress }),
          swapId: submarine.id,
          expectedAmount: submarine.expectedAmount,
          claimAddress: submarine.claimAddress,
          lockupAddress: submarine.address,
          senderAddress,
          timeoutBlockHeight: submarine.timeoutBlockHeight,
          preLockCalls: request.preLockCalls,
        },
        options.now,
      )
      record.swapId = submarine.id
      await options.store.put(record)
      return {
        type: 'awaiting_resolution',
        operation: record,
        swapId: submarine.id,
        limits,
        ...(submarine.expectedAmount ? { expectedAmount: submarine.expectedAmount } : {}),
        ...(submarine.claimAddress ? { claimAddress: submarine.claimAddress } : {}),
        ...(submarine.address ? { lockupAddress: submarine.address } : {}),
        timeoutBlockHeight: submarine.timeoutBlockHeight,
      }
    },

    async resume(id: string) {
      const record = await options.store.get(id)
      if (!record) throw new Error(`Operation not found: ${id}`)
      const latestStatus = record.swapId ? await options.boltz.getSwap(record.swapId) : undefined
      if (latestStatus) {
        record.data = { ...record.data, latestStatus }
        record.updatedAt = nowSeconds(options.now)
        await options.store.put(record)
      }
      return { operation: record, ...(latestStatus ? { latestStatus } : {}) }
    },

    listActive() {
      return options.store.list({
        status: [
          'external_payment_required',
          'external_invoice_required',
          'awaiting_onchain',
          'claiming',
          'locking',
          'settling',
          'refunding',
        ],
      })
    },
  }
}
