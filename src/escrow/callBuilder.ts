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
  EvmRecycleParams,
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
      const contextHash = params.contextHash ?? `0x${'0'.repeat(64)}` as const
      const recycleCovenantHash = params.recycleCovenantHash ?? `0x${'0'.repeat(64)}` as const
      const totalNativeValue = params.assetAddress.toLowerCase() === zeroAddress ? params.paymentAmount.value + bondAmount : 0n
      const createTradeCall = named('MultiEscrow.createTradeWithTerms', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'createTradeWithTerms',
          args: [
            normalizeBytes32(params.tradeId, 'tradeId'),
            params.buyerAddress,
            params.sellerAddress,
            params.arbiterAddress,
            params.assetAddress,
            params.paymentAmount.value,
            bondAmount,
            params.unlockAt,
            params.timeoutClaimantAddress ?? params.sellerAddress,
            escrowFee,
            contextHash,
            recycleCovenantHash,
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

    recycle(params: EvmRecycleParams): NamedEvmCall {
      const bondAmount = params.bondAmount?.value ?? 0n
      const escrowFee = params.escrowFee?.value ?? 0n
      const contextHash = params.contextHash ?? `0x${'0'.repeat(64)}` as const
      const recycleCovenantHash = params.recycleCovenantHash ?? `0x${'0'.repeat(64)}` as const
      return named('MultiEscrow.recycle', {
        to: params.contractAddress,
        data: encodeFunctionData({
          abi: multiEscrowAbi,
          functionName: 'recycle',
          args: [
            normalizeBytes32(params.sourceTradeId, 'sourceTradeId'),
            normalizeBytes32(params.targetTradeId, 'targetTradeId'),
            params.buyerAddress,
            params.sellerAddress,
            params.arbiterAddress,
            params.assetAddress,
            params.paymentAmount.value,
            bondAmount,
            params.unlockAt,
            params.timeoutClaimantAddress,
            escrowFee,
            contextHash,
            recycleCovenantHash,
            params.deadline ?? 0n,
            params.buyerSignature ?? '0x',
            params.arbiterSignature,
          ],
        }),
      })
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
