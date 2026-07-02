import { evmAuctionPolicies } from './policies.js'
import { EvmMarketplacePolicyBase } from './policyBase.js'
import { isMarketplaceDriverEncryptedPaymentProofParams } from '@sudonym-btc/marketplace-driver-interface'
import { normalizeAddress } from '../utils/hex.js'
import type {
  EvmAuctionPaymentPolicy,
  EvmAuctionPolicy,
  GenericAuctionSettlementIntent,
  GenericAuctionSettlementResult,
  EvmMarketplacePolicyOptions,
} from './types.js'
import type { EvmAddress, EvmHash, EvmHex, NamedEvmCall } from '../types.js'

const arbitrateTypes = {
  Arbitrate: [
    { name: 'tradeId', type: 'bytes32' },
    { name: 'paymentFactor', type: 'uint256' },
    { name: 'bondFactor', type: 'uint256' },
  ],
} as const

function proofParams(intent: GenericAuctionSettlementIntent): Record<string, unknown> {
  if (isMarketplaceDriverEncryptedPaymentProofParams(intent.proof.params)) {
    throw new Error('EVM auction settlement requires clear payment proof params')
  }
  return { ...intent.proof.params }
}

function settlementProof(
  intent: GenericAuctionSettlementIntent,
  params: Record<string, unknown>,
  data: Record<string, unknown> = {},
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

  private async arbitrateAuctionPayment(
    intent: GenericAuctionSettlementIntent,
    paymentFactor: bigint,
    bondFactor: bigint,
  ): Promise<{ txHash: EvmHash; call: NamedEvmCall }> {
    const params = proofParams(intent)
    const chainId = numberParam(params, 'chainId')
    const contractAddress = contractAddressParam(params)
    const tradeId = bytes32Param(params, 'tradeId')
    if (!this.settlementAccount) throw new Error('EVM auction settlement requires a settlement account')
    const signature = await this.settlementAccount.signTypedData({
      domain: {
        name: 'Nostr MultiEscrow',
        version: '6',
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
    if (!client.executor) throw new Error('EVM auction settlement requires an executor')
    const call = client.escrow.arbitrate({
      tradeId,
      contractAddress,
      paymentFactor,
      bondFactor,
      signature,
    })
    const result = await client.executor.execute([call], {
      chainId,
      operationId: `auction-settlement-${tradeId}-${intent.action}`,
    })
    return { txHash: result.txHash, call }
  }

  async refundPayment(intent: GenericAuctionSettlementIntent & { action: 'auction_refund'; refundPercent: number }) {
    const params = proofParams(intent)
    const arbitration = await this.arbitrateAuctionPayment(intent, 0n, 0n)
    return settlementProof(intent, {
      ...params,
      action: 'auction_refund',
      refundPercent: intent.refundPercent,
      refunded: true,
      settlementTxHash: arbitration.txHash,
    }, {
      settlementTxHash: arbitration.txHash,
      settlementCall: arbitration.call.name,
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
