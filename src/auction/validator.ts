import type { Log } from 'viem'
import { parseEventLogs } from 'viem'
import { multiAuctionAbi } from '@sudonym-btc/marketplace-evm-contracts'

import type { ResolvedEvmChainConfig } from '../types.js'
import { normalizeAddress, normalizeBytes32 } from '../utils/hex.js'
import { sha256Hex } from '../utils/sha256.js'
import type {
  EvmAuctionBidLog,
  EvmAuctionBidValidationRequest,
  EvmAuctionPaymentValidationResult,
  EvmAuctionPaymentValidator,
} from './types.js'

export type EvmAuctionPaymentValidatorOptions = {
  chains: ResolvedEvmChainConfig[]
}

function mismatch(
  request: EvmAuctionBidValidationRequest,
  error: string,
  bid?: EvmAuctionBidLog,
): EvmAuctionPaymentValidationResult {
  return {
    method: 'evm',
    status: 'invalid',
    txHash: request.txHash,
    chainId: request.chainId,
    ...(bid ? { bid } : {}),
    error,
  }
}

function notFound(request: EvmAuctionBidValidationRequest, error: string): EvmAuctionPaymentValidationResult {
  return { method: 'evm', status: 'pending', txHash: request.txHash, chainId: request.chainId, error }
}

function asBidLog(
  request: EvmAuctionBidValidationRequest,
  log: Log,
  args: Record<string, unknown>,
): EvmAuctionBidLog {
  return {
    chainId: request.chainId,
    txHash: request.txHash,
    contractAddress: normalizeAddress(log.address, 'BidPlaced contract address'),
    auctionId: normalizeBytes32(args.auctionId as string, 'BidPlaced auctionId'),
    bidderAddress: normalizeAddress(args.bidder as string, 'BidPlaced bidder'),
    assetAddress: normalizeAddress(args.token as string, 'BidPlaced asset'),
    bidAmount: args.amount as bigint,
    previousBidder: normalizeAddress(args.previousBidder as string, 'BidPlaced previous bidder'),
    previousBid: args.previousBid as bigint,
    ...(log.blockNumber !== null ? { blockNumber: log.blockNumber } : {}),
    ...(log.logIndex !== null ? { logIndex: log.logIndex } : {}),
  }
}

function decodeBidPlaced(request: EvmAuctionBidValidationRequest, logs: Log[]): EvmAuctionBidLog | null {
  const parsed = parseEventLogs({
    abi: multiAuctionAbi,
    eventName: 'BidPlaced',
    logs,
  })
  const expectedContract = request.contractAddress.toLowerCase()
  const expectedAuctionId = normalizeBytes32(request.auctionId, 'auctionId')
  for (const log of parsed) {
    if (log.address.toLowerCase() !== expectedContract) continue
    if (normalizeBytes32(log.args.auctionId, 'BidPlaced auctionId') !== expectedAuctionId) continue
    return asBidLog(request, log, log.args)
  }
  return null
}

export function createEvmAuctionValidator(
  options: EvmAuctionPaymentValidatorOptions,
): EvmAuctionPaymentValidator {
  const chains = new Map(options.chains.map(chain => [chain.chainId, chain]))

  return {
    async validate(request) {
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
        if (!bytecode) return mismatch(request, 'Auction contract has no runtime bytecode')
        const bytecodeHash = await sha256Hex(bytecode)
        if (bytecodeHash.toLowerCase() !== request.contractBytecodeHash.toLowerCase()) {
          return mismatch(request, 'Auction contract bytecode hash mismatch')
        }
      }

      const bid = decodeBidPlaced(request, receipt.logs)
      if (!bid) return mismatch(request, 'Matching BidPlaced log not found')

      const amountMatched = bid.bidAmount >= request.bidAmount.value
      const assetMatched = bid.assetAddress.toLowerCase() === request.assetAddress.toLowerCase()
      const recipientMatched = request.bidderAddress
        ? bid.bidderAddress.toLowerCase() === request.bidderAddress.toLowerCase()
        : true
      const escrowMatched = true

      if (!amountMatched) return mismatch(request, 'Auction bid amount mismatch', bid)
      if (!assetMatched) return mismatch(request, 'Auction asset mismatch', bid)
      if (!recipientMatched) return mismatch(request, 'Auction bidder address mismatch', bid)

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
            bid,
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
        bid,
      }
    },
  }
}
