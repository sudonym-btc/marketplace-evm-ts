import { encodeFunctionData } from 'viem'
import { multiEscrowAbi } from '@sudonym-btc/marketplace-evm-contracts'

import { erc20Abi } from '../contracts/erc20.js'
import type { NamedEvmCall } from '../types.js'
import { normalizeBytes32, zeroAddress } from '../utils/hex.js'
import type { EvmAuctionCallBuilder, EvmPlaceBidParams } from './types.js'

function named(name: string, call: Omit<NamedEvmCall, 'name'>): NamedEvmCall {
  return { name, ...call }
}

export function createEvmAuctionCallBuilder(): EvmAuctionCallBuilder {
  return {
    placeBid(params: EvmPlaceBidParams): NamedEvmCall[] {
      const escrowFee = params.escrowFee?.value ?? 0n
      const fundedAmount = params.bidAmount.value + escrowFee
      const contextHash = params.contextHash ?? `0x${'0'.repeat(64)}` as const
      const recycleCovenantHash = params.recycleCovenantHash ?? `0x${'0'.repeat(64)}` as const
      const nativeValue = params.assetAddress.toLowerCase() === zeroAddress ? fundedAmount : 0n
      const placeBidCall = named('MultiEscrow.createAuctionBid', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'createTradeWithTerms',
          args: [
            normalizeBytes32(params.auctionId, 'auctionId'),
            params.bidderAddress,
            params.sellerAddress,
            params.arbiterAddress,
            params.assetAddress,
            fundedAmount,
            0n,
            params.endsAt,
            params.bidderAddress,
            escrowFee,
            contextHash,
            recycleCovenantHash,
          ],
        }),
        ...(nativeValue > 0n ? { value: nativeValue } : {}),
      })

      if (params.assetAddress.toLowerCase() === zeroAddress) return [placeBidCall]
      return [
        named('ERC20.approve', {
          to: params.assetAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [params.contractAddress, fundedAmount],
          }),
        }),
        placeBidCall,
      ]
    },
  }
}
