import { decodeEventLog } from 'viem'
import type { LocalAccount } from 'viem'
import { multiEscrowAbi, multiEscrowDomain, multiEscrowTypes, multiEscrowFactorScale } from '@sudonym-btc/marketplace-evm-contracts'
import { resolveMarketplaceDriverPaymentProofParams } from '@sudonym-btc/marketplace-driver-interface'

import type { MarketplaceEvmClient } from '../client.js'
import type { EvmAddress, EvmHash, EvmHex, EvmOperationRecord, EvmOperationStore } from '../types.js'
import { executeWithPersistedSubmission, persistedExecutionSubmission } from '../utils/execution.js'
import { evmEscrowContractBytecodeHash } from './policies.js'
import { validateEvmExpectedEvidence } from './validate.js'
import type {
  GenericPaymentSettlementIntent,
  GenericPaymentSettlementState,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

const arbitrateTypes = { Arbitrate: multiEscrowTypes.Arbitrate } as const

const settlementSubmissionKey = 'settlementSubmission'
const failedSettlementError = 'Unable to settle EVM escrow'
const failedRecoveryError = 'Unable to reconcile EVM escrow settlement'

type ArbitrationReceiptBinding = {
  contractAddress: EvmAddress
  tradeId: `0x${string}`
  assetAddress: EvmAddress
  sellerAddress: EvmAddress
  buyerAddress: EvmAddress
  arbiterAddress: EvmAddress
  paymentAmount: bigint
  bondAmount: bigint
  paymentFactor: bigint
  bondFactor: bigint
}

export type EvmOrderSettlementRecoverySummary = {
  activeOperations: number
  recovered: Array<{
    operationId: string
    action: 'release' | 'refund'
    txHash: EvmHash
  }>
  failed: Array<{
    operationId: string
    error: string
  }>
}

export type EvmCompletedOrderSettlement = {
  operationId: string
  action: 'release' | 'refund'
  txHash: EvmHash
  amount: NonNullable<GenericPaymentValidationResult['amount']>
}

type ResolvedSettlementProof = {
  chain: ResolvedEvmMarketplaceChainConfig
  chainId: number
  params: Record<string, unknown>
  contractAddress: EvmAddress
  tradeId: `0x${string}`
  arbiterAddress: EvmAddress
  amount: NonNullable<GenericPaymentValidationResult['amount']>
}

type SettlementOperationReservation = {
  record: EvmOperationRecord
  ownsBroadcast: boolean
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`EVM settlement proof is missing ${key}`)
  return value
}

function addressParam(params: Record<string, unknown>, key: string): EvmAddress {
  const value = stringParam(params, key)
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`EVM settlement proof has an invalid ${key}`)
  return value as EvmAddress
}

function bigintParam(params: Record<string, unknown>, key: string, fallbackKey?: string): bigint {
  const value = params[key] ?? (fallbackKey ? params[fallbackKey] : undefined)
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`EVM settlement proof has an invalid ${key}`)
  }
  return BigInt(value)
}

function optionalBigintParam(params: Record<string, unknown>, key: string): bigint {
  if (params[key] === undefined || params[key] === null) return 0n
  return bigintParam(params, key)
}

function tradeIdParam(params: Record<string, unknown>): `0x${string}` {
  const value = stringParam(params, 'tradeId')
  const normalized = value.startsWith('0x') ? value : `0x${value}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error('EVM settlement proof has an invalid tradeId')
  return normalized as `0x${string}`
}

function chainIdParam(params: Record<string, unknown>): number {
  const value = params.chainId
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('EVM settlement proof has an invalid chainId')
  }
  return value
}

function hashParam(params: Record<string, unknown>, key: string): EvmHex {
  const value = stringParam(params, key)
  const normalized = value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error(`EVM settlement proof has an invalid ${key}`)
  return normalized as EvmHex
}

function isEvmHash(value: unknown): value is EvmHash {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)
}

function submissionMatchesKnownExecution(options: {
  original: NonNullable<ReturnType<typeof persistedExecutionSubmission>>
  latest: NonNullable<ReturnType<typeof persistedExecutionSubmission>>
  txHash: EvmHash
  userOperationHash?: EvmHash
}): boolean {
  const known = new Set([
    options.original.txHash,
    options.original.userOperationHash,
    options.txHash,
    options.userOperationHash,
  ].filter((value): value is EvmHash => Boolean(value)).map(value => value.toLowerCase()))
  return [options.latest.txHash, options.latest.userOperationHash]
    .some(value => value !== undefined && known.has(value.toLowerCase()))
}

function resultAmount(
  params: Record<string, unknown>,
  expected: GenericPaymentValidationRequest['expected'],
): NonNullable<GenericPaymentValidationResult['amount']> {
  if (expected?.amount) return expected.amount
  const denomination = stringParam(params, 'denomination')
  const decimals = params.decimals
  if (typeof decimals !== 'number' || !Number.isSafeInteger(decimals) || decimals < 0) {
    throw new Error('EVM settlement proof has invalid decimals')
  }
  const currency = params.currency
  if (currency !== undefined && (typeof currency !== 'string' || currency.length === 0)) {
    throw new Error('EVM settlement proof has invalid currency')
  }
  return {
    value: bigintParam(params, 'paymentAmount', 'value').toString(),
    ...(typeof currency === 'string' ? { currency } : {}),
    denomination,
    decimals,
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

async function resolvedSettlementProof(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  request: GenericPaymentValidationRequest
}): Promise<ResolvedSettlementProof> {
  if (!(options.request.driver === 'evm' || options.request.driver.startsWith('evm:'))) {
    throw new Error(`EVM settlement cannot bind ${options.request.driver}`)
  }
  if (!(options.request.proof.driver === 'evm' || options.request.proof.driver.startsWith('evm:'))) {
    throw new Error(`EVM settlement cannot bind ${options.request.proof.driver}`)
  }
  const params = await resolveMarketplaceDriverPaymentProofParams(
    options.request.proof,
    options.request.decryptParams,
  )
  const chainId = chainIdParam(params)
  const chain = options.chains.find(candidate => candidate.chainId === chainId)
  if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${chainId}`)
  const contractAddress = addressParam(params, 'contractAddress')
  if (!sameAddress(contractAddress, chain.multiEscrowAddress)) {
    throw new Error('EVM settlement proof contract does not match the configured deployment')
  }
  if (stringParam(params, 'policyType') !== 'evm:multi-escrow') {
    throw new Error('EVM completed settlement proof is not an order escrow proof')
  }
  const expectedPolicyId = `evm:${chainId}:${contractAddress.toLowerCase()}`
  if (stringParam(params, 'policyId') !== expectedPolicyId) {
    throw new Error('EVM completed settlement proof policy does not match the configured deployment')
  }
  const configuredHash = evmEscrowContractBytecodeHash(options.chains, chainId)
  if (
    params.contractBytecodeHash !== undefined
    && hashParam(params, 'contractBytecodeHash').toLowerCase() !== configuredHash.toLowerCase()
  ) {
    throw new Error('EVM completed settlement proof bytecode hash does not match the configured deployment')
  }
  if (params.policyHash !== undefined && hashParam(params, 'policyHash').toLowerCase() !== configuredHash.toLowerCase()) {
    throw new Error('EVM completed settlement proof policy hash does not match the configured deployment')
  }
  const paymentAmount = bigintParam(params, 'paymentAmount', 'value')
  const escrowFee = optionalBigintParam(params, 'escrowFee')
  const bondAmount = optionalBigintParam(params, 'bondAmount')
  if (bigintParam(params, 'fundedValue') !== paymentAmount + escrowFee + bondAmount) {
    throw new Error('EVM completed settlement proof funded value is inconsistent')
  }
  const expectedError = validateEvmExpectedEvidence(
    options.request,
    params,
    chainId,
    contractAddress,
    configuredHash,
  )
  if (expectedError) throw new Error(expectedError)
  const expectedAsset = options.request.expected?.asset as
    | (NonNullable<GenericPaymentValidationRequest['expected']>['asset'] & { chainId?: unknown })
    | undefined
  if (expectedAsset?.chainId !== undefined) {
    if (
      typeof expectedAsset.chainId !== 'number'
      || !Number.isSafeInteger(expectedAsset.chainId)
      || expectedAsset.chainId !== chainId
    ) {
      throw new Error('EVM completed settlement asset chain does not match expected payment')
    }
  }
  if (expectedAsset?.assetId) {
    const matched = /^(\d+):(0x[a-fA-F0-9]{40})$/.exec(expectedAsset.assetId)
    if (
      !matched
      || Number(matched[1]) !== chainId
      || !sameAddress(addressParam(params, 'assetAddress'), matched[2])
    ) {
      throw new Error('EVM completed settlement asset does not match expected payment')
    }
  }
  return {
    chain,
    chainId,
    params,
    contractAddress,
    tradeId: tradeIdParam(params),
    arbiterAddress: addressParam(params, 'arbiterAddress'),
    amount: resultAmount(params, options.request.expected),
  }
}

function receiptBindingFromParams(
  params: Record<string, unknown>,
  contractAddress: EvmAddress,
  tradeId: `0x${string}`,
  paymentFactor: bigint,
  bondFactor: bigint,
): ArbitrationReceiptBinding {
  return {
    contractAddress,
    tradeId,
    assetAddress: addressParam(params, 'assetAddress'),
    sellerAddress: addressParam(params, 'sellerAddress'),
    buyerAddress: addressParam(params, 'buyerAddress'),
    arbiterAddress: addressParam(params, 'arbiterAddress'),
    paymentAmount: bigintParam(params, 'paymentAmount', 'value') + optionalBigintParam(params, 'escrowFee'),
    bondAmount: optionalBigintParam(params, 'bondAmount'),
    paymentFactor,
    bondFactor,
  }
}

function settlementData(binding: ArbitrationReceiptBinding, action: 'release' | 'refund'): Record<string, string> {
  return {
    purpose: 'order',
    action,
    contractAddress: binding.contractAddress.toLowerCase(),
    assetAddress: binding.assetAddress.toLowerCase(),
    sellerAddress: binding.sellerAddress.toLowerCase(),
    buyerAddress: binding.buyerAddress.toLowerCase(),
    arbiterAddress: binding.arbiterAddress.toLowerCase(),
    paymentAmount: binding.paymentAmount.toString(),
    bondAmount: binding.bondAmount.toString(),
    paymentFactor: binding.paymentFactor.toString(),
    bondFactor: binding.bondFactor.toString(),
  }
}

function recoveryString(record: EvmOperationRecord, key: string): string {
  const value = record.data[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`EVM settlement operation ${record.id} is missing ${key}`)
  }
  return value
}

function recoveryAddress(record: EvmOperationRecord, key: string): EvmAddress {
  const value = recoveryString(record, key)
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`EVM settlement operation ${record.id} has an invalid ${key}`)
  }
  return value as EvmAddress
}

function recoveryBigint(record: EvmOperationRecord, key: string): bigint {
  const value = recoveryString(record, key)
  if (!/^\d+$/.test(value)) throw new Error(`EVM settlement operation ${record.id} has an invalid ${key}`)
  return BigInt(value)
}

function recoveryBinding(record: EvmOperationRecord): ArbitrationReceiptBinding & { action: 'release' | 'refund' } {
  if (!record.tradeId || !/^0x[a-fA-F0-9]{64}$/.test(record.tradeId)) {
    throw new Error(`EVM settlement operation ${record.id} has an invalid tradeId`)
  }
  const action = recoveryString(record, 'action')
  if (action !== 'release' && action !== 'refund') {
    throw new Error(`EVM settlement operation ${record.id} has an invalid action`)
  }
  return {
    action,
    contractAddress: recoveryAddress(record, 'contractAddress'),
    tradeId: record.tradeId as `0x${string}`,
    assetAddress: recoveryAddress(record, 'assetAddress'),
    sellerAddress: recoveryAddress(record, 'sellerAddress'),
    buyerAddress: recoveryAddress(record, 'buyerAddress'),
    arbiterAddress: recoveryAddress(record, 'arbiterAddress'),
    paymentAmount: recoveryBigint(record, 'paymentAmount'),
    bondAmount: recoveryBigint(record, 'bondAmount'),
    paymentFactor: recoveryBigint(record, 'paymentFactor'),
    bondFactor: recoveryBigint(record, 'bondFactor'),
  }
}

function operationMatches(record: EvmOperationRecord, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => record.data[key] === value)
}

function canonicalSettlementOperationId(chainId: number, tradeId: `0x${string}`): string {
  return `evm-order-${chainId}-${tradeId.toLowerCase()}`
}

function settlementRecordBinding(options: {
  resolved: ResolvedSettlementProof
  record: EvmOperationRecord
}): ArbitrationReceiptBinding & { action: 'release' | 'refund' } {
  const { record, resolved } = options
  const action = recoveryString(record, 'action')
  if (action !== 'release' && action !== 'refund') {
    throw new Error(`EVM settlement operation ${record.id} has an invalid action`)
  }
  const factor = action === 'release' ? BigInt(multiEscrowFactorScale) : 0n
  const binding = receiptBindingFromParams(
    resolved.params,
    resolved.contractAddress,
    resolved.tradeId,
    factor,
    factor,
  )
  const expectedData = settlementData(binding, action)
  if (
    record.kind !== 'escrow'
    || !['settling', 'failed', 'completed'].includes(record.status)
    || record.chainId !== resolved.chainId
    || !record.tradeId
    || record.tradeId.toLowerCase() !== resolved.tradeId.toLowerCase()
    || !operationMatches(record, expectedData)
  ) {
    throw new Error(`EVM settlement operation ${record.id} does not match the payment proof`)
  }
  return { ...binding, action }
}

async function orderSettlementOperations(options: {
  store: EvmOperationStore
  chainId: number
  tradeId: `0x${string}`
}): Promise<EvmOperationRecord[]> {
  const records = await options.store.list({ kind: 'escrow', chainId: options.chainId })
  return records.filter(record =>
    record.data.purpose === 'order'
      && record.tradeId?.toLowerCase() === options.tradeId.toLowerCase(),
  )
}

async function settlementOperation(options: {
  store: EvmOperationStore
  id: string
  chainId: number
  tradeId: string
  data: Record<string, string>
}): Promise<SettlementOperationReservation> {
  const existing = await options.store.get(options.id)
  if (existing) {
    if (
      existing.kind !== 'escrow'
      || existing.chainId !== options.chainId
      || existing.tradeId?.toLowerCase() !== options.tradeId.toLowerCase()
      || !operationMatches(existing, options.data)
    ) {
      throw new Error(`EVM settlement operation ${options.id} conflicts with persisted recovery state`)
    }
    return { record: existing, ownsBroadcast: false }
  }
  const now = Math.floor(Date.now() / 1000)
  const record: EvmOperationRecord = {
    id: options.id,
    kind: 'escrow',
    status: 'settling',
    chainId: options.chainId,
    tradeId: options.tradeId,
    data: options.data,
    createdAt: now,
    updatedAt: now,
  }
  if (!options.store.putIfAbsent) {
    throw new Error('EVM order settlement requires an operation store with atomic putIfAbsent')
  }
  if (await options.store.putIfAbsent(record)) {
    return { record, ownsBroadcast: true }
  }
  const raced = await options.store.get(options.id)
  if (
    !raced
    || raced.kind !== 'escrow'
    || raced.chainId !== options.chainId
    || raced.tradeId?.toLowerCase() !== options.tradeId.toLowerCase()
    || !operationMatches(raced, options.data)
  ) {
    throw new Error(`EVM settlement operation ${options.id} raced with conflicting recovery state`)
  }
  return { record: raced, ownsBroadcast: false }
}

async function verifiedArbitrationReceipt(options: {
  chain: ResolvedEvmMarketplaceChainConfig
  binding: ArbitrationReceiptBinding
  txHash: EvmHash
}): Promise<void> {
  const receipt = await options.chain.publicClient.waitForTransactionReceipt({ hash: options.txHash })
  if (receipt.status !== 'success') throw new Error(`EVM escrow settlement reverted: ${options.txHash}`)
  const matched = receipt.logs.some(log => {
    if (!sameAddress(log.address, options.binding.contractAddress)) return false
    try {
      const decoded = decodeEventLog({
        abi: multiEscrowAbi,
        eventName: 'Arbitrated',
        data: log.data,
        topics: log.topics,
      })
      return decoded.args.tradeId.toLowerCase() === options.binding.tradeId.toLowerCase()
        && sameAddress(decoded.args.token, options.binding.assetAddress)
        && sameAddress(decoded.args.seller, options.binding.sellerAddress)
        && sameAddress(decoded.args.buyer, options.binding.buyerAddress)
        && decoded.args.paymentAmount === options.binding.paymentAmount
        && decoded.args.bondAmount === options.binding.bondAmount
        && decoded.args.paymentFactor === options.binding.paymentFactor
        && decoded.args.bondFactor === options.binding.bondFactor
    } catch {
      return false
    }
  })
  if (!matched) throw new Error('EVM escrow settlement receipt is missing the exact Arbitrated event')
}

async function verifyCompletedSettlementRecord(options: {
  resolved: ResolvedSettlementProof
  record: EvmOperationRecord
  settlementAccount?: LocalAccount
}): Promise<EvmCompletedOrderSettlement> {
  const { record, resolved } = options
  if (record.kind !== 'escrow' || record.status !== 'completed' || record.data.purpose !== 'order') {
    throw new Error(`EVM settlement operation ${record.id} is not a completed order settlement`)
  }
  if (options.settlementAccount && !sameAddress(options.settlementAccount.address, resolved.arbiterAddress)) {
    throw new Error('EVM settlement account is not the completed escrow arbiter')
  }
  const binding = settlementRecordBinding({ resolved, record })
  if (!record.txHash || !/^0x[a-fA-F0-9]{64}$/.test(record.txHash)) {
    throw new Error(`Completed EVM settlement operation ${record.id} has no valid transaction hash`)
  }
  await verifiedArbitrationReceipt({
    chain: resolved.chain,
    binding,
    txHash: record.txHash,
  })
  return {
    operationId: record.id,
    action: binding.action,
    txHash: record.txHash,
    amount: resolved.amount,
  }
}

/**
 * Returns only actions that are safe at the durable settlement boundary.
 * An in-flight reservation exposes no action until a submission identifier is
 * persisted; a submitted or completed operation exposes only its bound action.
 */
export async function settlementActionsForEvmMarketplacePayment(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  settlementAccount?: LocalAccount
  canReconcileSubmitted: boolean
  request: GenericPaymentValidationRequest
}): Promise<readonly ('release' | 'refund')[]> {
  if (!options.settlementAccount) return []
  try {
    const resolved = await resolvedSettlementProof({ chains: options.chains, request: options.request })
    if (!sameAddress(options.settlementAccount.address, resolved.arbiterAddress)) return []
    const records = await orderSettlementOperations({
      store: options.operationStore,
      chainId: resolved.chainId,
      tradeId: resolved.tradeId,
    })
    if (records.length === 0) return options.operationStore.putIfAbsent ? ['release', 'refund'] : []
    if (records.length !== 1) return []
    const [record] = records
    const binding = settlementRecordBinding({ resolved, record })
    if (record.status === 'completed') {
      await verifyCompletedSettlementRecord({
        resolved,
        record,
        settlementAccount: options.settlementAccount,
      })
      return [binding.action]
    }
    const submission = persistedExecutionSubmission(record, settlementSubmissionKey)
    if (submission && options.canReconcileSubmitted) return [binding.action]
    return []
  } catch {
    return []
  }
}

export async function completedEvmOrderSettlements(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  request: GenericPaymentValidationRequest
  settlementAccount?: LocalAccount
}): Promise<EvmCompletedOrderSettlement[]> {
  const resolved = await resolvedSettlementProof({ chains: options.chains, request: options.request })
  const records = await options.operationStore.list({
    kind: 'escrow',
    status: 'completed',
    chainId: resolved.chainId,
  })
  const completed: EvmCompletedOrderSettlement[] = []
  for (const record of records) {
    if (
      record.data.purpose !== 'order'
      || !record.tradeId
      || record.tradeId.toLowerCase() !== resolved.tradeId.toLowerCase()
    ) continue
    try {
      completed.push(await verifyCompletedSettlementRecord({
        resolved,
        record,
        ...(options.settlementAccount ? { settlementAccount: options.settlementAccount } : {}),
      }))
    } catch {
      // Invalid or stale tombstones never authorize a financial action.
    }
  }
  return completed
}

export async function replayCompletedEvmMarketplacePayment(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  settlementAccount?: LocalAccount
  intent: GenericPaymentSettlementIntent
}): Promise<GenericPaymentSettlementState | null> {
  const { intent } = options
  if (intent.action !== 'release' && intent.action !== 'refund') return null
  if (!options.settlementAccount) throw new Error('EVM escrow settlement replay requires an arbiter account')
  const resolved = await resolvedSettlementProof({
    chains: options.chains,
    request: {
      driver: intent.proof.driver,
      proof: intent.proof,
      ...(intent.decryptParams ? { decryptParams: intent.decryptParams } : {}),
      ...(intent.expected ? { expected: intent.expected } : {}),
    },
  })
  const candidates = (await orderSettlementOperations({
    store: options.operationStore,
    chainId: resolved.chainId,
    tradeId: resolved.tradeId,
  })).filter(record => record.status === 'completed')
  if (candidates.length === 0) return null
  if (candidates.length !== 1) {
    throw new Error('EVM payment has conflicting completed settlement operations')
  }
  const [record] = candidates
  const completed = await verifyCompletedSettlementRecord({
    resolved,
    record,
    settlementAccount: options.settlementAccount,
  })
  if (completed.action !== intent.action) {
    throw new Error(
      `EVM payment is already bound to a different completed settlement operation (${completed.action})`,
    )
  }
  return {
    type: 'completed',
    proof: intent.proof,
    data: {
      operationId: record.id,
      action: completed.action,
      settlementTxHash: completed.txHash,
      paymentFactor: completed.action === 'release' ? String(multiEscrowFactorScale) : '0',
      bondFactor: completed.action === 'release' ? String(multiEscrowFactorScale) : '0',
      replayed: true,
    },
  }
}

/**
 * Reconciles only previously submitted order settlements. Startup recovery
 * never constructs or broadcasts a financial call.
 */
export async function recoverEvmOrderSettlements(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  settlementClient(): MarketplaceEvmClient
}): Promise<EvmOrderSettlementRecoverySummary> {
  const candidates = await options.operationStore.list({
    kind: 'escrow',
    status: ['settling', 'failed'],
  })
  const active = candidates.filter(record =>
    record.data.purpose === 'order'
      && (record.status === 'settling' || persistedExecutionSubmission(record, settlementSubmissionKey) !== undefined),
  )
  const recovered: EvmOrderSettlementRecoverySummary['recovered'] = []
  const failed: EvmOrderSettlementRecoverySummary['failed'] = []

  for (const operation of active) {
    const submission = persistedExecutionSubmission(operation, settlementSubmissionKey)
    if (!submission) {
      operation.status = 'failed'
      operation.error = 'EVM escrow settlement has no submitted transaction to recover'
      operation.updatedAt = Math.floor(Date.now() / 1000)
      await options.operationStore.put(operation)
      failed.push({ operationId: operation.id, error: operation.error })
      continue
    }

    try {
      const binding = recoveryBinding(operation)
      const chain = options.chains.find(candidate => candidate.chainId === operation.chainId)
      if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${operation.chainId}`)
      if (!sameAddress(binding.contractAddress, chain.multiEscrowAddress)) {
        throw new Error(`EVM settlement operation ${operation.id} has an unconfigured contract`)
      }
      const client = options.settlementClient()
      if (!client.executor?.waitForSubmission) {
        throw new Error('EVM escrow settlement executor cannot reconcile a persisted submission')
      }
      const execution = await client.executor.waitForSubmission(submission, { chainId: operation.chainId })
      await verifiedArbitrationReceipt({ chain, binding, txHash: execution.txHash })
      operation.status = 'completed'
      operation.txHash = execution.txHash
      operation.data = {
        ...operation.data,
        [settlementSubmissionKey]: {
          txHash: execution.txHash,
          ...(execution.userOperationHash
            ? { userOperationHash: execution.userOperationHash }
            : submission.userOperationHash
              ? { userOperationHash: submission.userOperationHash }
              : {}),
        },
      }
      delete operation.error
      operation.updatedAt = Math.floor(Date.now() / 1000)
      await options.operationStore.put(operation)
      recovered.push({ operationId: operation.id, action: binding.action, txHash: execution.txHash })
    } catch {
      operation.status = 'settling'
      operation.error = failedRecoveryError
      operation.updatedAt = Math.floor(Date.now() / 1000)
      await options.operationStore.put(operation)
      failed.push({ operationId: operation.id, error: failedRecoveryError })
    }
  }

  return { activeOperations: active.length, recovered, failed }
}

export async function* settleEvmMarketplacePayment(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  settlementAccount?: LocalAccount
  settlementClient(): MarketplaceEvmClient
  intent: GenericPaymentSettlementIntent
}): AsyncIterable<GenericPaymentSettlementState> {
  const { intent } = options
  if (intent.action !== 'release' && intent.action !== 'refund') {
    throw new Error(`EVM escrow does not support ${intent.action} settlement`)
  }
  if (!options.settlementAccount) throw new Error('EVM escrow settlement requires an arbiter account')

  const params = await resolveMarketplaceDriverPaymentProofParams(intent.proof, intent.decryptParams)
  const chainId = chainIdParam(params)
  const chain = options.chains.find(candidate => candidate.chainId === chainId)
  if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${chainId}`)
  const contractAddress = addressParam(params, 'contractAddress')
  if (!sameAddress(contractAddress, chain.multiEscrowAddress)) {
    throw new Error('EVM settlement proof contract does not match the configured deployment')
  }
  const arbiterAddress = addressParam(params, 'arbiterAddress')
  if (!sameAddress(options.settlementAccount.address, arbiterAddress)) {
    throw new Error('EVM settlement account is not the escrow arbiter')
  }
  const tradeId = tradeIdParam(params)
  const paymentFactor = intent.action === 'release' ? BigInt(multiEscrowFactorScale) : 0n
  const bondFactor = paymentFactor
  const binding = receiptBindingFromParams(params, contractAddress, tradeId, paymentFactor, bondFactor)
  const operationId = canonicalSettlementOperationId(chainId, tradeId)
  const data = settlementData(binding, intent.action)
  const resolved: ResolvedSettlementProof = {
    chain,
    chainId,
    params,
    contractAddress,
    tradeId,
    arbiterAddress,
    amount: intent.amount,
  }
  const existing = await orderSettlementOperations({ store: options.operationStore, chainId, tradeId })
  if (existing.length > 1) {
    throw new Error('EVM payment has conflicting settlement operations')
  }
  let reservation: SettlementOperationReservation
  if (existing.length === 1) {
    const [record] = existing
    const persisted = settlementRecordBinding({ resolved, record })
    if (persisted.action !== intent.action) {
      throw new Error(`EVM payment settlement is already bound to ${persisted.action}`)
    }
    reservation = { record, ownsBroadcast: false }
  } else {
    reservation = await settlementOperation({
      store: options.operationStore,
      id: operationId,
      chainId,
      tradeId,
      data,
    })
  }
  const { record: operation, ownsBroadcast } = reservation

  yield {
    type: 'progress',
    status: operation.status === 'completed' ? 'Verifying completed EVM escrow settlement' : 'Settling EVM escrow',
    data: { operationId: operation.id, action: intent.action },
  }

  const existingSubmission = persistedExecutionSubmission(operation, settlementSubmissionKey)
  if (!ownsBroadcast && operation.status !== 'completed' && !existingSubmission) {
    throw new Error(`EVM settlement operation ${operation.id} is reserved by another caller`)
  }

  try {
    let txHash: EvmHash
    let reconciledUserOperationHash: EvmHash | undefined
    if (operation.status === 'completed') {
      if (!isEvmHash(operation.txHash)) {
        throw new Error(`Completed EVM settlement operation ${operation.id} has no valid transaction hash`)
      }
      txHash = operation.txHash
    } else if (!ownsBroadcast) {
      const client = options.settlementClient()
      if (!client.executor?.waitForSubmission) {
        throw new Error(`EVM settlement operation ${operation.id} cannot reconcile its persisted submission`)
      }
      const execution = await client.executor.waitForSubmission(existingSubmission!, { chainId })
      txHash = execution.txHash
      reconciledUserOperationHash = execution.userOperationHash
    } else {
      const signature = await options.settlementAccount.signTypedData({
        domain: {
          ...multiEscrowDomain,
          chainId,
          verifyingContract: contractAddress,
        },
        types: arbitrateTypes,
        primaryType: 'Arbitrate',
        message: {
          tradeId,
          paymentFactor,
          bondFactor,
        },
      })
      const client = options.settlementClient()
      if (!client.executor) throw new Error('EVM escrow settlement requires an executor')
      const call = client.escrow.arbitrate({
        tradeId,
        contractAddress,
        paymentFactor,
        bondFactor,
        signature,
      })
      operation.status = 'settling'
      delete operation.error
      operation.updatedAt = Math.floor(Date.now() / 1000)
      await options.operationStore.put(operation)
      const execution = await executeWithPersistedSubmission({
        executor: client.executor,
        operationStore: options.operationStore,
        operation,
        submissionKey: settlementSubmissionKey,
        calls: [call],
        chainId,
        operationId,
      })
      txHash = execution.txHash
    }

    await verifiedArbitrationReceipt({
      chain,
      binding,
      txHash,
    })

    if (ownsBroadcast) {
      operation.status = 'completed'
      operation.txHash = txHash
      delete operation.error
      operation.updatedAt = Math.floor(Date.now() / 1000)
      await options.operationStore.put(operation)
    } else {
      const latest = await options.operationStore.get(operation.id)
      if (!latest) throw new Error(`EVM settlement operation ${operation.id} disappeared during reconciliation`)
      settlementRecordBinding({ resolved, record: latest })
      if (latest.status === 'completed') {
        if (!isEvmHash(latest.txHash)) {
          throw new Error(`Completed EVM settlement operation ${latest.id} has no valid transaction hash`)
        }
        if (latest.txHash.toLowerCase() !== txHash.toLowerCase()) {
          await verifiedArbitrationReceipt({ chain, binding, txHash: latest.txHash })
          txHash = latest.txHash
        }
      } else {
        const latestSubmission = persistedExecutionSubmission(latest, settlementSubmissionKey)
        if (
          !existingSubmission
          || !latestSubmission
          || !submissionMatchesKnownExecution({
            original: existingSubmission,
            latest: latestSubmission,
            txHash,
            ...(reconciledUserOperationHash ? { userOperationHash: reconciledUserOperationHash } : {}),
          })
        ) {
          throw new Error(`EVM settlement operation ${latest.id} changed during reconciliation`)
        }
        const userOperationHash = reconciledUserOperationHash
          ?? latestSubmission.userOperationHash
          ?? existingSubmission.userOperationHash
        latest.status = 'completed'
        latest.txHash = txHash
        latest.data = {
          ...latest.data,
          [settlementSubmissionKey]: {
            txHash,
            ...(userOperationHash ? { userOperationHash } : {}),
          },
        }
        delete latest.error
        latest.updatedAt = Math.floor(Date.now() / 1000)
        await options.operationStore.put(latest)
      }
    }
    yield {
      type: 'completed',
      proof: intent.proof,
      data: {
        operationId: operation.id,
        action: intent.action,
        settlementTxHash: txHash,
        paymentFactor: paymentFactor.toString(),
        bondFactor: bondFactor.toString(),
      },
    }
  } catch (error) {
    if (ownsBroadcast) {
      operation.status = persistedExecutionSubmission(operation, settlementSubmissionKey) ? 'settling' : 'failed'
      operation.error = failedSettlementError
      operation.updatedAt = Math.floor(Date.now() / 1000)
      await options.operationStore.put(operation)
    }
    throw error
  }
}
