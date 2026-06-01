import { resolveEvmChainConfigs } from '../chains.js'
import { createMarketplaceEvmClient } from '../client.js'
import { isBoltzMissingSwapError } from '../boltz/restClient.js'
import { deriveEvmSwapMaterial } from '../seed.js'
import { erc20SwapClaimCall, findErc20SwapLockup } from '../swaps/erc20Swap.js'
import type { EvmAddress, EvmHash, EvmOperationRecord } from '../types.js'
import { evmPaymentAssets } from './assets.js'
import { payEvmIntent } from './pay.js'
import { evmEscrowPolicies } from './policies.js'
import { validateEvmMarketplacePayment } from './validate.js'
import type {
  EvmEscrowPolicy,
  EvmMarketplacePolicyState,
  EvmMarketplacePolicyOptions,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

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

export function createEvmEscrowPolicy(
  options: EvmMarketplacePolicyOptions,
): EvmEscrowPolicy {
  const chains = resolveEvmChainConfigs(options.chains) as ResolvedEvmMarketplaceChainConfig[]
  let currentState: EvmMarketplacePolicyState = {
    enabled: true,
    started: false,
    maxUsedIndex: -1,
    nextTradeIndex: 0,
    startSummary: 'Not started',
  }

  function client(seed: string, tradeIndex?: number) {
    const [primaryChain] = chains
    return createMarketplaceEvmClient({
      chains,
      operationStore: options.operationStore,
      seed,
      ...(tradeIndex !== undefined ? { tradeIndex } : {}),
      ...(primaryChain?.boltz ? { boltz: primaryChain.boltz } : {}),
    })
  }

  return {
    method: 'evm',
    id: 'evm:multi-escrow',
    subject: 'order',
    family: 'escrow',
    policies: () => evmEscrowPolicies(chains),
    assets: () => evmPaymentAssets(chains, options.appId),
    client,
    state: () => currentState,

    async discoverHighWatermark(context) {
      const evm = client(context.seed)
      if (!evm.discoverHighWatermark) throw new Error('EVM high watermark discovery is unavailable')
      const discovery = await evm.discoverHighWatermark({
        highWaterMark: context.highWaterMark,
        unusedWindow: context.unusedWindow,
      })
      return {
        policy: 'evm:multi-escrow',
        maxUsedIndex: discovery.maxUsedIndex,
        nextUnusedIndex: discovery.nextUnusedIndex,
        scannedFrom: discovery.scannedFrom,
        scannedThrough: discovery.scannedThrough,
        unusedWindow: discovery.unusedWindow,
        usedIndexes: discovery.usedTradeIndexes,
        recoveryActions: discovery.recoveryActions,
      }
    },

    async startup(context) {
      const evm = client(context.seed)
      const activeOperations = evm.swaps ? await evm.swaps.listActive() : []
      const resumed = []
      const settled = []
      const failed = []
      if (evm.swaps) {
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
          resumed.push(latest)
          if (operation.kind !== 'swap_in') continue
          try {
            const txHash = latest.latestStatus?.transaction?.id ?? latest.latestStatus?.transactionHash
            if (!txHash || operation.status === 'completed') continue
            const requestData = operationRequest(latest.operation)
            const tradeIndex = recordValue<number>(requestData, 'tradeIndex')
            const attemptIndex = recordValue<number>(requestData, 'attemptIndex')
            const chainId = recordValue<number>(requestData, 'chainId')
            const assetAddress = recordValue<EvmAddress>(requestData, 'assetAddress')
            const postClaimCalls = recordValue<unknown[]>(latest.operation.data, 'postClaimCalls') ?? []
            if (tradeIndex === undefined || attemptIndex === undefined || chainId === undefined || !assetAddress) {
              throw new Error(`Operation ${operation.id} is missing swap-in recovery data`)
            }
            const chain = chains.find(item => item.chainId === chainId)
            if (!chain) throw new Error(`No configured EVM chain ${chainId}`)
            const evmForTrade = client(context.seed, tradeIndex)
            if (!evmForTrade.executor) throw new Error('EVM deterministic AA execution is unavailable')
            const buyerAddress = await evmForTrade.executor.getAddress(chainId)
            const material = deriveEvmSwapMaterial(context.seed, {
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
              tokenAddress: assetAddress,
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
      }
      currentState = {
        enabled: true,
        started: true,
        maxUsedIndex: context.highWaterMark,
        nextTradeIndex: context.nextUnusedIndex,
        startSummary: `${resumed.length} active EVM operation(s) resumed; ${settled.length} settled; ${failed.length} failed`,
      }
      return {
        policy: 'evm:multi-escrow',
        data: {
          activeOperations: activeOperations.length,
          resumed: resumed.length,
          settled: settled.length,
          failed,
        },
      }
    },

    async *recover(payment) {
      yield {
        type: 'noop',
        data: {
          reason: 'EVM recovery is handled by startup using deterministic accounts and active swap operations',
          subject: payment.subject,
          method: payment.proof.method,
        },
      }
    },

    pay(intent) {
      return payEvmIntent({
        chains,
        operationStore: options.operationStore,
        intent,
        state: currentState,
        setState(nextState) {
          currentState = nextState
        },
      })
    },

    validatePayment(request) {
      return validateEvmMarketplacePayment(chains, request)
    },
  }
}
