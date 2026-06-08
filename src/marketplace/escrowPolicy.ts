import { resolveEvmChainConfigs } from '../chains.js'
import { createMarketplaceEvmClient } from '../client.js'
import { evmPaymentAssets } from './assets.js'
import { recoverActiveEvmSwapOperations } from './operationRecovery.js'
import { payEvmIntent } from './pay.js'
import { evmEscrowPolicies } from './policies.js'
import { validateEvmMarketplacePayment } from './validate.js'
import type {
  EvmEscrowPolicy,
  EvmMarketplacePolicyState,
  EvmMarketplacePolicyOptions,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

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
      const recovery = await recoverActiveEvmSwapOperations({
        chains,
        operationStore: options.operationStore,
        seed: context.seed,
        client,
      })
      currentState = {
        enabled: true,
        started: true,
        maxUsedIndex: context.highWaterMark,
        nextTradeIndex: context.nextUnusedIndex,
        startSummary: `${recovery.resumed} active EVM operation(s) resumed; ${recovery.settled.length} settled; ${recovery.failed.length} failed`,
      }
      return {
        policy: 'evm:multi-escrow',
        data: {
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
