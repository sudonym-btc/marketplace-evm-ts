import { evmAuctionPolicies } from './policies.js'
import { EvmMarketplacePolicyBase } from './policyBase.js'
import { isMarketplaceDriverEncryptedPaymentProofParams } from '@sudonym-btc/marketplace-driver-interface'
import { normalizeAddress } from '../utils/hex.js'
import { decodeEventLog, hashStruct, keccak256, toHex } from 'viem'
import { multiEscrowAbi } from '@sudonym-btc/marketplace-evm-contracts'
import { evmEscrowContractBytecodeHash } from './policies.js'
import { sha256Hex } from '../utils/sha256.js'
import type {
  EvmAuctionPaymentPolicy,
  EvmAuctionPolicy,
  GenericAuctionSettlementIntent,
  GenericAuctionSettlementResult,
  EvmMarketplacePolicyOptions,
  GenericSwapResumeContext,
  GenericSwapResumeState,
} from './types.js'
import type { EvmAddress, EvmHash, EvmHex, EvmOperationRecord, NamedEvmCall } from '../types.js'
import type { MarketplaceEvmClient } from '../client.js'

const arbitrateTypes = {
  Arbitrate: [
    { name: 'tradeId', type: 'bytes32' },
    { name: 'paymentFactor', type: 'uint256' },
    { name: 'bondFactor', type: 'uint256' },
  ],
} as const

const tradeTermsTypes = {
  TradeTerms: [
    { name: 'tradeId', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'arbiter', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'paymentAmount', type: 'uint256' },
    { name: 'bondAmount', type: 'uint256' },
    { name: 'unlockAt', type: 'uint256' },
    { name: 'timeoutClaimant', type: 'address' },
    { name: 'escrowFee', type: 'uint256' },
    { name: 'contextHash', type: 'bytes32' },
    { name: 'recycleCovenantHash', type: 'bytes32' },
  ],
} as const

const recycleTypes = {
  Recycle: [
    { name: 'sourceTradeId', type: 'bytes32' },
    { name: 'targetTermsHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

type RecycleTarget = {
  chainId: number
  contractAddress: EvmAddress
  contractBytecodeHash: EvmHex
  buyerAddress: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  paymentAmount: bigint
  bondAmount: bigint
  timeoutClaimantAddress: EvmAddress
  escrowFee: bigint
  contextHash: EvmHex
  recycleCovenantHash: EvmHex
  deadline: bigint
  buyerSignature?: EvmHex
}

function proofParams(intent: GenericAuctionSettlementIntent): Record<string, unknown> {
  if (isMarketplaceDriverEncryptedPaymentProofParams(intent.proof.params)) {
    throw new Error('EVM auction settlement requires clear payment proof params')
  }
  return { ...intent.proof.params }
}

function canonicalJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify({ $bigint: value.toString() })
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function settlementActionKey(intent: GenericAuctionSettlementIntent): EvmHash {
  // Bind every durable settlement input. The seed is deliberately excluded: it
  // selects local key material but does not change the requested financial act.
  const { seed: _seed, ...durableIntent } = intent
  return keccak256(toHex(canonicalJson({ version: 1, intent: durableIntent })))
}

function settlementProof(
  intent: GenericAuctionSettlementIntent,
  params: Record<string, unknown>,
  txHash: EvmHash,
  data: Record<string, unknown> = {},
): GenericAuctionSettlementResult {
  return {
    proof: {
      ...intent.proof,
      params,
    },
    receipt: {
      status: 'completed',
      operationId: intent.operationId,
      externalId: txHash,
      evidence: { chainId: params.chainId, txHash },
    },
    data: {
      method: 'evm',
      action: intent.action,
      policyType: params.policyType,
      ...data,
    },
  }
}

function stringParam(params: Record<string, unknown>, name: string): string {
  const value = params[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid EVM auction settlement ${name}`)
  return value
}

function numberParam(params: Record<string, unknown>, name: string): number {
  const value = params[name]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid EVM auction settlement ${name}`)
  return value
}

function bytes32Param(params: Record<string, unknown>, name: string): EvmHex {
  const raw = stringParam(params, name).replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`Invalid EVM auction settlement ${name}`)
  return `0x${raw.toLowerCase()}` as EvmHex
}

function contractAddressParam(params: Record<string, unknown>): EvmAddress {
  return normalizeAddress(stringParam(params, 'contractAddress'), 'contractAddress')
}

function bigintParam(params: Record<string, unknown>, name: string): bigint {
  const value = stringParam(params, name)
  if (!/^\d+$/.test(value)) throw new Error(`Invalid EVM auction settlement ${name}`)
  return BigInt(value)
}

function objectParam(params: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = params[name]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid EVM auction settlement ${name}`)
  }
  return value as Record<string, unknown>
}

function parseRecycleTarget(intent: GenericAuctionSettlementIntent): RecycleTarget {
  const recycle = objectParam({ recycleArgs: intent.recycleArgs }, 'recycleArgs')
  const target = objectParam(recycle, 'target')
  return {
    chainId: numberParam(target, 'chainId'),
    contractAddress: contractAddressParam(target),
    contractBytecodeHash: bytes32Param(target, 'contractBytecodeHash'),
    buyerAddress: normalizeAddress(stringParam(target, 'buyerAddress'), 'buyerAddress'),
    sellerAddress: normalizeAddress(stringParam(target, 'sellerAddress'), 'sellerAddress'),
    arbiterAddress: normalizeAddress(stringParam(target, 'arbiterAddress'), 'arbiterAddress'),
    assetAddress: normalizeAddress(stringParam(target, 'assetAddress'), 'assetAddress'),
    paymentAmount: bigintParam(target, 'paymentAmount'),
    bondAmount: bigintParam(target, 'bondAmount'),
    timeoutClaimantAddress: normalizeAddress(stringParam(target, 'timeoutClaimantAddress'), 'timeoutClaimantAddress'),
    escrowFee: bigintParam(target, 'escrowFee'),
    contextHash: bytes32Param(target, 'contextHash'),
    recycleCovenantHash: bytes32Param(target, 'recycleCovenantHash'),
    deadline: target.deadline === undefined ? 0n : bigintParam(target, 'deadline'),
    ...(target.buyerSignature ? { buyerSignature: stringParam(target, 'buyerSignature') as EvmHex } : {}),
  }
}

class EvmAuctionPolicyImpl
  extends EvmMarketplacePolicyBase<EvmAuctionPaymentPolicy, 'evm:multi-escrow-auction-v1', 'bid', 'auction'>
  implements EvmAuctionPolicy {
  declare readonly method: 'evm'
  declare readonly id: 'evm:multi-escrow-auction-v1'
  declare readonly purpose: 'bid'
  declare readonly family: 'auction'

  constructor(options: EvmMarketplacePolicyOptions) {
    super(options, {
      id: 'evm:multi-escrow-auction-v1',
      label: 'EVM auction',
      purpose: 'bid',
      family: 'auction',
      enabled: evmAuctionPolicies(options.chains).length > 0,
      recoveryNoun: 'auction',
      recoveryReason: 'EVM auction bid recovery uses the same MultiEscrow proof recovery path as orders',
      expectedProofPolicyType: 'evm:multi-escrow-auction-v1',
    })
  }

  policies(): EvmAuctionPaymentPolicy[] {
    return evmAuctionPolicies(this.chains)
  }

  protected startupData(): Record<string, unknown> {
    return {
      auctionPolicyCount: this.policies().length,
    }
  }

  async *resumeSwapOperations(context: GenericSwapResumeContext): AsyncIterable<GenericSwapResumeState> {
    const pendingSettlements = await this.operationStore.list({ kind: 'escrow', status: 'settling' })
    for (const operation of pendingSettlements) {
      const recoveryIntent = operation.data.recoveryIntent
      if (!recoveryIntent || typeof recoveryIntent !== 'object' || Array.isArray(recoveryIntent)) {
        yield { type: 'failed', error: `Settlement ${operation.id} is missing its recovery intent` }
        continue
      }
      try {
        const intent = recoveryIntent as GenericAuctionSettlementIntent
        const result = intent.action === 'auction_refund'
          ? await this.refundPayment(intent as GenericAuctionSettlementIntent & {
              action: 'auction_refund'
              refundPercent: number
            })
          : await this.recyclePayment(intent as GenericAuctionSettlementIntent & {
              action: 'auction_promote'
              targetTradeId: string
              targetOrderGroupId: string
            })
        yield {
          type: 'progress',
          status: `Reconciled EVM ${intent.action}`,
          data: { operationId: operation.id, receipt: result.receipt },
        }
      } catch (error) {
        yield {
          type: 'failed',
          error: error instanceof Error ? error.message : `Unable to recover settlement ${operation.id}`,
          data: { operationId: operation.id },
        }
      }
    }
    yield* super.resumeSwapOperations(context)
  }

  private chainForSettlement(chainId: number, contractAddress: EvmAddress, bytecodeHash?: EvmHex) {
    const chain = this.chains.find(candidate => candidate.chainId === chainId)
    if (!chain) throw new Error(`No configured EVM marketplace chain ${chainId}`)
    if (contractAddress.toLowerCase() !== chain.multiEscrowAddress.toLowerCase()) {
      throw new Error('Auction settlement contract does not match configured MultiEscrow deployment')
    }
    const configuredHash = evmEscrowContractBytecodeHash(this.chains, chainId)
    if (bytecodeHash && bytecodeHash.toLowerCase() !== configuredHash.toLowerCase()) {
      throw new Error('Auction settlement contract hash does not match configured MultiEscrow runtime')
    }
    return { chain, configuredHash }
  }

  private async verifyConfiguredRuntime(chainId: number, contractAddress: EvmAddress, expectedHash: EvmHex) {
    const chain = this.chains.find(candidate => candidate.chainId === chainId)
    if (!chain) throw new Error(`No configured EVM marketplace chain ${chainId}`)
    const bytecode = await chain.publicClient.getBytecode({ address: contractAddress })
    if (!bytecode || bytecode === '0x') throw new Error('Configured MultiEscrow deployment has no runtime bytecode')
    if ((await sha256Hex(bytecode)).toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error('Configured MultiEscrow runtime bytecode hash mismatch')
    }
  }

  private async beginSettlement(
    intent: GenericAuctionSettlementIntent,
    params: Record<string, unknown>,
  ): Promise<{ record: EvmOperationRecord; completed?: GenericAuctionSettlementResult }> {
    const actionKey = settlementActionKey(intent)
    const now = Math.floor(Date.now() / 1000)
    const record: EvmOperationRecord = {
      id: intent.operationId,
      kind: 'escrow',
      status: 'settling',
      chainId: numberParam(params, 'chainId'),
      tradeId: stringParam(params, 'tradeId'),
      data: {
        actionKey,
        action: intent.action,
        recoveryIntent: {
          purpose: intent.purpose,
          action: intent.action,
          operationId: intent.operationId,
          proof: intent.proof,
          ...(intent.expected ? { expected: intent.expected } : {}),
          ...(intent.refundPercent !== undefined ? { refundPercent: intent.refundPercent } : {}),
          ...(intent.targetTradeId ? { targetTradeId: intent.targetTradeId } : {}),
          ...(intent.targetOrderGroupId ? { targetOrderGroupId: intent.targetOrderGroupId } : {}),
          ...(intent.targetUnlockAt !== undefined ? { targetUnlockAt: intent.targetUnlockAt } : {}),
          ...(intent.recycleArgs !== undefined ? { recycleArgs: intent.recycleArgs } : {}),
        },
      },
      createdAt: now,
      updatedAt: now,
    }
    let current = record
    if (this.operationStore.putIfAbsent) {
      if (!(await this.operationStore.putIfAbsent(record))) {
        current = await this.operationStore.get(record.id) ?? (() => { throw new Error('Settlement operation disappeared') })()
      }
    } else {
      current = await this.operationStore.get(record.id) ?? record
      if (current === record) await this.operationStore.put(record)
    }
    if (current.data.actionKey !== actionKey) {
      throw new Error(`Settlement operation ${intent.operationId} is already bound to a different action`)
    }
    if (current.status === 'completed') {
      const result = current.data.settlementResult
      if (!result || typeof result !== 'object') throw new Error(`Completed settlement ${current.id} has no result`)
      return { record: current, completed: result as GenericAuctionSettlementResult }
    }
    current.status = 'settling'
    current.updatedAt = now
    await this.operationStore.put(current)
    return { record: current }
  }

  private async completeSettlement(record: EvmOperationRecord, result: GenericAuctionSettlementResult) {
    record.status = 'completed'
    if (result.receipt.externalId) record.txHash = result.receipt.externalId as EvmHash
    record.updatedAt = Math.floor(Date.now() / 1000)
    record.data = { ...record.data, settlementResult: result, receipt: result.receipt }
    await this.operationStore.put(record)
  }

  private async executeSettlementCall(
    record: EvmOperationRecord,
    client: MarketplaceEvmClient,
    call: NamedEvmCall,
    chainId: number,
  ): Promise<EvmHash> {
    if (!client.executor) throw new Error('EVM auction settlement requires an executor')
    if (record.txHash) return record.txHash
    const persistedUserOperationHash = record.data.userOperationHash as EvmHash | undefined
    if (persistedUserOperationHash) {
      if (!client.executor.waitForSubmission) {
        throw new Error(`Settlement ${record.id} has a pending user operation but executor cannot reconcile it`)
      }
      const reconciled = await client.executor.waitForSubmission(
        { userOperationHash: persistedUserOperationHash },
        { chainId },
      )
      record.txHash = reconciled.txHash
      record.updatedAt = Math.floor(Date.now() / 1000)
      await this.operationStore.put(record)
      return reconciled.txHash
    }
    const execution = await client.executor.execute([call], {
      chainId,
      operationId: record.id,
      waitForReceipt: true,
      onSubmitted: async submission => {
        if (submission.txHash) record.txHash = submission.txHash
        record.data = {
          ...record.data,
          ...(submission.userOperationHash ? { userOperationHash: submission.userOperationHash } : {}),
          submittedAt: Math.floor(Date.now() / 1000),
        }
        record.updatedAt = Math.floor(Date.now() / 1000)
        await this.operationStore.put(record)
      },
    })
    record.txHash = execution.txHash
    record.updatedAt = Math.floor(Date.now() / 1000)
    await this.operationStore.put(record)
    return execution.txHash
  }

  private async arbitrateAuctionPayment(
    intent: GenericAuctionSettlementIntent,
    paymentFactor: bigint,
    bondFactor: bigint,
    record: EvmOperationRecord,
  ): Promise<{ txHash: EvmHash; call: NamedEvmCall }> {
    const params = proofParams(intent)
    const chainId = numberParam(params, 'chainId')
    const contractAddress = contractAddressParam(params)
    const tradeId = bytes32Param(params, 'tradeId')
    const proofHash = params.contractBytecodeHash ? bytes32Param(params, 'contractBytecodeHash') : undefined
    const { chain, configuredHash } = this.chainForSettlement(chainId, contractAddress, proofHash)
    await this.verifyConfiguredRuntime(chainId, contractAddress, configuredHash)
    if (!this.settlementAccount) throw new Error('EVM auction settlement requires a settlement account')
    const arbiterAddress = normalizeAddress(stringParam(params, 'arbiterAddress'), 'arbiterAddress')
    if (this.settlementAccount.address.toLowerCase() !== arbiterAddress.toLowerCase()) {
      throw new Error('EVM settlement account is not the escrow arbiter')
    }
    const signature = await this.settlementAccount.signTypedData({
      domain: {
        name: 'Nostr MultiEscrow',
        version: '7',
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
    const client = this.settlementClient()
    const call = client.escrow.arbitrate({
      tradeId,
      contractAddress,
      paymentFactor,
      bondFactor,
      signature,
    })
    const txHash = await this.executeSettlementCall(record, client, call, chainId)
    const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') throw new Error(`Auction refund transaction reverted: ${txHash}`)
    const matched = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) return false
      try {
        const decoded = decodeEventLog({ abi: multiEscrowAbi, eventName: 'Arbitrated', data: log.data, topics: log.topics })
        return decoded.args.tradeId.toLowerCase() === tradeId.toLowerCase()
          && decoded.args.paymentFactor === paymentFactor
          && decoded.args.bondFactor === bondFactor
      } catch {
        return false
      }
    })
    if (!matched) throw new Error('Auction refund receipt is missing the exact Arbitrated event')
    return { txHash, call }
  }

  async refundPayment(intent: GenericAuctionSettlementIntent & { action: 'auction_refund'; refundPercent: number }) {
    const params = proofParams(intent)
    const settlement = await this.beginSettlement(intent, params)
    if (settlement.completed) return settlement.completed
    if (!Number.isSafeInteger(intent.refundPercent) || intent.refundPercent < 0 || intent.refundPercent > 100) {
      throw new Error('EVM auction refundPercent must be an integer from 0 to 100')
    }
    const sellerFactor = BigInt(100 - intent.refundPercent) * 10n
    const arbitration = await this.arbitrateAuctionPayment(
      intent,
      sellerFactor,
      sellerFactor,
      settlement.record,
    )
    const result = settlementProof(intent, {
      ...params,
      action: 'auction_refund',
      refundPercent: intent.refundPercent,
      refunded: true,
      settlementTxHash: arbitration.txHash,
    }, arbitration.txHash, {
      settlementTxHash: arbitration.txHash,
      settlementCall: arbitration.call.name,
      paymentFactor: sellerFactor.toString(),
      bondFactor: sellerFactor.toString(),
    })
    await this.completeSettlement(settlement.record, result)
    return result
  }

  async recyclePayment(
    intent: GenericAuctionSettlementIntent & {
      action: 'auction_promote'
      targetTradeId: string
      targetOrderGroupId: string
    },
  ) {
    if (intent.recycleArgs === undefined || intent.recycleArgs === null) {
      throw new Error('EVM auction promotion requires recycleArgs')
    }
    const params = proofParams(intent)
    const settlement = await this.beginSettlement(intent, params)
    if (settlement.completed) return settlement.completed
    if (intent.targetUnlockAt === undefined || !Number.isSafeInteger(intent.targetUnlockAt)) {
      throw new Error('EVM auction promotion requires an integer targetUnlockAt')
    }
    const target = parseRecycleTarget(intent)
    const sourceChainId = numberParam(params, 'chainId')
    const sourceContract = contractAddressParam(params)
    if (target.chainId !== sourceChainId || target.contractAddress.toLowerCase() !== sourceContract.toLowerCase()) {
      throw new Error('EVM auction promotion cannot recycle across contracts or chains')
    }
    const { chain, configuredHash } = this.chainForSettlement(
      target.chainId,
      target.contractAddress,
      target.contractBytecodeHash,
    )
    await this.verifyConfiguredRuntime(target.chainId, target.contractAddress, configuredHash)
    if (!this.settlementAccount) throw new Error('EVM auction settlement requires a settlement account')
    if (this.settlementAccount.address.toLowerCase() !== target.arbiterAddress.toLowerCase()) {
      throw new Error('EVM settlement account is not the target escrow arbiter')
    }
    const sourceTradeId = bytes32Param(params, 'tradeId')
    const targetContractTradeId = bytes32Param({ tradeId: intent.targetOrderGroupId }, 'tradeId')
    const unlockAt = BigInt(intent.targetUnlockAt)
    const targetTerms = {
      tradeId: targetContractTradeId,
      buyer: target.buyerAddress,
      seller: target.sellerAddress,
      arbiter: target.arbiterAddress,
      token: target.assetAddress,
      paymentAmount: target.paymentAmount,
      bondAmount: target.bondAmount,
      unlockAt,
      timeoutClaimant: target.timeoutClaimantAddress,
      escrowFee: target.escrowFee,
      contextHash: target.contextHash,
      recycleCovenantHash: target.recycleCovenantHash,
    }
    const targetTermsHash = hashStruct({
      types: tradeTermsTypes,
      primaryType: 'TradeTerms',
      data: targetTerms,
    })
    const arbiterSignature = await this.settlementAccount.signTypedData({
      domain: {
        name: 'Nostr MultiEscrow',
        version: '7',
        chainId: target.chainId,
        verifyingContract: target.contractAddress,
      },
      types: recycleTypes,
      primaryType: 'Recycle',
      message: { sourceTradeId, targetTermsHash, deadline: target.deadline },
    })
    const client = this.settlementClient()
    const call = client.escrow.recycle({
      sourceTradeId,
      targetTradeId: targetContractTradeId,
      buyerAddress: target.buyerAddress,
      sellerAddress: target.sellerAddress,
      arbiterAddress: target.arbiterAddress,
      assetAddress: target.assetAddress,
      paymentAmount: {
        value: target.paymentAmount,
        denomination: stringParam(params, 'denomination'),
        decimals: numberParam(params, 'decimals'),
      },
      bondAmount: {
        value: target.bondAmount,
        denomination: stringParam(params, 'denomination'),
        decimals: numberParam(params, 'decimals'),
      },
      unlockAt,
      timeoutClaimantAddress: target.timeoutClaimantAddress,
      escrowFee: {
        value: target.escrowFee,
        denomination: stringParam(params, 'denomination'),
        decimals: numberParam(params, 'decimals'),
      },
      contextHash: target.contextHash,
      recycleCovenantHash: target.recycleCovenantHash,
      deadline: target.deadline,
      ...(target.buyerSignature ? { buyerSignature: target.buyerSignature } : {}),
      arbiterSignature,
      contractAddress: target.contractAddress,
    })
    const recycleTxHash = await this.executeSettlementCall(settlement.record, client, call, target.chainId)
    const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: recycleTxHash })
    if (receipt.status !== 'success') throw new Error(`Auction recycle transaction reverted: ${recycleTxHash}`)
    const recycledAmount = target.paymentAmount + target.bondAmount
    const matched = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== target.contractAddress.toLowerCase()) return false
      try {
        const decoded = decodeEventLog({ abi: multiEscrowAbi, eventName: 'FundsRecycled', data: log.data, topics: log.topics })
        return decoded.args.sourceTradeId.toLowerCase() === sourceTradeId.toLowerCase()
          && decoded.args.targetTradeId.toLowerCase() === targetContractTradeId.toLowerCase()
          && decoded.args.token.toLowerCase() === target.assetAddress.toLowerCase()
          && decoded.args.buyer.toLowerCase() === target.buyerAddress.toLowerCase()
          && decoded.args.arbiter.toLowerCase() === target.arbiterAddress.toLowerCase()
          && decoded.args.amount === recycledAmount
          && decoded.args.contextHash.toLowerCase() === target.contextHash.toLowerCase()
      } catch {
        return false
      }
    })
    if (!matched) throw new Error('Auction promotion receipt is missing the exact FundsRecycled event')

    const denomination = stringParam(params, 'denomination')
    const decimals = numberParam(params, 'decimals')
    const currency = typeof params.currency === 'string' ? params.currency : undefined
    const assetId = `${target.chainId}:${target.assetAddress.toLowerCase()}`
    const netPayment = target.paymentAmount - target.escrowFee
    const paymentAmount = {
      value: netPayment.toString(),
      ...(currency ? { currency } : {}),
      denomination,
      decimals,
      assetId,
    }
    const fundedAmount = { ...paymentAmount, value: recycledAmount.toString() }
    const feeAmount = { ...paymentAmount, value: target.escrowFee.toString() }
    const orderPolicyId = `evm:${target.chainId}:${target.contractAddress.toLowerCase()}`
    const promotedParams = {
      ...params,
      action: 'auction_promote',
      policyType: 'evm:multi-escrow',
      policyId: orderPolicyId,
      policyHash: configuredHash,
      contractAddress: target.contractAddress,
      contractBytecodeHash: configuredHash,
      chainId: target.chainId,
      purpose: 'order',
      sourcePolicyType: params.policyType ?? 'evm:multi-escrow-auction-v1',
      sourceSettlementId: intent.expected?.settlementId,
      sourceTradeId: params.tradeId,
      logicalTradeId: intent.targetTradeId,
      tradeId: intent.targetOrderGroupId,
      settlementId: intent.targetOrderGroupId,
      buyerAddress: target.buyerAddress,
      sellerAddress: target.sellerAddress,
      arbiterAddress: target.arbiterAddress,
      assetAddress: target.assetAddress,
      value: netPayment.toString(),
      paymentAmount: netPayment.toString(),
      fundedValue: target.paymentAmount.toString(),
      bondAmount: target.bondAmount.toString(),
      escrowFee: target.escrowFee.toString(),
      unlockAt: unlockAt.toString(),
      timeoutClaimantAddress: target.timeoutClaimantAddress,
      contextHash: target.contextHash,
      recycleCovenantHash: target.recycleCovenantHash,
      txHash: recycleTxHash,
      recycleArgs: intent.recycleArgs,
      recycled: true,
      recycleTxHash,
    }
    const result: GenericAuctionSettlementResult = {
      proof: {
        driver: intent.proof.driver,
        terms: {
          version: 1,
          asset: paymentAmount,
          parties: [
            { role: 'buyer', id: target.buyerAddress },
            { role: 'seller', id: target.sellerAddress },
            { role: 'arbiter', id: target.arbiterAddress },
          ],
          lock: {
            id: targetContractTradeId,
            policyId: orderPolicyId,
            kind: 'contract',
            amount: fundedAmount,
            controls: [
              { role: 'buyer', id: target.buyerAddress },
              { role: 'seller', id: target.sellerAddress },
              { role: 'arbiter', id: target.arbiterAddress },
            ],
            conditions: {
              policyType: 'evm:multi-escrow',
              chainId: target.chainId,
              contractAddress: target.contractAddress,
              contextHash: target.contextHash,
              recycleCovenantHash: target.recycleCovenantHash,
              timeoutClaimantAddress: target.timeoutClaimantAddress,
              unlockAt: unlockAt.toString(),
              escrowFee: feeAmount,
              arbitration: { type: 'continuous', denominator: '1000' },
            },
          },
        },
        params: promotedParams,
      },
      receipt: {
        status: 'completed',
        operationId: intent.operationId,
        externalId: recycleTxHash,
        evidence: {
          chainId: target.chainId,
          txHash: recycleTxHash,
          sourceTradeId,
          targetTradeId: targetContractTradeId,
          amount: recycledAmount.toString(),
        },
      },
      data: {
        method: 'evm',
        action: intent.action,
        settlementCall: call.name,
        sourceTradeId,
        targetTradeId: targetContractTradeId,
      },
    }
    await this.completeSettlement(settlement.record, result)
    return result
  }
}

export function createEvmAuctionPolicy(options: EvmMarketplacePolicyOptions): EvmAuctionPolicy {
  return new EvmAuctionPolicyImpl(options)
}
