import { zeroAddress } from '../utils/hex.js'
import { createEvmEscrowValidator } from '../validation/escrowPaymentValidator.js'
import type { EvmEscrowFundingLog } from '../validation/types.js'
import type {
  EvmAuctionBidLog,
  EvmAuctionBidValidationRequest,
  EvmAuctionPaymentValidationResult,
  EvmAuctionPaymentValidator,
} from './types.js'
import type { ResolvedEvmChainConfig } from '../types.js'

export type EvmAuctionPaymentValidatorOptions = {
  chains: ResolvedEvmChainConfig[]
}

function bidAmountFromFunding(funding: EvmEscrowFundingLog): bigint {
  return funding.paymentAmount >= funding.escrowFee
    ? funding.paymentAmount - funding.escrowFee
    : funding.paymentAmount
}

function fundingAsBidLog(request: EvmAuctionBidValidationRequest, funding: EvmEscrowFundingLog): EvmAuctionBidLog {
  return {
    chainId: request.chainId,
    txHash: request.txHash,
    contractAddress: funding.contractAddress,
    auctionId: funding.tradeId,
    bidderAddress: funding.buyerAddress,
    assetAddress: funding.assetAddress,
    bidAmount: bidAmountFromFunding(funding),
    fundedAmount: funding.paymentAmount,
    escrowFee: funding.escrowFee,
    timeoutClaimantAddress: funding.timeoutClaimantAddress,
    contextHash: funding.contextHash,
    recycleCovenantHash: funding.recycleCovenantHash,
    previousBidder: zeroAddress,
    previousBid: 0n,
    ...(funding.blockNumber !== undefined ? { blockNumber: funding.blockNumber } : {}),
    ...(funding.logIndex !== undefined ? { logIndex: funding.logIndex } : {}),
  }
}

export function createEvmAuctionValidator(
  options: EvmAuctionPaymentValidatorOptions,
): EvmAuctionPaymentValidator {
  const escrowValidator = createEvmEscrowValidator(options)

  return {
    async validate(request) {
      const escrowFee = request.escrowFee?.value ?? 0n
      const escrowResult = await escrowValidator.validate({
        chainId: request.chainId,
        txHash: request.txHash,
        tradeId: request.auctionId,
        contractAddress: request.contractAddress,
        ...(request.contractBytecodeHash ? { contractBytecodeHash: request.contractBytecodeHash } : {}),
        sellerAddress: request.sellerAddress,
        arbiterAddress: request.arbiterAddress,
        assetAddress: request.assetAddress,
        paymentAmount: {
          ...request.bidAmount,
          value: request.bidAmount.value + escrowFee,
        },
        ...(request.escrowFee ? { escrowFee: request.escrowFee } : {}),
        ...(request.bidderAddress ? { timeoutClaimantAddress: request.bidderAddress } : {}),
        ...(request.contextHash ? { contextHash: request.contextHash } : {}),
        ...(request.recycleCovenantHash ? { recycleCovenantHash: request.recycleCovenantHash } : {}),
        ...(request.minConfirmations !== undefined ? { minConfirmations: request.minConfirmations } : {}),
      })

      const bid = escrowResult.funding ? fundingAsBidLog(request, escrowResult.funding) : undefined
      const recipientMatched = request.bidderAddress && bid
        ? bid.bidderAddress.toLowerCase() === request.bidderAddress.toLowerCase()
        : escrowResult.recipientMatched

      const base: EvmAuctionPaymentValidationResult = {
        method: 'evm',
        status: escrowResult.status,
        txHash: escrowResult.txHash,
        chainId: escrowResult.chainId,
        ...(escrowResult.confirmations !== undefined ? { confirmations: escrowResult.confirmations } : {}),
        ...(escrowResult.status === 'valid' ? { amount: request.bidAmount } : {}),
        ...(escrowResult.amountMatched !== undefined ? { amountMatched: escrowResult.amountMatched } : {}),
        ...(escrowResult.assetMatched !== undefined ? { assetMatched: escrowResult.assetMatched } : {}),
        ...(recipientMatched !== undefined ? { recipientMatched } : {}),
        ...(escrowResult.arbiterMatched !== undefined ? { arbiterMatched: escrowResult.arbiterMatched } : {}),
        ...(bid ? { bid } : {}),
        ...(escrowResult.error ? { error: escrowResult.error } : {}),
      }

      if (base.status === 'valid' && recipientMatched === false) {
        return {
          ...base,
          status: 'invalid',
          error: 'Auction bidder address mismatch',
        }
      }
      return base
    },
  }
}
