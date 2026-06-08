import type { EvmAddress, EvmAmount, EvmCall, EvmHex, NamedEvmCall } from '../types.js'
import type {
  EvmEscrowPaymentValidationRequest,
  EvmEscrowPaymentValidationResult,
} from '../validation/types.js'

export type EvmEscrowFeePolicy = {
  ppm: number
  base: bigint
  min: bigint
  max: bigint
}

export type EvmEscrowServiceConfig = {
  chainId: number
  contractAddress: EvmAddress
  contractBytecodeHash?: EvmHex
  arbiterAddress: EvmAddress
  fee: EvmEscrowFeePolicy
}

export type EvmCreateTradeParams = {
  tradeId: string
  buyerAddress: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  paymentAmount: EvmAmount
  bondAmount?: EvmAmount
  unlockAt: bigint
  timeoutClaimantAddress?: EvmAddress
  escrowFee?: EvmAmount
  contextHash?: EvmHex
  recycleCovenantHash?: EvmHex
  contractAddress: EvmAddress
}

export type EvmSignedEscrowAction = {
  tradeId: string
  contractAddress: EvmAddress
  signature: EvmHex
}

export type EvmReleaseParams = EvmSignedEscrowAction & {
  actorAddress: EvmAddress
}

export type EvmArbitrateParams = EvmSignedEscrowAction & {
  paymentFactor: bigint
  bondFactor: bigint
}

export type EvmWithdrawParams = {
  assetAddress: EvmAddress
  beneficiaryAddress: EvmAddress
  destinationAddress: EvmAddress
  contractAddress: EvmAddress
  signature: EvmHex
}

export type EvmRecycleParams = {
  sourceTradeId: string
  targetTradeId: string
  buyerAddress: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  paymentAmount: EvmAmount
  bondAmount?: EvmAmount
  unlockAt: bigint
  timeoutClaimantAddress: EvmAddress
  escrowFee?: EvmAmount
  contextHash?: EvmHex
  recycleCovenantHash?: EvmHex
  deadline?: bigint
  buyerSignature?: EvmHex
  arbiterSignature: EvmHex
  contractAddress: EvmAddress
}

export type EvmEscrowCallBuilder = {
  createTrade(params: EvmCreateTradeParams): NamedEvmCall[]
  recycle(params: EvmRecycleParams): NamedEvmCall
  claim(params: EvmSignedEscrowAction): NamedEvmCall
  release(params: EvmReleaseParams): NamedEvmCall
  arbitrate(params: EvmArbitrateParams): NamedEvmCall
  withdraw(params: EvmWithdrawParams): NamedEvmCall
}

export type EvmEscrowValidator = {
  validate(request: EvmEscrowPaymentValidationRequest): Promise<EvmEscrowPaymentValidationResult>
}

export type EvmEscrowClient = EvmEscrowCallBuilder & EvmEscrowValidator

export type EvmEscrowService = EvmEscrowClient & {
  execute(calls: NamedEvmCall[], chainId: number, operationId?: string): Promise<{ txHash: string }>
}

export type EvmEscrowActionPlan = {
  calls: NamedEvmCall[]
  value: bigint
}

export type Erc20Approval = EvmCall & {
  name: 'ERC20.approve'
}
