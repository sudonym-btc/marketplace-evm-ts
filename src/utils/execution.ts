import type {
  EvmExecutionResult,
  EvmExecutionSubmission,
  EvmExecutor,
  EvmOperationRecord,
  EvmOperationStore,
  NamedEvmCall,
} from '../types.js'

type PersistedExecutionOptions = {
  executor: EvmExecutor
  operationStore: EvmOperationStore
  operation: EvmOperationRecord
  submissionKey: string
  calls: NamedEvmCall[]
  chainId: number
  operationId: string
}

function isHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

export function persistedExecutionSubmission(
  operation: EvmOperationRecord,
  submissionKey: string,
): EvmExecutionSubmission | undefined {
  const value = operation.data[submissionKey]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const txHash = isHash(record.txHash) ? record.txHash : undefined
  const userOperationHash = isHash(record.userOperationHash) ? record.userOperationHash : undefined
  if (!txHash && !userOperationHash) return undefined
  return {
    ...(txHash ? { txHash } : {}),
    ...(userOperationHash ? { userOperationHash } : {}),
  }
}

async function persistSubmission(
  options: Pick<PersistedExecutionOptions, 'operationStore' | 'operation' | 'submissionKey'>,
  submission: EvmExecutionSubmission,
): Promise<void> {
  options.operation.data = {
    ...options.operation.data,
    [options.submissionKey]: {
      ...(submission.txHash ? { txHash: submission.txHash } : {}),
      ...(submission.userOperationHash ? { userOperationHash: submission.userOperationHash } : {}),
    },
  }
  options.operation.updatedAt = Math.floor(Date.now() / 1000)
  await options.operationStore.put(options.operation)
}

/**
 * Executes a funds-moving call exactly once across process crashes. The first
 * broadcast identifier is durably stored by `onSubmitted`; retries only wait
 * for that submission and never broadcast a replacement.
 */
export async function executeWithPersistedSubmission(
  options: PersistedExecutionOptions,
): Promise<EvmExecutionResult> {
  const persisted = persistedExecutionSubmission(options.operation, options.submissionKey)
  if (persisted) {
    if (!options.executor.waitForSubmission) {
      throw new Error(`Operation ${options.operation.id} has a pending submission but executor cannot reconcile it`)
    }
    const result = await options.executor.waitForSubmission(persisted, { chainId: options.chainId })
    await persistSubmission(options, {
      txHash: result.txHash,
      ...(result.userOperationHash ? { userOperationHash: result.userOperationHash } : persisted.userOperationHash
        ? { userOperationHash: persisted.userOperationHash }
        : {}),
    })
    return result
  }

  const result = await options.executor.execute(options.calls, {
    chainId: options.chainId,
    operationId: options.operationId,
    waitForReceipt: true,
    onSubmitted: submission => persistSubmission(options, submission),
  })
  await persistSubmission(options, {
    txHash: result.txHash,
    ...(result.userOperationHash ? { userOperationHash: result.userOperationHash } : {}),
  })
  return result
}
