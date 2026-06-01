import { encodeFunctionData } from 'viem'
import { multiEscrowAbi } from '@sudonym-btc/marketplace-evm-contracts'

import { erc20Abi } from '../contracts/erc20.js'
import type { NamedEvmCall } from '../types.js'
import { normalizeBytes32, zeroAddress } from '../utils/hex.js'
import type {
  EvmArbitrateParams,
  EvmCreateTradeParams,
  EvmEscrowCallBuilder,
  EvmReleaseParams,
  EvmSignedEscrowAction,
  EvmWithdrawParams,
} from './types.js'

function named(name: string, call: Omit<NamedEvmCall, 'name'>): NamedEvmCall {
  return { name, ...call }
}

export function createEvmEscrowCallBuilder(): EvmEscrowCallBuilder {
  return {
    createTrade(params: EvmCreateTradeParams): NamedEvmCall[] {
      const bondAmount = params.bondAmount?.value ?? 0n
      const escrowFee = params.escrowFee?.value ?? 0n
      const totalNativeValue = params.assetAddress.toLowerCase() === zeroAddress ? params.paymentAmount.value + bondAmount : 0n
      const createTradeCall = named('MultiEscrow.createTrade', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'createTrade',
          args: [
            normalizeBytes32(params.tradeId, 'tradeId'),
            params.buyerAddress,
            params.sellerAddress,
            params.arbiterAddress,
            params.assetAddress,
            params.paymentAmount.value,
            bondAmount,
            params.unlockAt,
            escrowFee,
          ],
        }),
        ...(totalNativeValue > 0n ? { value: totalNativeValue } : {}),
      })

      if (params.assetAddress.toLowerCase() === zeroAddress) return [createTradeCall]
      return [
        named('ERC20.approve', {
          to: params.assetAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [params.contractAddress, params.paymentAmount.value + bondAmount],
          }),
        }),
        createTradeCall,
      ]
    },

    claim(params: EvmSignedEscrowAction): NamedEvmCall {
      return named('MultiEscrow.claim', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'claim',
          args: [normalizeBytes32(params.tradeId, 'tradeId'), params.signature],
        }),
      })
    },

    release(params: EvmReleaseParams): NamedEvmCall {
      return named('MultiEscrow.releaseToCounterparty', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'releaseToCounterparty',
          args: [normalizeBytes32(params.tradeId, 'tradeId'), params.actorAddress, params.signature],
        }),
      })
    },

    arbitrate(params: EvmArbitrateParams): NamedEvmCall {
      return named('MultiEscrow.arbitrate', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'arbitrate',
          args: [
            normalizeBytes32(params.tradeId, 'tradeId'),
            params.paymentFactor,
            params.bondFactor,
            params.signature,
          ],
        }),
      })
    },

    withdraw(params: EvmWithdrawParams): NamedEvmCall {
      return named('MultiEscrow.withdraw', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'withdraw',
          args: [params.assetAddress, params.beneficiaryAddress, params.destinationAddress, params.signature],
        }),
      })
    },
  }
}
