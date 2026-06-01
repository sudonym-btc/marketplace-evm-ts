import type { EvmOperationRecord, EvmOperationStatus } from '../types.js'
import { deriveEvmSwapMaterial, resolveEvmSeedConfig } from '../seed.js'
import { btcAmountToSats } from './amounts.js'
import type { EvmSwapService, SwapInRequest, SwapOutRequest, SwapServiceOptions } from './types.js'

const duplicatePreimageHashError = 'Boltz API 400: {"error":"a swap with this preimage hash exists already"}'
const maxSwapInCreateAttempts = 25

function nowSeconds(now?: () => number): number {
  return now ? now() : Math.floor(Date.now() / 1000)
}

function isDuplicatePreimageHashError(error: unknown): boolean {
  return error instanceof Error && error.message === duplicatePreimageHashError
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
      const requestedOnchainAmount = request.boltzAmountSats ?? btcAmountToSats(request.amount)

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
            from: request.lightningCurrency ?? 'BTC',
            to: request.boltzCurrency,
            preimageHash: material.preimageHash,
            claimAddress,
            onchainAmount: requestedOnchainAmount,
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

      const submarine = await options.boltz.createSubmarineSwap({
        from: request.boltzCurrency,
        to: request.lightningCurrency ?? 'BTC',
        invoice: request.invoice,
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
