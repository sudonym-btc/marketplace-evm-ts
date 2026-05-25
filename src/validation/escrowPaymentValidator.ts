import type { Log } from 'viem'
import { getAddress, parseEventLogs } from 'viem'
import { multiEscrowAbi } from '@sudonym-btc/marketplace-contracts'

import type { EvmChainConfig } from '../types.js'
import { normalizeAddress, normalizeBytes32 } from '../utils/hex.js'
import { sha256Hex } from '../utils/sha256.js'
import type {
  EvmEscrowFundingLog,
  EvmEscrowPaymentValidationRequest,
  EvmEscrowPaymentValidationResult,
  EvmEscrowPaymentValidator,
} from './types.js'

export type EvmEscrowPaymentValidatorOptions = {
  chains: EvmChainConfig[]
}

function mismatch(
  request: EvmEscrowPaymentValidationRequest,
  error: string,
  funding?: EvmEscrowFundingLog,
): EvmEscrowPaymentValidationResult {
  return {
    method: 'evm',
    status: 'invalid',
    txHash: request.txHash,
    chainId: request.chainId,
    ...(funding ? { funding } : {}),
    error,
  }
}

function notFound(request: EvmEscrowPaymentValidationRequest, error: string): EvmEscrowPaymentValidationResult {
  return { method: 'evm', status: 'pending', txHash: request.txHash, chainId: request.chainId, error }
}

function asFundingLog(
  request: EvmEscrowPaymentValidationRequest,
  log: Log,
  args: Record<string, unknown>,
): EvmEscrowFundingLog {
  return {
    chainId: request.chainId,
    txHash: request.txHash,
    contractAddress: normalizeAddress(log.address, 'TradeCreated contract address'),
    tradeId: normalizeBytes32(args.tradeId as string, 'TradeCreated tradeId'),
    buyerAddress: normalizeAddress(args.buyer as string, 'TradeCreated buyer'),
    sellerAddress: normalizeAddress(args.seller as string, 'TradeCreated seller'),
    arbiterAddress: normalizeAddress(args.arbiter as string, 'TradeCreated arbiter'),
    tokenAddress: normalizeAddress(args.token as string, 'TradeCreated token'),
    paymentAmount: args.paymentAmount as bigint,
    bondAmount: args.bondAmount as bigint,
    unlockAt: args.unlockAt as bigint,
    escrowFee: args.escrowFee as bigint,
    ...(log.blockNumber !== null ? { blockNumber: log.blockNumber } : {}),
    ...(log.logIndex !== null ? { logIndex: log.logIndex } : {}),
  }
}

function decodeTradeCreated(request: EvmEscrowPaymentValidationRequest, logs: Log[]): EvmEscrowFundingLog | null {
  const parsed = parseEventLogs({
    abi: multiEscrowAbi,
    eventName: 'TradeCreated',
    logs,
  })
  const expectedContract = request.contractAddress.toLowerCase()
  const expectedTradeId = normalizeBytes32(request.tradeId, 'tradeId')
  for (const log of parsed) {
    if (log.address.toLowerCase() !== expectedContract) continue
    if (normalizeBytes32(log.args.tradeId, 'TradeCreated tradeId') !== expectedTradeId) continue
    return asFundingLog(request, log, log.args)
  }
  return null
}

export function createEvmEscrowPaymentValidator(
  options: EvmEscrowPaymentValidatorOptions,
): EvmEscrowPaymentValidator {
  const chains = new Map(options.chains.map(chain => [chain.chainId, chain]))

  return {
    async validatePayment(request) {
      const chain = chains.get(request.chainId)
      if (!chain) {
        return {
          method: 'evm',
          status: 'unverifiable',
          txHash: request.txHash,
          chainId: request.chainId,
          error: `No EVM chain configured for chainId ${request.chainId}`,
        }
      }

      const receipt = await chain.publicClient.getTransactionReceipt({ hash: request.txHash })
      if (!receipt) return notFound(request, 'Transaction receipt not found')
      if (receipt.status !== 'success') return mismatch(request, 'Transaction reverted')

      if (request.contractBytecodeHash) {
        const bytecode = await chain.publicClient.getBytecode({ address: request.contractAddress })
        if (!bytecode) return mismatch(request, 'Escrow contract has no runtime bytecode')
        const bytecodeHash = await sha256Hex(bytecode)
        if (bytecodeHash.toLowerCase() !== request.contractBytecodeHash.toLowerCase()) {
          return mismatch(request, 'Escrow contract bytecode hash mismatch')
        }
      }

      const funding = decodeTradeCreated(request, receipt.logs)
      if (!funding) return mismatch(request, 'Matching TradeCreated log not found')

      const assetMatched = funding.tokenAddress.toLowerCase() === request.tokenAddress.toLowerCase()
      const recipientMatched = funding.sellerAddress.toLowerCase() === request.sellerAddress.toLowerCase()
      const escrowMatched = funding.arbiterAddress.toLowerCase() === request.arbiterAddress.toLowerCase()
      const amountMatched =
        funding.paymentAmount >= request.paymentAmount.value &&
        funding.bondAmount >= (request.bondAmount?.value ?? 0n) &&
        funding.escrowFee >= (request.escrowFee?.value ?? 0n)

      if (!assetMatched) return mismatch(request, 'Escrow token mismatch', funding)
      if (!recipientMatched) return mismatch(request, 'Escrow seller address mismatch', funding)
      if (!escrowMatched) return mismatch(request, 'Escrow arbiter address mismatch', funding)
      if (!amountMatched) return mismatch(request, 'Escrow amount mismatch', funding)

      let confirmations: number | undefined
      if (receipt.blockNumber !== null && request.minConfirmations && request.minConfirmations > 0) {
        const blockNumber = await chain.publicClient.getBlockNumber()
        confirmations = Number(blockNumber - receipt.blockNumber + 1n)
        if (confirmations < request.minConfirmations) {
          return {
            method: 'evm',
            status: 'pending',
            txHash: request.txHash,
            chainId: request.chainId,
            confirmations,
            amountMatched,
            assetMatched,
            recipientMatched,
            escrowMatched,
            funding,
            error: `Waiting for ${request.minConfirmations} confirmations`,
          }
        }
      }

      return {
        method: 'evm',
        status: 'valid',
        txHash: request.txHash,
        chainId: request.chainId,
        ...(confirmations !== undefined ? { confirmations } : {}),
        amountMatched,
        assetMatched,
        recipientMatched,
        escrowMatched,
        funding,
      }
    },
  }
}
