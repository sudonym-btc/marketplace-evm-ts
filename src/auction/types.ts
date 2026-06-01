import type { EvmAddress, EvmAmount, EvmHash, EvmHex, NamedEvmCall } from '../types.js'

export type EvmPlaceBidParams = {
  auctionId: string
  bidderAddress: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  bidAmount: EvmAmount
  escrowFee?: EvmAmount
  endsAt: bigint
  contractAddress: EvmAddress
}

export type EvmSignedAuctionAction = {
  auctionId: string
  contractAddress: EvmAddress
  signature: EvmHex
}

export type EvmAuctionWithdrawParams = {
  contractAddress: EvmAddress
  assetAddress: EvmAddress
  beneficiaryAddress: EvmAddress
  destinationAddress: EvmAddress
  signature: EvmHex
}

export type EvmAuctionCallBuilder = {
  placeBid(params: EvmPlaceBidParams): NamedEvmCall[]
  settle(params: EvmSignedAuctionAction): NamedEvmCall
  cancel(params: EvmSignedAuctionAction): NamedEvmCall
  withdraw(params: EvmAuctionWithdrawParams): NamedEvmCall
}

export type EvmAuctionBidValidationRequest = {
  chainId: number
  txHash: EvmHash
  auctionId: string
  contractAddress: EvmAddress
  contractBytecodeHash?: EvmHex
  bidderAddress?: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  bidAmount: EvmAmount
  escrowFee?: EvmAmount
  minConfirmations?: number
}

export type EvmAuctionBidLog = {
  chainId: number
  txHash: EvmHash
  contractAddress: EvmAddress
  auctionId: EvmHex
  bidderAddress: EvmAddress
  assetAddress: EvmAddress
  bidAmount: bigint
  previousBidder: EvmAddress
  previousBid: bigint
  blockNumber?: bigint
  logIndex?: number
}

export type EvmAuctionPaymentValidationResult = {
  method: 'evm'
  status: 'valid' | 'invalid' | 'pending' | 'expired' | 'unverifiable'
  txHash: EvmHash
  chainId: number
  confirmations?: number
  amountMatched?: boolean
  assetMatched?: boolean
  recipientMatched?: boolean
  escrowMatched?: boolean
  bid?: EvmAuctionBidLog
  error?: string
}

export type EvmAuctionPaymentValidator = {
  validate(request: EvmAuctionBidValidationRequest): Promise<EvmAuctionPaymentValidationResult>
}
