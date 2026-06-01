import { createEvmEscrowValidator } from '../validation/escrowPaymentValidator.js'
import type { EvmAddress, EvmAmount, EvmHash, EvmHex } from '../types.js'
import type {
  GenericAmount,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

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
      ...(expected.fee || params.escrowFee
        ? { escrowFee: amount(expected.fee, params, 'escrowFee', 'escrow fee') }
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
