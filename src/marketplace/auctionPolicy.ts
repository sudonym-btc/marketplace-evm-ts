import { resolveEvmChainConfigs } from '../chains.js'
import { createMarketplaceEvmClient } from '../client.js'
import { evmPaymentAssets } from './assets.js'
import { recoverActiveEvmSwapOperations } from './operationRecovery.js'
import { payEvmIntent } from './pay.js'
import { evmAuctionPolicies } from './policies.js'
import { validateEvmMarketplacePayment } from './validate.js'
import type {
  EvmAuctionPolicy,
  GenericAuctionSettlementIntent,
  GenericAuctionSettlementResult,
  EvmMarketplacePolicyOptions,
  EvmMarketplacePolicyState,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

function proofParams(intent: GenericAuctionSettlementIntent): Record<string, unknown> {
  return { ...intent.proof.params }
}

function settlementProof(
  intent: GenericAuctionSettlementIntent,
  params: Record<string, unknown>,
): GenericAuctionSettlementResult {
  return {
    proof: {
      method: 'evm',
      params,
    },
    data: {
      method: 'evm',
      action: intent.action,
      policyType: params.policyType,
    },
  }
}

export function createEvmAuctionPolicy(options: EvmMarketplacePolicyOptions): EvmAuctionPolicy {
  const chains = resolveEvmChainConfigs(options.chains) as ResolvedEvmMarketplaceChainConfig[]
  let currentState: EvmMarketplacePolicyState = {
    enabled: evmAuctionPolicies(chains).length > 0,
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
    id: 'evm:multi-escrow-auction-v1',
    subject: 'bid',
    family: 'auction',
    policies: () => evmAuctionPolicies(chains),
    assets: () => evmPaymentAssets(chains, options.appId),
    state: () => currentState,

    async discoverHighWatermark(context) {
      const evm = client(context.seed)
      if (!evm.discoverHighWatermark) throw new Error('EVM high watermark discovery is unavailable')
      const discovery = await evm.discoverHighWatermark({
        highWaterMark: context.highWaterMark,
        unusedWindow: context.unusedWindow,
      })
      currentState = {
        ...currentState,
        maxUsedIndex: discovery.maxUsedIndex,
        nextTradeIndex: discovery.nextUnusedIndex,
      }
      return {
        policy: 'evm:multi-escrow-auction-v1',
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
      const recovery = await recoverActiveEvmSwapOperations({
        chains,
        operationStore: options.operationStore,
        seed: context.seed,
        client,
      })
      currentState = {
        ...currentState,
        started: true,
        maxUsedIndex: context.highWaterMark,
        nextTradeIndex: context.nextUnusedIndex,
        startSummary: `${recovery.resumed} active EVM auction operation(s) resumed; ${recovery.settled.length} settled; ${recovery.failed.length} failed`,
      }
      return {
        policy: 'evm:multi-escrow-auction-v1',
        data: {
          auctionPolicyCount: evmAuctionPolicies(chains).length,
          activeOperations: recovery.activeOperations,
          resumed: recovery.resumed,
          settled: recovery.settled.length,
          failed: recovery.failed,
        },
      }
    },

    async *recover(payment) {
      yield {
        type: 'noop',
        data: {
          reason: 'EVM auction bid recovery uses the same MultiEscrow proof recovery path as orders',
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
      const policyType = request.proof.params.policyType
      if (policyType && policyType !== 'evm:multi-escrow-auction-v1') {
        return Promise.resolve({
          method: 'evm',
          status: 'unverifiable',
          error: `EVM auction policy cannot validate ${String(policyType)}`,
        })
      }
      return validateEvmMarketplacePayment(chains, request)
    },

    async refundPayment(intent) {
      const params = proofParams(intent)
      return settlementProof(intent, {
        ...params,
        action: 'auction_refund',
        refundPercent: intent.refundPercent,
        refunded: true,
      })
    },

    async recyclePayment(intent) {
      if (intent.recycleArgs === undefined || intent.recycleArgs === null) {
        throw new Error('EVM auction promotion requires recycleArgs')
      }
      const params = proofParams(intent)
      return settlementProof(intent, {
        ...params,
        action: 'auction_promote',
        policyType: 'evm:multi-escrow',
        subject: 'order',
        sourcePolicyType: params.policyType ?? 'evm:multi-escrow-auction-v1',
        sourceSettlementId: intent.expected?.settlementId,
        sourceTradeId: params.tradeId,
        tradeId: intent.targetTradeId,
        settlementId: intent.targetOrderGroupId,
        ...(intent.targetUnlockAt !== undefined ? { unlockAt: intent.targetUnlockAt } : {}),
        recycleArgs: intent.recycleArgs,
        recycled: true,
      })
    },
  }
}
