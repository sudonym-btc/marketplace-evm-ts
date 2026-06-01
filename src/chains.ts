import { createPublicClient, http, type Chain } from 'viem'

import type { EvmChainConfig, ResolvedEvmChainConfig } from './types.js'

function viemChain(config: EvmChainConfig, rpcUrl: string): Chain {
  return {
    id: config.chainId,
    name: config.name ?? config.id,
    nativeCurrency: {
      name: config.nativeAsset.denomination,
      symbol: config.nativeAsset.denomination,
      decimals: config.nativeAsset.decimals,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  }
}

export function resolveEvmChainConfig(config: EvmChainConfig): ResolvedEvmChainConfig {
  if (config.publicClient) return config as ResolvedEvmChainConfig
  if (!config.rpcUrl) throw new Error(`Chain ${config.id} requires rpcUrl or publicClient`)
  return {
    ...config,
    publicClient: createPublicClient({
      chain: viemChain(config, config.rpcUrl),
      transport: http(config.rpcUrl),
    }),
  }
}

export function resolveEvmChainConfigs(configs: EvmChainConfig[]): ResolvedEvmChainConfig[] {
  return configs.map(resolveEvmChainConfig)
}
