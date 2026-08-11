import type { Log } from 'viem'
import { getAddress, parseEventLogs } from 'viem'
import { multiEscrowAbi } from '@sudonym-btc/marketplace-evm-contracts'
import { multiEscrowRuntimeBytecodeHash } from '@sudonym-btc/marketplace-evm-contracts'

import type { ResolvedEvmChainConfig } from '../types.js'
import { normalizeAddress, normalizeBytes32 } from '../utils/hex.js'
import { sha256Hex } from '../utils/sha256.js'
import type {
  EvmEscrowFundingLog,
  EvmEscrowPaymentValidationRequest,
  EvmEscrowPaymentValidationResult,
  EvmEscrowPaymentValidator,
} from './types.js'

export type EvmEscrowPaymentValidatorOptions = {
  chains: ResolvedEvmChainConfig[]
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
    assetAddress: normalizeAddress(args.token as string, 'TradeCreated asset'),
    paymentAmount: args.paymentAmount as bigint,
    bondAmount: args.bondAmount as bigint,
    unlockAt: args.unlockAt as bigint,
    timeoutClaimantAddress: normalizeAddress(args.timeoutClaimant as string, 'TradeCreated timeout claimant'),
    escrowFee: args.escrowFee as bigint,
    contextHash: normalizeBytes32(args.contextHash as string, 'TradeCreated context hash'),
    recycleCovenantHash: normalizeBytes32(args.recycleCovenantHash as string, 'TradeCreated recycle covenant hash'),
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

export function createEvmEscrowValidator(
  options: EvmEscrowPaymentValidatorOptions,
): EvmEscrowPaymentValidator {
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

      const expectedContract = chain.multiEscrowAddress
      if (!expectedContract) {
        return {
          method: 'evm',
          status: 'unverifiable',
          txHash: request.txHash,
          chainId: request.chainId,
          error: `No trusted MultiEscrow address configured for chainId ${request.chainId}`,
        }
      }
      const expectedBytecodeHash = chain.multiEscrowBytecodeHash ?? multiEscrowRuntimeBytecodeHash
      if (request.contractAddress.toLowerCase() !== expectedContract.toLowerCase()) {
        return mismatch(request, 'Escrow contract address does not match the configured deployment')
      }
      if (
        request.contractBytecodeHash
        && request.contractBytecodeHash.toLowerCase() !== expectedBytecodeHash.toLowerCase()
      ) {
        return mismatch(request, 'Payment proof escrow bytecode hash does not match configured runtime')
      }

      const receipt = await chain.publicClient.getTransactionReceipt({ hash: request.txHash })
      if (!receipt) return notFound(request, 'Transaction receipt not found')
      if (receipt.status !== 'success') return mismatch(request, 'Transaction reverted')

      const bytecode = await chain.publicClient.getBytecode({ address: expectedContract })
      if (!bytecode || bytecode === '0x') return mismatch(request, 'Configured escrow contract has no runtime bytecode')
      const bytecodeHash = await sha256Hex(bytecode)
      if (bytecodeHash.toLowerCase() !== expectedBytecodeHash.toLowerCase()) {
        return mismatch(request, 'Configured escrow contract runtime bytecode hash mismatch')
      }

      const funding = decodeTradeCreated(request, receipt.logs)
      if (!funding) return mismatch(request, 'Matching TradeCreated log not found')

      const assetMatched = funding.assetAddress.toLowerCase() === request.assetAddress.toLowerCase()
      const buyerMatched = funding.buyerAddress.toLowerCase() === request.buyerAddress.toLowerCase()
      const recipientMatched = funding.sellerAddress.toLowerCase() === request.sellerAddress.toLowerCase()
      const arbiterMatched = funding.arbiterAddress.toLowerCase() === request.arbiterAddress.toLowerCase()
      const timeoutClaimantMatched =
        funding.timeoutClaimantAddress.toLowerCase() === request.timeoutClaimantAddress.toLowerCase()
      const unlockAtMatched = funding.unlockAt === request.unlockAt
      const contextMatched = funding.contextHash.toLowerCase() === request.contextHash.toLowerCase()
      const recycleCovenantMatched =
        funding.recycleCovenantHash.toLowerCase() === request.recycleCovenantHash.toLowerCase()
      const expectedEscrowFee = request.escrowFee?.value ?? 0n
      const amountMatched =
        funding.paymentAmount === request.paymentAmount.value + expectedEscrowFee &&
        funding.bondAmount === (request.bondAmount?.value ?? 0n) &&
        funding.escrowFee === expectedEscrowFee

      if (!assetMatched) return mismatch(request, 'Escrow asset mismatch', funding)
      if (!buyerMatched) return mismatch(request, 'Escrow buyer address mismatch', funding)
      if (!recipientMatched) return mismatch(request, 'Escrow seller address mismatch', funding)
      if (!arbiterMatched) return mismatch(request, 'Arbiter address mismatch', funding)
      if (!timeoutClaimantMatched) return mismatch(request, 'Escrow timeout claimant mismatch', funding)
      if (!unlockAtMatched) return mismatch(request, 'Escrow unlock time mismatch', funding)
      if (!contextMatched) return mismatch(request, 'Escrow context hash mismatch', funding)
      if (!recycleCovenantMatched) return mismatch(request, 'Escrow recycle covenant hash mismatch', funding)
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
            arbiterMatched,
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
        amount: request.paymentAmount,
        amountMatched,
        assetMatched,
        recipientMatched,
        arbiterMatched,
        funding,
      }
    },
  }
}
