import type { LocalAccount } from 'viem'

import { createConfiguredEvmExecutor } from './aa/executor.js'
import { createPimlicoAaExecutor } from './aa/pimlico.js'
import type { EvmExecutor, EvmAddress, ResolvedEvmChainConfig } from './types.js'
import {
  deriveEvmOwnerAccount,
  resolveEvmSeedConfig,
  type EvmSeedConfig,
} from './seed.js'

export type EvmAccountDerivationOptions = {
  chains: ResolvedEvmChainConfig[]
  seed: string | EvmSeedConfig
}

export type EvmAccountManager = {
  ownerAccount(tradeIndex: number, chainId?: number): LocalAccount
  smartAccountAddress(tradeIndex: number, chainId: number): Promise<EvmAddress>
  executorForTradeIndex(tradeIndex: number): EvmExecutor
}

export function createEvmAccountManager(options: EvmAccountDerivationOptions): EvmAccountManager {
  const seed = resolveEvmSeedConfig(options.seed)
  const chains = new Map(options.chains.map(chain => [chain.chainId, chain]))

  function ownerAccount(tradeIndex: number, chainId?: number): LocalAccount {
    return deriveEvmOwnerAccount(seed.seed, {
      tradeIndex,
      ...(chainId !== undefined ? { chainId } : {}),
      ...(seed.role ? { role: seed.role } : {}),
      ...(seed.namespace ? { namespace: seed.namespace } : {}),
    })
  }

  function chainFor(chainId: number): ResolvedEvmChainConfig {
    const chain = chains.get(chainId)
    if (!chain) throw new Error(`No EVM chain configured for chainId ${chainId}`)
    return chain
  }

  return {
    ownerAccount,
    async smartAccountAddress(tradeIndex: number, chainId: number) {
      const chain = chainFor(chainId)
      return createPimlicoAaExecutor({ chain, owner: ownerAccount(tradeIndex, chainId) }).getSmartAccountAddress()
    },
    executorForTradeIndex(tradeIndex: number) {
      return createConfiguredEvmExecutor({
        chains: options.chains,
        accountForChain: chain => ownerAccount(tradeIndex, chain.chainId),
      })
    },
  }
}
