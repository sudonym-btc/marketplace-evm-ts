import { resolveMarketplaceDriverPaymentProofParams } from '@sudonym-btc/marketplace-driver-interface'

import { evmEscrowPolicies } from './policies.js'
import { EvmMarketplacePolicyBase } from './policyBase.js'
import {
  completedEvmOrderSettlements,
  recoverEvmOrderSettlements,
  replayCompletedEvmMarketplacePayment,
  settleEvmMarketplacePayment,
} from './settlement.js'
import type {
  EvmEscrowPolicy,
  EvmMarketplacePolicyOptions,
  EvmEscrowPaymentPolicy,
  GenericPaymentSettlementIntent,
  GenericPaymentSettlementState,
  GenericPaymentValidationRequest,
  GenericSwapResumeContext,
  GenericSwapResumeState,
} from './types.js'

class EvmEscrowPolicyImpl
  extends EvmMarketplacePolicyBase<EvmEscrowPaymentPolicy, 'evm:multi-escrow', 'order', 'escrow'>
  implements EvmEscrowPolicy {
  declare readonly method: 'evm'
  declare readonly id: 'evm:multi-escrow'
  declare readonly purpose: 'order'
  declare readonly family: 'escrow'
  readonly settlementActions: readonly ('release' | 'refund')[]

  constructor(options: EvmMarketplacePolicyOptions) {
    super(options, {
      id: 'evm:multi-escrow',
      label: 'EVM escrow',
      purpose: 'order',
      family: 'escrow',
      enabled: true,
      recoveryNoun: 'operation',
      recoveryReason: 'EVM recovery is handled by startup using deterministic accounts and active swap operations',
    })
    this.settlementActions = options.settlementAccount ? ['release', 'refund'] : []
  }

  policies(): EvmEscrowPaymentPolicy[] {
    return evmEscrowPolicies(this.chains)
  }

  async validatePayment(request: GenericPaymentValidationRequest) {
    try {
      const completed = await completedEvmOrderSettlements({
        chains: this.chains,
        operationStore: this.operationStore,
        request,
      })
      if (completed.length === 1) {
        return {
          driver: 'evm' as const,
          status: 'valid' as const,
          amount: completed[0].amount,
          amountMatched: true,
          assetMatched: true,
          recipientMatched: true,
          arbiterMatched: true,
          data: {
            completedSettlementReplay: true,
            settlementAction: completed[0].action,
            settlementTxHash: completed[0].txHash,
            operationId: completed[0].operationId,
          },
        }
      }
    } catch {
      // With no exact completed tombstone, use ordinary live validation.
    }
    return super.validatePayment(request)
  }

  async settlementActionsForPayment(
    request: GenericPaymentValidationRequest,
  ): Promise<readonly ('release' | 'refund')[]> {
    if (!this.settlementAccount) return []
    try {
      const params = await resolveMarketplaceDriverPaymentProofParams(request.proof, request.decryptParams)
      const arbiterAddress = params.arbiterAddress
      if (typeof arbiterAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(arbiterAddress)) return []
      if (arbiterAddress.toLowerCase() !== this.settlementAccount.address.toLowerCase()) return []
      const chainId = params.chainId
      const rawTradeId = params.tradeId
      const tradeId = typeof rawTradeId === 'string'
        ? (rawTradeId.startsWith('0x') ? rawTradeId : `0x${rawTradeId}`).toLowerCase()
        : undefined
      const candidates = typeof chainId === 'number' && tradeId
        ? (await this.operationStore.list({ kind: 'escrow', status: 'completed', chainId }))
          .filter(record => record.data.purpose === 'order' && record.tradeId?.toLowerCase() === tradeId)
        : []
      if (candidates.length === 0) return this.settlementActions
      const completed = await completedEvmOrderSettlements({
        chains: this.chains,
        operationStore: this.operationStore,
        request,
        settlementAccount: this.settlementAccount,
      })
      return completed.length === 1 ? [completed[0].action] : []
    } catch {
      return []
    }
  }

  async *resumeSwapOperations(context: GenericSwapResumeContext): AsyncIterable<GenericSwapResumeState> {
    const recovery = await recoverEvmOrderSettlements({
      chains: this.chains,
      operationStore: this.operationStore,
      settlementClient: () => this.settlementClient(),
    })
    for (const result of recovery.recovered) {
      yield {
        type: 'progress',
        status: `Reconciled EVM order ${result.action}`,
        data: result,
      }
    }
    for (const failure of recovery.failed) {
      yield { type: 'failed', error: failure.error, data: { operationId: failure.operationId } }
    }
    yield* super.resumeSwapOperations(context)
  }

  async *settlePayment(intent: GenericPaymentSettlementIntent): AsyncIterable<GenericPaymentSettlementState> {
    const replay = await replayCompletedEvmMarketplacePayment({
      chains: this.chains,
      operationStore: this.operationStore,
      ...(this.settlementAccount ? { settlementAccount: this.settlementAccount } : {}),
      intent,
    })
    if (replay) {
      yield replay
      return
    }
    const validation = await this.validatePayment({
      driver: intent.proof.driver,
      proof: intent.proof,
      ...(intent.decryptParams ? { decryptParams: intent.decryptParams } : {}),
      ...(intent.expected ? { expected: intent.expected } : {}),
    })
    if (validation.status !== 'valid') {
      throw new Error(validation.error ?? `EVM escrow payment is ${validation.status}`)
    }
    yield* settleEvmMarketplacePayment({
      chains: this.chains,
      operationStore: this.operationStore,
      ...(this.settlementAccount ? { settlementAccount: this.settlementAccount } : {}),
      settlementClient: () => this.settlementClient(),
      intent,
    })
  }
}

export function createEvmEscrowPolicy(options: EvmMarketplacePolicyOptions): EvmEscrowPolicy {
  return new EvmEscrowPolicyImpl(options)
}
