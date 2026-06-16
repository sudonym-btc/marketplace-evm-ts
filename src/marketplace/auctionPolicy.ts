import { evmAuctionPolicies } from './policies.js'
import { EvmMarketplacePolicyBase } from './policyBase.js'
import { isMarketplaceDriverEncryptedPaymentProofParams } from '@sudonym-btc/marketplace-driver-interface'
import type {
  EvmAuctionPaymentPolicy,
  EvmAuctionPolicy,
  GenericAuctionSettlementIntent,
  GenericAuctionSettlementResult,
  EvmMarketplacePolicyOptions,
} from './types.js'

function proofParams(intent: GenericAuctionSettlementIntent): Record<string, unknown> {
  if (isMarketplaceDriverEncryptedPaymentProofParams(intent.proof.params)) {
    throw new Error('EVM auction settlement requires clear payment proof params')
  }
  return { ...intent.proof.params }
}

function settlementProof(
  intent: GenericAuctionSettlementIntent,
  params: Record<string, unknown>,
): GenericAuctionSettlementResult {
  return {
    proof: {
      ...intent.proof,
      params,
    },
    data: {
      method: 'evm',
      action: intent.action,
      policyType: params.policyType,
    },
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

  async refundPayment(intent: GenericAuctionSettlementIntent & { action: 'auction_refund'; refundPercent: number }) {
    const params = proofParams(intent)
    return settlementProof(intent, {
      ...params,
      action: 'auction_refund',
      refundPercent: intent.refundPercent,
      refunded: true,
    })
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
    return settlementProof(intent, {
      ...params,
      action: 'auction_promote',
      policyType: 'evm:multi-escrow',
      purpose: 'order',
      sourcePolicyType: params.policyType ?? 'evm:multi-escrow-auction-v1',
      sourceSettlementId: intent.expected?.settlementId,
      sourceTradeId: params.tradeId,
      tradeId: intent.targetTradeId,
      settlementId: intent.targetOrderGroupId,
      ...(intent.targetUnlockAt !== undefined ? { unlockAt: intent.targetUnlockAt } : {}),
      recycleArgs: intent.recycleArgs,
      recycled: true,
    })
  }
}

export function createEvmAuctionPolicy(options: EvmMarketplacePolicyOptions): EvmAuctionPolicy {
  return new EvmAuctionPolicyImpl(options)
}
