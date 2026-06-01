import { encodeFunctionData } from 'viem'
import { multiAuctionAbi } from '@sudonym-btc/marketplace-evm-contracts'

import { erc20Abi } from '../contracts/erc20.js'
import type { NamedEvmCall } from '../types.js'
import { normalizeBytes32, zeroAddress } from '../utils/hex.js'
import type {
  EvmAuctionCallBuilder,
  EvmAuctionWithdrawParams,
  EvmPlaceBidParams,
  EvmSignedAuctionAction,
} from './types.js'

function named(name: string, call: Omit<NamedEvmCall, 'name'>): NamedEvmCall {
  return { name, ...call }
}

export function createEvmAuctionCallBuilder(): EvmAuctionCallBuilder {
  return {
    placeBid(params: EvmPlaceBidParams): NamedEvmCall[] {
      const escrowFee = params.escrowFee?.value ?? 0n
      const nativeValue = params.assetAddress.toLowerCase() === zeroAddress ? params.bidAmount.value : 0n
      const placeBidCall = named('MultiAuction.placeBid', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiAuctionAbi,
          functionName: 'placeBid',
          args: [
            normalizeBytes32(params.auctionId, 'auctionId'),
            params.bidderAddress,
            params.sellerAddress,
            params.arbiterAddress,
            params.assetAddress,
            params.bidAmount.value,
            params.endsAt,
            escrowFee,
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
            args: [params.contractAddress, params.bidAmount.value],
          }),
        }),
        placeBidCall,
      ]
    },

    settle(params: EvmSignedAuctionAction): NamedEvmCall {
      return named('MultiAuction.settle', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiAuctionAbi,
          functionName: 'settle',
          args: [normalizeBytes32(params.auctionId, 'auctionId'), params.signature],
        }),
      })
    },

    cancel(params: EvmSignedAuctionAction): NamedEvmCall {
      return named('MultiAuction.cancel', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiAuctionAbi,
          functionName: 'cancel',
          args: [normalizeBytes32(params.auctionId, 'auctionId'), params.signature],
        }),
      })
    },

    withdraw(params: EvmAuctionWithdrawParams): NamedEvmCall {
      return named('MultiAuction.withdraw', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiAuctionAbi,
          functionName: 'withdraw',
          args: [params.assetAddress, params.beneficiaryAddress, params.destinationAddress, params.signature],
        }),
      })
    },
  }
}
