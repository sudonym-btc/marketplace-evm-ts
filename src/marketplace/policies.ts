import { multiAuctionRuntimeBytecodeHash, multiEscrowRuntimeBytecodeHash } from '../contracts/index.js'
import type { EvmHex } from '../types.js'
import type { EvmAuctionPaymentPolicy, EvmEscrowPaymentPolicy, EvmMarketplaceChainConfig } from './types.js'

export function evmEscrowContractBytecodeHash(
  chains: EvmMarketplaceChainConfig[],
  chainId?: number,
): EvmHex {
  const chain = chainId === undefined ? chains[0] : chains.find(candidate => candidate.chainId === chainId)
  if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${chainId}`)
  return chain.multiEscrowBytecodeHash ?? multiEscrowRuntimeBytecodeHash
}

export function evmAuctionContractBytecodeHash(
  chains: EvmMarketplaceChainConfig[],
  chainId?: number,
): EvmHex {
  const chain = chainId === undefined ? chains[0] : chains.find(candidate => candidate.chainId === chainId)
  if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${chainId}`)
  return chain.multiAuctionBytecodeHash ?? multiAuctionRuntimeBytecodeHash
}

export function evmEscrowPolicies(chains: EvmMarketplaceChainConfig[]): EvmEscrowPaymentPolicy[] {
  return chains.map(chain => ({
    method: 'evm',
    id: `evm:${chain.chainId}:${chain.multiEscrowAddress.toLowerCase()}`,
    type: 'evm:multi-escrow',
    hash: evmEscrowContractBytecodeHash(chains, chain.chainId),
    chainId: chain.chainId,
    contractAddress: chain.multiEscrowAddress,
  }))
}

export function evmAuctionPolicies(chains: EvmMarketplaceChainConfig[]): EvmAuctionPaymentPolicy[] {
  return chains
    .filter(chain => Boolean(chain.multiAuctionAddress))
    .map(chain => ({
      method: 'evm',
      id: `evm:${chain.chainId}:${chain.multiAuctionAddress!.toLowerCase()}`,
      type: 'evm:multi-auction',
      hash: evmAuctionContractBytecodeHash(chains, chain.chainId),
      chainId: chain.chainId,
      contractAddress: chain.multiAuctionAddress!,
    }))
}
