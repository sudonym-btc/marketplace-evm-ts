import type { EvmAddress, EvmAmount, EvmHash, EvmHex } from '../types.js'

export type EvmEscrowPaymentValidationStatus =
  | 'valid'
  | 'invalid'
  | 'pending'
  | 'expired'
  | 'unverifiable'

export type EvmEscrowPaymentValidationRequest = {
  chainId: number
  txHash: EvmHash
  tradeId: string
  contractAddress: EvmAddress
  contractBytecodeHash?: EvmHex
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  paymentAmount: EvmAmount
  bondAmount?: EvmAmount
  escrowFee?: EvmAmount
  minConfirmations?: number
}

export type EvmEscrowFundingLog = {
  chainId: number
  txHash: EvmHash
  contractAddress: EvmAddress
  tradeId: EvmHex
  buyerAddress: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  paymentAmount: bigint
  bondAmount: bigint
  unlockAt: bigint
  escrowFee: bigint
  blockNumber?: bigint
  logIndex?: number
}

export type EvmEscrowPaymentValidationResult = {
  method: 'evm'
  status: EvmEscrowPaymentValidationStatus
  txHash: EvmHash
  chainId: number
  confirmations?: number
  amountMatched?: boolean
  assetMatched?: boolean
  recipientMatched?: boolean
  escrowMatched?: boolean
  funding?: EvmEscrowFundingLog
  error?: string
}

export type EvmEscrowPaymentValidator = {
  validate(request: EvmEscrowPaymentValidationRequest): Promise<EvmEscrowPaymentValidationResult>
}
