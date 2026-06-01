import type { LocalAccount } from 'viem'

import type { EvmExecutor, NamedEvmCall, ResolvedEvmChainConfig } from '../types.js'
import { createPimlicoAaExecutor } from './pimlico.js'

export type ConfiguredEvmExecutorOptions = {
  chains: ResolvedEvmChainConfig[]
  account?: LocalAccount
  accountForChain?: (chain: ResolvedEvmChainConfig) => LocalAccount
}

export function createConfiguredEvmExecutor(options: ConfiguredEvmExecutorOptions): EvmExecutor {
  const executors = new Map<number, EvmExecutor>()
  const accountForChain = options.accountForChain ?? (() => options.account)
  if (!options.account && !options.accountForChain) {
    throw new Error('createConfiguredEvmExecutor requires account or accountForChain')
  }

  for (const chain of options.chains) {
    if (!chain.accountAbstraction) {
      throw new Error(`Chain ${chain.id} requires accountAbstraction config`)
    }
    const account = accountForChain(chain)
    if (!account) throw new Error(`No EVM account available for chain ${chain.id}`)
    executors.set(
      chain.chainId,
      adaptAaExecutor(createPimlicoAaExecutor({ chain, owner: account }), chain.chainId),
    )
  }

  return {
    async getAddress(chainId) {
      return getExecutor(executors, chainId).getAddress(chainId)
    },
    execute(calls: NamedEvmCall[], executionOptions) {
      return getExecutor(executors, executionOptions.chainId).execute(calls, executionOptions)
    },
  }
}

function adaptAaExecutor(
  executor: ReturnType<typeof createPimlicoAaExecutor>,
  chainId: number,
): EvmExecutor {
  return {
    getAddress() {
      return executor.getSmartAccountAddress()
    },
    execute(calls, options) {
      return executor.execute(calls, { ...options, chainId })
    },
  }
}

function getExecutor(executors: Map<number, EvmExecutor>, chainId: number): EvmExecutor {
  const executor = executors.get(chainId)
  if (!executor) throw new Error(`No EVM executor configured for chain ${chainId}`)
  return executor
}
