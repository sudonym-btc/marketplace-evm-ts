import { createBoltzRestClient } from './boltz/restClient.js'
import { createEvmAuctionCallBuilder } from './auction/callBuilder.js'
import { createEvmAuctionValidator } from './auction/validator.js'
import { createEvmEscrowCallBuilder } from './escrow/callBuilder.js'
import { createConfiguredEvmExecutor } from './aa/executor.js'
import { createEvmAccountManager } from './accounts.js'
import { resolveEvmChainConfigs } from './chains.js'
import { createEvmHighWatermarkDiscovery } from './discovery/highWatermark.js'
import { createEvmSwapService } from './swaps/service.js'
import type { MarketplaceEvmClientOptions } from './types.js'
import { createEvmEscrowValidator } from './validation/escrowPaymentValidator.js'

export type MarketplaceEvmClient = ReturnType<typeof createMarketplaceEvmClient>

export function createMarketplaceEvmClient(options: MarketplaceEvmClientOptions) {
  const chains = resolveEvmChainConfigs(options.chains)
  for (const chain of chains) {
    if (!chain.accountAbstraction) {
      throw new Error(`Chain ${chain.id} requires accountAbstraction config`)
    }
  }

  const accounts = options.seed
    ? createEvmAccountManager({ chains, seed: options.seed })
    : undefined
  const discovery = options.seed
    ? createEvmHighWatermarkDiscovery({
        chains,
        seed: options.seed,
        ...(options.protocolActivityProbe ? { protocolActivityProbe: options.protocolActivityProbe } : {}),
        ...(options.smartAccountAddressResolver
          ? { smartAccountAddressResolver: options.smartAccountAddressResolver }
          : {}),
      })
    : undefined
  const executor =
    options.executor ??
    (options.account
      ? createConfiguredEvmExecutor({ chains, account: options.account })
      : accounts && options.tradeIndex !== undefined
        ? accounts.executorForTradeIndex(options.tradeIndex)
        : undefined)
  if (!executor && !accounts) {
    throw new Error('createMarketplaceEvmClient requires an executor, viem LocalAccount, or marketplace seed')
  }

  const escrowCalls = createEvmEscrowCallBuilder()
  const auctionCalls = createEvmAuctionCallBuilder()
  const escrowValidator = createEvmEscrowValidator({ chains })
  const auctionValidator = createEvmAuctionValidator({ chains })
  if (options.boltz && !options.seed) {
    throw new Error('Boltz swaps require a marketplace seed')
  }
  const boltz = options.boltz
    ? createBoltzRestClient({ apiUrl: options.boltz.apiUrl })
    : undefined
  const swaps = boltz
    ? createEvmSwapService({
        boltz,
        store: options.operationStore,
        seed: options.seed!,
        accounts: accounts!,
        ...(options.now ? { now: options.now } : {}),
        ...(options.logger ? { logger: options.logger } : {}),
      })
    : undefined

  return {
    chains,
    ...(executor ? { executor } : {}),
    ...(accounts ? { accounts } : {}),
    ...(discovery ? { discoverHighWatermark: discovery.discoverHighWatermark } : {}),
    operationStore: options.operationStore,
    escrow: {
      ...escrowCalls,
      validate: escrowValidator.validate,
    },
    auction: {
      ...auctionCalls,
      validate: auctionValidator.validate,
    },
    ...(swaps ? { swaps } : {}),
  }
}
