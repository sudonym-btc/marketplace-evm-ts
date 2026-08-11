import type { MarketplaceEvmClient } from '../client.js'
import { isBoltzMissingSwapError } from '../boltz/restClient.js'
import { deriveEvmSwapMaterial } from '../seed.js'
import {
  erc20SwapClaimCall,
  erc20SwapCooperativeRefundCall,
  erc20SwapRefundCall,
  findErc20SwapLockup,
} from '../swaps/erc20Swap.js'
import type { EvmAddress, EvmHash, EvmHex, EvmOperationRecord } from '../types.js'
import { executeWithPersistedSubmission } from '../utils/execution.js'
import { sha256Hex } from '../utils/sha256.js'
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
  recovered: Array<{
    operationId: string
    kind: EvmOperationRecord['kind']
    status: 'completed' | 'refunded'
    evidence: Record<string, unknown>
  }>
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
  const message = isBoltzMissingSwapError(error)
    ? 'Boltz swap is not available during startup recovery'
    : 'Unable to recover EVM operation at startup'
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
  const recovered: EvmOperationRecoverySummary['recovered'] = []
  let resumed = 0

  if (!evm.swaps) {
    return {
      activeOperations: 0,
      resumed,
      settled,
      failed,
      recovered,
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
    if (latest.operation.status === 'initialised' && !latest.operation.swapId) {
      const error = new Error(`Operation ${operation.id} stopped during external creation and cannot be safely retried`)
      await failOperationAtStartup(options.operationStore, latest.operation, error)
      failed.push({ operationId: operation.id, error: error.message })
      continue
    }
    try {
      if (latest.operation.kind === 'swap_out') {
        if (latest.operation.status === 'completed') {
          settled.push(operation.id)
          recovered.push({
            operationId: operation.id,
            kind: 'swap_out',
            status: 'completed',
            evidence: {
              swapId: latest.operation.swapId,
              preimageHash: recordValue(latest.operation.data, 'preimageHash'),
              providerStatus: latest.latestStatus?.status,
            },
          })
          continue
        }
        if (latest.operation.status === 'refunded') {
          settled.push(operation.id)
          recovered.push({
            operationId: operation.id,
            kind: 'swap_out',
            status: 'refunded',
            evidence: { swapId: latest.operation.swapId, providerStatus: latest.latestStatus?.status },
          })
          continue
        }
        if (latest.operation.status !== 'refunding') continue

        const requestData = operationRequest(latest.operation)
        const tradeIndex = recordValue<number>(requestData, 'tradeIndex')
        const chainId = recordValue<number>(requestData, 'chainId')
        const lockPlan = recordValue<Record<string, unknown>>(latest.operation.data, 'lockPlan')
        const verified = recordValue<{ address: EvmAddress; runtimeBytecodeHash: EvmHex }>(latest.operation.data, 'verifiedSwapContract')
        if (tradeIndex === undefined || chainId === undefined || !lockPlan || !verified) {
          throw new Error(`Operation ${operation.id} is missing swap-out refund recovery data`)
        }
        const chain = options.chains.find(item => item.chainId === chainId)
        if (!chain) throw new Error(`No configured EVM chain ${chainId}`)
        const bytecode = await chain.publicClient.getBytecode({ address: verified.address })
        if (!bytecode || (await sha256Hex(bytecode)).toLowerCase() !== verified.runtimeBytecodeHash.toLowerCase()) {
          throw new Error(`Operation ${operation.id} trusted ERC20Swap runtime changed before refund`)
        }
        const contractAddress = recordValue<EvmAddress>(lockPlan, 'contractAddress')
        const preimageHash = recordValue<EvmHex>(lockPlan, 'preimageHash')
        const tokenAddress = recordValue<EvmAddress>(lockPlan, 'tokenAddress')
        const claimAddress = recordValue<EvmAddress>(lockPlan, 'claimAddress')
        const amount = recordValue<string>(lockPlan, 'amount')
        const timelock = recordValue<number>(lockPlan, 'timelock')
        if (!contractAddress || !preimageHash || !tokenAddress || !claimAddress || !amount || timelock === undefined) {
          throw new Error(`Operation ${operation.id} has an invalid swap-out lock plan`)
        }
        if (contractAddress.toLowerCase() !== verified.address.toLowerCase()) {
          throw new Error(`Operation ${operation.id} refund contract does not match its trust record`)
        }
        const currentBlock = await chain.publicClient.getBlockNumber()
        const refundCall = latest.cooperativeRefundSignature
          ? erc20SwapCooperativeRefundCall({
              contractAddress,
              preimageHash,
              amount: BigInt(amount),
              tokenAddress,
              claimAddress,
              timelock,
              signature: latest.cooperativeRefundSignature,
            })
          : currentBlock >= BigInt(timelock)
            ? erc20SwapRefundCall({
                contractAddress,
                preimageHash,
                amount: BigInt(amount),
                tokenAddress,
                claimAddress,
                timelock,
              })
            : undefined
        if (!refundCall) continue
        const evmForTrade = options.client(options.seed, tradeIndex)
        if (!evmForTrade.executor) throw new Error('EVM deterministic AA execution is unavailable')
        const execution = await executeWithPersistedSubmission({
          executor: evmForTrade.executor,
          operationStore: options.operationStore,
          operation: latest.operation,
          submissionKey: 'refundSubmission',
          calls: [refundCall],
          chainId,
          operationId: `refund-${operation.id}`,
        })
        latest.operation.status = 'refunded'
        latest.operation.txHash = execution.txHash
        latest.operation.updatedAt = Math.floor(Date.now() / 1000)
        latest.operation.data = {
          ...latest.operation.data,
          refundedAtStartup: true,
          refundTxHash: execution.txHash,
          refundMode: latest.cooperativeRefundSignature ? 'cooperative' : 'timeout',
        }
        await options.operationStore.put(latest.operation)
        settled.push(operation.id)
        recovered.push({
          operationId: operation.id,
          kind: 'swap_out',
          status: 'refunded',
          evidence: { txHash: execution.txHash, swapId: latest.operation.swapId },
        })
        continue
      }

      if (latest.operation.kind !== 'swap_in') continue
      const txHash = latest.latestStatus?.transaction?.id ?? latest.latestStatus?.transactionHash
      if (!txHash || operation.status === 'completed') continue

      const requestData = operationRequest(latest.operation)
      const tradeIndex = recordValue<number>(requestData, 'tradeIndex')
      const attemptIndex = recordValue<number>(requestData, 'attemptIndex')
      const chainId = recordValue<number>(requestData, 'chainId')
      const assetAddress = recordValue<EvmAddress>(requestData, 'assetAddress')
      const recordedClaimAssetAddress = recordValue<EvmAddress>(latest.operation.data, 'claimAssetAddress')
      const lockupAddress = recordValue<EvmAddress>(latest.operation.data, 'lockupAddress')
      const postClaimCalls = recordValue<unknown[]>(latest.operation.data, 'postClaimCalls') ?? []
      if (tradeIndex === undefined || attemptIndex === undefined || chainId === undefined || !assetAddress || !lockupAddress) {
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
        contractAddress: lockupAddress,
        preimageHash: material.preimageHash,
        claimAddress: buyerAddress,
        tokenAddress: claimAssetAddress,
      })
      const execution = await executeWithPersistedSubmission({
        executor: evmForTrade.executor,
        operationStore: options.operationStore,
        operation: latest.operation,
        submissionKey: 'claimSubmission',
        calls: [
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
        chainId,
        operationId: `recover-${operation.id}`,
      })
      latest.operation.status = 'completed'
      latest.operation.txHash = execution.txHash
      latest.operation.updatedAt = Math.floor(Date.now() / 1000)
      latest.operation.data = {
        ...latest.operation.data,
        recoveredAtStart: true,
        lockTxHash: txHash,
        claimTxHash: execution.txHash,
      }
      const recoveryProof = recordValue<Record<string, unknown>>(requestData, 'recoveryProof')
      if (recoveryProof) {
        const proofParams = recordValue<Record<string, unknown>>(recoveryProof, 'params')
        latest.operation.data.recoveredPaymentProof = {
          ...recoveryProof,
          ...(proofParams ? { params: { ...proofParams, txHash: execution.txHash } } : {}),
        }
      }
      await options.operationStore.put(latest.operation)
      settled.push(operation.id)
      recovered.push({
        operationId: operation.id,
        kind: 'swap_in',
        status: 'completed',
        evidence: {
          lockTxHash: txHash,
          claimTxHash: execution.txHash,
          ...(latest.operation.data.recoveredPaymentProof
            ? { paymentProof: latest.operation.data.recoveredPaymentProof }
            : {}),
        },
      })
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
    recovered,
  }
}
