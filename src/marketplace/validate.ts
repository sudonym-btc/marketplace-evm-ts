import { encodeAbiParameters, keccak256, toHex } from 'viem'
import { resolveMarketplaceDriverPaymentProofParams } from '@sudonym-btc/marketplace-driver-interface'

import { createEvmEscrowValidator } from '../validation/escrowPaymentValidator.js'
import type { EvmAddress, EvmAmount, EvmHash, EvmHex } from '../types.js'
import type {
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

function amount(params: Record<string, unknown>, valueKey: string, label: string): EvmAmount {
  const value = stringValue(params[valueKey], label)
  const currency = optionalString(params.currency)
  const denomination = optionalString(params.denomination) ?? ''
  const decimals = numberValue(params.decimals, 'decimals')
  return {
    value: BigInt(value),
    ...(currency ? { currency } : {}),
    denomination,
    decimals,
  }
}

function optionalAmount(params: Record<string, unknown>, valueKey: string, label: string): EvmAmount | undefined {
  if (params[valueKey] === undefined || params[valueKey] === null) return undefined
  return amount(params, valueKey, label)
}

function paymentAmount(params: Record<string, unknown>): EvmAmount {
  return amount(params, params.paymentAmount !== undefined ? 'paymentAmount' : 'value', 'payment amount')
}

function marketplaceAmount(value: bigint, unit: Pick<EvmAmount, 'currency' | 'denomination' | 'decimals'>): {
  value: string
  currency?: string
  denomination: string
  decimals: number
} {
  return {
    value: value.toString(),
    ...(unit.currency ? { currency: unit.currency } : {}),
    denomination: unit.denomination,
    decimals: unit.decimals,
  }
}

function canonicalCurrency(value: string | undefined): string {
  const normalized = (value ?? '').toUpperCase()
  if (normalized === 'SAT' || normalized === 'SATS' || normalized === 'XBT') return 'BTC'
  if (normalized === 'USDT' || normalized === 'USDC') return 'USD'
  return normalized
}

function amountCurrency(amount: Pick<EvmAmount, 'currency' | 'denomination'>): string {
  return canonicalCurrency(amount.currency ?? amount.denomination)
}

function scaleAmountValue(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return value
  if (fromDecimals < toDecimals) return value * 10n ** BigInt(toDecimals - fromDecimals)
  const scale = 10n ** BigInt(fromDecimals - toDecimals)
  if (value % scale !== 0n) throw new Error(`EVM amount ${value.toString()} cannot be converted from ${fromDecimals} to ${toDecimals} decimals`)
  return value / scale
}

function resultAmount(
  value: bigint,
  unit: EvmAmount,
  expected: GenericPaymentValidationRequest['expected'] | undefined,
): ReturnType<typeof marketplaceAmount> {
  const expectedAmount = expected?.amount
  if (expectedAmount && amountCurrency(unit) === amountCurrency(expectedAmount)) {
    return {
      value: scaleAmountValue(value, unit.decimals, expectedAmount.decimals).toString(),
      ...(expectedAmount.currency ? { currency: expectedAmount.currency } : { currency: amountCurrency(expectedAmount) }),
      denomination: expectedAmount.denomination,
      decimals: expectedAmount.decimals,
    }
  }
  return marketplaceAmount(value, unit)
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

function isEvmProofDriver(driver: string): boolean {
  return driver === 'evm' || driver.startsWith('evm:')
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
  if (params.recycleArgs === undefined || params.recycleArgs === null) return undefined
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
  if (!isEvmProofDriver(request.proof.driver)) {
    return {
      driver: 'evm',
      status: 'unverifiable',
      error: `EVM validator cannot validate ${request.proof.driver}`,
    }
  }

  try {
    const params = await resolveMarketplaceDriverPaymentProofParams(request.proof, request.decryptParams)
    const recycleArgsError = validateBidRecycleArgs(params)
    if (recycleArgsError) {
      return { driver: 'evm', status: 'invalid', error: recycleArgsError }
    }
    const chainId = typeof params.chainId === 'number' && Number.isSafeInteger(params.chainId)
      ? params.chainId
      : numberValue(request.expected?.contract?.chainId, 'chainId')
    const chain = chains.find(candidate => candidate.chainId === chainId)
    const contractAddress = address(params.contractAddress ?? chain?.multiEscrowAddress, 'contractAddress')
    const validator = createEvmEscrowValidator({ chains })
    const expectedPaymentAmount = paymentAmount(params)
    const bondAmount = optionalAmount(params, 'bondAmount', 'bond amount')
    const escrowFee = optionalAmount(params, 'escrowFee', 'escrow fee')
    const result = await validator.validate({
      chainId,
      txHash: txHash(params.txHash),
      tradeId: stringValue(params.tradeId ?? request.expected?.settlementId, 'tradeId'),
      contractAddress,
      ...(params.contractBytecodeHash
        ? { contractBytecodeHash: hash(params.contractBytecodeHash, 'contractBytecodeHash') }
        : {}),
      sellerAddress: address(params.sellerAddress, 'sellerAddress'),
      arbiterAddress: address(params.arbiterAddress, 'arbiterAddress'),
      assetAddress: address(params.assetAddress, 'assetAddress'),
      paymentAmount: expectedPaymentAmount,
      ...(bondAmount ? { bondAmount } : {}),
      ...(params.unlockAt !== undefined ? { unlockAt: bigintString(params.unlockAt, 'unlockAt') } : {}),
      ...(params.timeoutClaimantAddress
        ? { timeoutClaimantAddress: address(params.timeoutClaimantAddress, 'timeoutClaimantAddress') }
        : {}),
      ...(escrowFee ? { escrowFee } : {}),
      ...(params.contextHash ? { contextHash: hash(params.contextHash, 'contextHash') } : {}),
      ...(params.recycleCovenantHash
        ? { recycleCovenantHash: hash(params.recycleCovenantHash, 'recycleCovenantHash') }
        : {}),
      minConfirmations: 1,
    })
    const paymentResultAmount = resultAmount(expectedPaymentAmount.value, expectedPaymentAmount, request.expected)
    const fundedResultAmount = result.funding
      ? resultAmount(result.funding.paymentAmount + result.funding.bondAmount, expectedPaymentAmount, request.expected)
      : undefined
    const securityBondResultAmount = result.funding
      ? resultAmount(result.funding.bondAmount, expectedPaymentAmount, request.expected)
      : undefined
    const escrowFeeResultAmount = result.funding
      ? resultAmount(result.funding.escrowFee, expectedPaymentAmount, request.expected)
      : undefined
    return {
      driver: 'evm',
      status: result.status,
      ...(result.status === 'valid'
        ? {
            amount: paymentResultAmount,
          }
        : {}),
      ...(result.confirmations !== undefined ? { confirmations: result.confirmations } : {}),
      ...(result.amountMatched !== undefined ? { amountMatched: result.amountMatched } : {}),
      ...(result.assetMatched !== undefined ? { assetMatched: result.assetMatched } : {}),
      ...(result.recipientMatched !== undefined ? { recipientMatched: result.recipientMatched } : {}),
      ...(result.arbiterMatched !== undefined ? { arbiterMatched: result.arbiterMatched } : {}),
      ...(result.funding
        ? {
            terms: {
              settlementId: result.funding.tradeId,
              paymentAmount: resultAmount(result.funding.paymentAmount, expectedPaymentAmount, request.expected),
              fundedAmount: fundedResultAmount!,
              securityBondAmount: securityBondResultAmount!,
              escrowFee: escrowFeeResultAmount!,
              unlockAt: Number(result.funding.unlockAt),
              timeoutClaimant: result.funding.timeoutClaimantAddress,
              asset: {
                currency: amountCurrency(expectedPaymentAmount),
                denomination: expectedPaymentAmount.denomination,
                decimals: expectedPaymentAmount.decimals,
                chainId: result.funding.chainId,
                assetId: result.funding.assetAddress,
              },
              participants: {
                buyer: { address: result.funding.buyerAddress },
                seller: { address: result.funding.sellerAddress },
                arbiter: { address: result.funding.arbiterAddress },
              },
            },
            data: {
              txHash: result.funding.txHash,
              chainId: result.funding.chainId,
              settlementId: result.funding.tradeId,
              paymentAmount: result.funding.paymentAmount.toString(),
              fundedAmount: (result.funding.paymentAmount + result.funding.bondAmount).toString(),
              securityBondAmount: result.funding.bondAmount.toString(),
              escrowFee: result.funding.escrowFee.toString(),
              unlockAt: result.funding.unlockAt.toString(),
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
      driver: 'evm',
      status: 'unverifiable',
      error: error instanceof Error ? error.message : 'Unable to validate EVM payment',
    }
  }
}
