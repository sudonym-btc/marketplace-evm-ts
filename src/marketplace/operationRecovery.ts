import type { MarketplaceEvmClient } from '../client.js'
import { isBoltzMissingSwapError } from '../boltz/restClient.js'
import { deriveEvmSwapMaterial } from '../seed.js'
import { erc20SwapClaimCall, findErc20SwapLockup } from '../swaps/erc20Swap.js'
import type { EvmAddress, EvmHash, EvmOperationRecord } from '../types.js'
import type { EvmMarketplacePolicyOptions, ResolvedEvmMarketplaceChainConfig } from './types.js'

export type EvmOperationRecoveryFailure = {
  operationId: string
  error: string
}

export type EvmOperationRecoverySummary = {
  activeOperations: number
  resumed: number
  settled: string[]
  failed: EvmOperationRecoveryFailure[]
}

type EvmOperationRecoveryClient = (seed: string, tradeIndex?: number) => MarketplaceEvmClient

function recordValue<T>(record: Record<string, unknown>, key: string): T | undefined {
  return record[key] as T | undefined
}

function operationRequest(operation: EvmOperationRecord): Record<string, unknown> {
  const request = operation.data.request
  if (!request || typeof request !== 'object') throw new Error(`Operation ${operation.id} has no request data`)
  return request as Record<string, unknown>
}

async function failOperationAtStartup(
  operationStore: EvmMarketplacePolicyOptions['operationStore'],
  operation: EvmOperationRecord,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown EVM recovery error'
  operation.status = 'failed'
  operation.error = message
  operation.updatedAt = Math.floor(Date.now() / 1000)
  operation.data = {
    ...operation.data,
    failedAtStartup: true,
    failureReason: message,
  }
  await operationStore.put(operation)
}

export async function recoverActiveEvmSwapOperations(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmMarketplacePolicyOptions['operationStore']
  seed: string
  client: EvmOperationRecoveryClient
}): Promise<EvmOperationRecoverySummary> {
  const evm = options.client(options.seed)
  const activeOperations = evm.swaps ? await evm.swaps.listActive() : []
  const settled: string[] = []
  const failed: EvmOperationRecoveryFailure[] = []
  let resumed = 0

  if (!evm.swaps) {
    return {
      activeOperations: 0,
      resumed,
      settled,
      failed,
    }
  }

  for (const operation of activeOperations) {
    let latest
    try {
      latest = await evm.swaps.resume(operation.id)
    } catch (error) {
      if (isBoltzMissingSwapError(error)) {
        await failOperationAtStartup(options.operationStore, operation, error)
      }
      failed.push({
        operationId: operation.id,
        error: error instanceof Error ? error.message : 'Unknown EVM recovery error',
      })
      continue
    }

    resumed += 1
    if (operation.kind !== 'swap_in') continue

    try {
      const txHash = latest.latestStatus?.transaction?.id ?? latest.latestStatus?.transactionHash
      if (!txHash || operation.status === 'completed') continue

      const requestData = operationRequest(latest.operation)
      const tradeIndex = recordValue<number>(requestData, 'tradeIndex')
      const attemptIndex = recordValue<number>(requestData, 'attemptIndex')
      const chainId = recordValue<number>(requestData, 'chainId')
      const assetAddress = recordValue<EvmAddress>(requestData, 'assetAddress')
      const recordedClaimAssetAddress = recordValue<EvmAddress>(latest.operation.data, 'claimAssetAddress')
      const postClaimCalls = recordValue<unknown[]>(latest.operation.data, 'postClaimCalls') ?? []
      if (tradeIndex === undefined || attemptIndex === undefined || chainId === undefined || !assetAddress) {
        throw new Error(`Operation ${operation.id} is missing swap-in recovery data`)
      }
      const claimAssetAddress = recordedClaimAssetAddress ?? assetAddress

      const chain = options.chains.find(item => item.chainId === chainId)
      if (!chain) throw new Error(`No configured EVM chain ${chainId}`)

      const evmForTrade = options.client(options.seed, tradeIndex)
      if (!evmForTrade.executor) throw new Error('EVM deterministic AA execution is unavailable')

      const buyerAddress = await evmForTrade.executor.getAddress(chainId)
      const material = deriveEvmSwapMaterial(options.seed, {
        tradeIndex,
        chainId,
        direction: 'swap-in',
        attemptIndex,
      })
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: txHash as EvmHash })
      if (receipt.status !== 'success') throw new Error(`Boltz lock transaction reverted: ${txHash}`)

      const lockup = findErc20SwapLockup(receipt.logs, {
        transactionHash: txHash as EvmHash,
        preimageHash: material.preimageHash,
        claimAddress: buyerAddress,
        tokenAddress: claimAssetAddress,
      })
      const execution = await evmForTrade.executor.execute(
        [
          erc20SwapClaimCall({
            contractAddress: lockup.contractAddress,
            preimage: material.preimage,
            amount: lockup.amount,
            tokenAddress: lockup.tokenAddress,
            refundAddress: lockup.refundAddress,
            timelock: lockup.timelock,
          }),
          ...(postClaimCalls as never[]),
        ],
        {
          chainId,
          operationId: `recover-${operation.id}`,
          waitForReceipt: true,
        },
      )
      latest.operation.status = 'completed'
      latest.operation.txHash = execution.txHash
      latest.operation.updatedAt = Math.floor(Date.now() / 1000)
      latest.operation.data = {
        ...latest.operation.data,
        recoveredAtStart: true,
        lockTxHash: txHash,
        claimTxHash: execution.txHash,
      }
      await options.operationStore.put(latest.operation)
      settled.push(operation.id)
    } catch (error) {
      failed.push({
        operationId: operation.id,
        error: error instanceof Error ? error.message : 'Unknown EVM recovery error',
      })
    }
  }

  return {
    activeOperations: activeOperations.length,
    resumed,
    settled,
    failed,
  }
}
