import { encodeAbiParameters, keccak256, toHex } from 'viem'

import { createEvmEscrowValidator } from '../validation/escrowPaymentValidator.js'
import type { EvmAddress, EvmAmount, EvmHash, EvmHex } from '../types.js'
import type {
  GenericAmount,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

const recycleCovenantTypeHash = keccak256(toHex('RecycleCovenant(address buyer,address seller,address arbiter,address token,uint256 paymentAmount,uint256 bondAmount,address timeoutClaimant,uint256 escrowFee,bytes32 contextHash)'))

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid ${label}`)
  return value
}

function address(value: unknown, label: string): EvmAddress {
  const raw = stringValue(value, label)
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) throw new Error(`Invalid ${label}`)
  return raw as EvmAddress
}

function hash(value: unknown, label: string): EvmHex {
  const raw = stringValue(value, label)
  const normalized = raw.startsWith('0x') || raw.startsWith('0X') ? raw : `0x${raw}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error(`Invalid ${label}`)
  return normalized as EvmHex
}

function txHash(value: unknown): EvmHash {
  const raw = stringValue(value, 'txHash')
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) throw new Error('Invalid txHash')
  return raw as EvmHash
}

function amount(
  preferred: GenericAmount | undefined,
  params: Record<string, unknown>,
  valueKey: string,
  label: string,
): EvmAmount {
  const value = preferred?.value ?? stringValue(params[valueKey], label)
  const denomination = preferred?.denomination ?? optionalString(params.denomination) ?? ''
  const decimals = preferred?.decimals ?? numberValue(params.decimals, 'decimals')
  return {
    value: BigInt(value),
    denomination,
    decimals,
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value as Record<string, unknown>
}

function bigintString(value: unknown, label: string): bigint {
  const raw = stringValue(value, label)
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${label}`)
  return BigInt(raw)
}

function sameAddress(left: EvmAddress, right: EvmAddress): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function recycleCovenantHash(input: {
  buyerAddress: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  paymentAmount: bigint
  bondAmount: bigint
  timeoutClaimantAddress: EvmAddress
  escrowFee: bigint
  contextHash: EvmHex
}): EvmHex {
  return keccak256(encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'address' },
      { type: 'address' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'bytes32' },
    ],
    [
      recycleCovenantTypeHash,
      input.buyerAddress,
      input.sellerAddress,
      input.arbiterAddress,
      input.assetAddress,
      input.paymentAmount,
      input.bondAmount,
      input.timeoutClaimantAddress,
      input.escrowFee,
      input.contextHash,
    ],
  ))
}

function validateBidRecycleArgs(params: Record<string, unknown>): string | undefined {
  if (params.subject !== 'bid') return undefined
  let target: Record<string, unknown>
  try {
    const args = objectValue(params.recycleArgs, 'recycleArgs')
    if (args.version !== 1 || args.type !== 'evm:multi-escrow-recycle-v1') return 'Invalid EVM recycleArgs type'
    target = objectValue(args.target, 'recycleArgs.target')
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid EVM recycleArgs'
  }

  try {
    const buyerAddress = address(params.buyerAddress, 'buyerAddress')
    const sellerAddress = address(params.sellerAddress, 'sellerAddress')
    const arbiterAddress = address(params.arbiterAddress, 'arbiterAddress')
    const assetAddress = address(params.assetAddress, 'assetAddress')
    const targetBuyer = address(target.buyerAddress, 'recycleArgs.target.buyerAddress')
    const targetSeller = address(target.sellerAddress, 'recycleArgs.target.sellerAddress')
    const targetArbiter = address(target.arbiterAddress, 'recycleArgs.target.arbiterAddress')
    const targetAsset = address(target.assetAddress, 'recycleArgs.target.assetAddress')
    const targetTimeoutClaimant = address(target.timeoutClaimantAddress, 'recycleArgs.target.timeoutClaimantAddress')
    const contextHash = hash(target.contextHash, 'recycleArgs.target.contextHash')
    const targetCovenantHash = hash(target.covenantHash, 'recycleArgs.target.covenantHash')

    if (!sameAddress(targetBuyer, buyerAddress)) return 'EVM recycleArgs buyer does not match payment proof'
    if (!sameAddress(targetSeller, sellerAddress)) return 'EVM recycleArgs seller does not match payment proof'
    if (!sameAddress(targetArbiter, arbiterAddress)) return 'EVM recycleArgs arbiter does not match payment proof'
    if (!sameAddress(targetAsset, assetAddress)) return 'EVM recycleArgs asset does not match payment proof'
    if (!sameAddress(targetTimeoutClaimant, sellerAddress)) return 'EVM recycleArgs timeout claimant must be seller for promoted order'
    if (contextHash.toLowerCase() !== hash(params.contextHash, 'contextHash').toLowerCase()) {
      return 'EVM recycleArgs context hash does not match payment proof'
    }
    if (targetCovenantHash.toLowerCase() !== hash(params.recycleCovenantHash, 'recycleCovenantHash').toLowerCase()) {
      return 'EVM recycleArgs covenant hash does not match payment proof'
    }

    const paymentAmount = bigintString(target.paymentAmount, 'recycleArgs.target.paymentAmount')
    const bondAmount = bigintString(target.bondAmount, 'recycleArgs.target.bondAmount')
    const escrowFee = bigintString(target.escrowFee, 'recycleArgs.target.escrowFee')
    const expectedPaymentAmount = params.fundedValue
      ? bigintString(params.fundedValue, 'fundedValue')
      : bigintString(params.value, 'value') + bigintString(params.escrowFee ?? '0', 'escrowFee')
    if (paymentAmount !== expectedPaymentAmount) return 'EVM recycleArgs payment amount does not match funded auction payment'
    if (escrowFee !== bigintString(params.escrowFee ?? '0', 'escrowFee')) return 'EVM recycleArgs escrow fee does not match payment proof'

    const computed = recycleCovenantHash({
      buyerAddress: targetBuyer,
      sellerAddress: targetSeller,
      arbiterAddress: targetArbiter,
      assetAddress: targetAsset,
      paymentAmount,
      bondAmount,
      timeoutClaimantAddress: targetTimeoutClaimant,
      escrowFee,
      contextHash,
    })
    if (computed.toLowerCase() !== targetCovenantHash.toLowerCase()) {
      return 'EVM recycleArgs do not derive the payment recycle covenant hash'
    }
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid EVM recycleArgs'
  }
}

export async function validateEvmMarketplacePayment(
  chains: ResolvedEvmMarketplaceChainConfig[],
  request: GenericPaymentValidationRequest,
): Promise<GenericPaymentValidationResult> {
  if (request.method !== 'evm' || request.proof.method !== 'evm') {
    return {
      method: 'evm',
      status: 'unverifiable',
      error: `EVM validator cannot validate ${request.method}`,
    }
  }

  try {
    const params = request.proof.params
    const recycleArgsError = validateBidRecycleArgs(params)
    if (recycleArgsError) {
      return { method: 'evm', status: 'invalid', error: recycleArgsError }
    }
    const expected = request.expected
    const validator = createEvmEscrowValidator({ chains })
    const result = await validator.validate({
      chainId: expected.contract?.chainId ?? numberValue(params.chainId, 'chainId'),
      txHash: txHash(params.txHash),
      tradeId: expected.settlementId,
      contractAddress: address(expected.contract?.address ?? params.contractAddress, 'contractAddress'),
      ...(expected.contract?.bytecodeHash ?? params.contractBytecodeHash
        ? { contractBytecodeHash: hash(expected.contract?.bytecodeHash ?? params.contractBytecodeHash, 'contractBytecodeHash') }
        : {}),
      sellerAddress: address(expected.participants?.seller?.address ?? params.sellerAddress, 'sellerAddress'),
      arbiterAddress: address(expected.participants?.escrow?.address ?? params.arbiterAddress, 'arbiterAddress'),
      assetAddress: address(params.assetAddress, 'assetAddress'),
      paymentAmount: amount(expected.amount, params, 'value', 'payment amount'),
      ...(params.timeoutClaimantAddress
        ? { timeoutClaimantAddress: address(params.timeoutClaimantAddress, 'timeoutClaimantAddress') }
        : {}),
      ...(expected.fee || params.escrowFee
        ? { escrowFee: amount(expected.fee, params, 'escrowFee', 'escrow fee') }
        : {}),
      ...(params.contextHash ? { contextHash: hash(params.contextHash, 'contextHash') } : {}),
      ...(params.recycleCovenantHash
        ? { recycleCovenantHash: hash(params.recycleCovenantHash, 'recycleCovenantHash') }
        : {}),
      minConfirmations: 1,
    })
    return {
      method: 'evm',
      status: result.status,
      ...(result.confirmations !== undefined ? { confirmations: result.confirmations } : {}),
      ...(result.amountMatched !== undefined ? { amountMatched: result.amountMatched } : {}),
      ...(result.assetMatched !== undefined ? { assetMatched: result.assetMatched } : {}),
      ...(result.recipientMatched !== undefined ? { recipientMatched: result.recipientMatched } : {}),
      ...(result.escrowMatched !== undefined ? { escrowMatched: result.escrowMatched } : {}),
      ...(result.funding
        ? {
            data: {
              txHash: result.funding.txHash,
              chainId: result.funding.chainId,
              settlementId: result.funding.tradeId,
              buyerAddress: result.funding.buyerAddress,
              sellerAddress: result.funding.sellerAddress,
              arbiterAddress: result.funding.arbiterAddress,
              assetAddress: result.funding.assetAddress,
              timeoutClaimantAddress: result.funding.timeoutClaimantAddress,
              contextHash: result.funding.contextHash,
              recycleCovenantHash: result.funding.recycleCovenantHash,
            },
          }
        : {}),
      ...(result.error ? { error: result.error } : {}),
    }
  } catch (error) {
    return {
      method: 'evm',
      status: 'unverifiable',
      error: error instanceof Error ? error.message : 'Unable to validate EVM payment',
    }
  }
}
