import { createWalletClient, http } from 'viem'
import type { Chain, LocalAccount } from 'viem'

import type { EvmExecutor, NamedEvmCall, ResolvedEvmChainConfig } from '../types.js'

export type EoaExecutorOptions = {
  chain: ResolvedEvmChainConfig
  account: LocalAccount
}

export function createEoaExecutor(options: EoaExecutorOptions): EvmExecutor {
  const rpcUrl = resolveRpcUrl(options.chain)
  const chain = resolveChain(options.chain, rpcUrl)
  const walletClient = createWalletClient({
    account: options.account,
    chain,
    transport: http(rpcUrl),
  })

  return {
    async getAddress() {
      return options.account.address
    },
    async execute(calls: NamedEvmCall[], executionOptions) {
      let txHash
      for (const call of calls) {
        txHash = await walletClient.sendTransaction({
          account: options.account,
          to: call.to,
          data: call.data,
          value: call.value,
        })
        if (executionOptions.waitForReceipt !== false) {
          const receipt = await options.chain.publicClient.waitForTransactionReceipt({ hash: txHash })
          if (receipt.status !== 'success') throw new Error(`${call.name} reverted: ${txHash}`)
        }
      }
      if (!txHash) throw new Error('Cannot execute an empty EVM call batch')
      return {
        txHash,
        accountAddress: options.account.address,
        gasSponsored: false,
      }
    },
  }
}

function resolveRpcUrl(chain: ResolvedEvmChainConfig): string {
  const rpcUrl = chain.rpcUrl ?? chain.publicClient.chain?.rpcUrls.default.http[0]
  if (!rpcUrl) throw new Error(`Chain ${chain.id} needs rpcUrl for EOA execution`)
  return rpcUrl
}

function resolveChain(chainConfig: ResolvedEvmChainConfig, rpcUrl: string): Chain {
  if (chainConfig.publicClient.chain) return chainConfig.publicClient.chain
  return {
    id: chainConfig.chainId,
    name: chainConfig.name ?? chainConfig.id,
    nativeCurrency: {
      name: chainConfig.nativeAsset.denomination,
      symbol: chainConfig.nativeAsset.denomination,
      decimals: chainConfig.nativeAsset.decimals,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  }
}
