import type { Hex, LocalAccount } from 'viem'
import { keccak256, sha256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export type EvmSeedConfig = {
  seed: string
  role?: string
  namespace?: string
}

export type EvmSeedDerivationContext = {
  tradeIndex: number
  chainId?: number
  role?: string
  namespace?: string
  purpose?: string
  extra?: string
}

export type EvmTradeDerivationContext = {
  tradeIndex: number
  role?: string
  namespace?: string
  extra?: string
}

export type EvmChainDerivationContext = EvmTradeDerivationContext & {
  chainId: number
}

export type EvmSwapDirection = 'swap-in' | 'swap-out'

export type EvmSwapDerivationContext = EvmChainDerivationContext & {
  direction: EvmSwapDirection
  attemptIndex: number
}

export type EvmSwapMaterial = {
  tradeIndex: number
  chainId: number
  direction: EvmSwapDirection
  attemptIndex: number
  tradeRoot: Hex
  evmRoot: Hex
  chainRoot: Hex
  attemptRoot: Hex
  operationId: string
  secret: Hex
  secretHash: Hex
  preimage: Hex
  preimageHash: Hex
}

const seedHex = /^(0x)?[0-9a-fA-F]{64}$/

export function normalizeEvmSeed(seed: string): Hex {
  if (!seedHex.test(seed)) throw new Error('Invalid EVM marketplace seed')
  const stripped = seed.startsWith('0x') ? seed.slice(2) : seed
  return `0x${stripped.toLowerCase()}` as Hex
}

function assertIndex(index: number, field = 'EVM account index'): number {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error(`Invalid ${field}: ${index}`)
  return index
}

function sortedJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
}

export function deriveEvmOwnerPrivateKey(seed: string, context: EvmSeedDerivationContext): Hex {
  const base = deriveEvmChainRoot(seed, {
    ...context,
    chainId: context.chainId ?? 0,
  })

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const privateKey = deriveNode(base, {
      purpose: context.purpose ?? 'aa-owner',
      attempt,
    })
    try {
      privateKeyToAccount(privateKey)
      return privateKey
    } catch (_) {
      // Vanishingly unlikely, but keep derivation total if the hash is outside the curve order.
    }
  }

  throw new Error('Unable to derive a valid EVM owner key')
}

export function deriveEvmOwnerAccount(seed: string, context: EvmSeedDerivationContext): LocalAccount {
  return privateKeyToAccount(deriveEvmOwnerPrivateKey(seed, context))
}

function deriveNode(parent: Hex, context: Record<string, unknown>): Hex {
  return keccak256(toHex(`marketplace-evm-ts/derive/v1\n${parent}\n${sortedJson(context)}`))
}

export function deriveEvmTradeRoot(seed: string, context: EvmTradeDerivationContext): Hex {
  return deriveNode(normalizeEvmSeed(seed), {
    namespace: context.namespace ?? 'marketplace',
    purpose: 'trade-root',
    tradeIndex: assertIndex(context.tradeIndex, 'EVM trade index'),
    role: context.role ?? 'trade',
    extra: context.extra,
  })
}

export function deriveEvmTradeId(seed: string, context: EvmTradeDerivationContext): Hex {
  return deriveNode(normalizeEvmSeed(seed), {
    purpose: 'trade-id',
    tradeIndex: assertIndex(context.tradeIndex, 'EVM trade index'),
  })
}

export function deriveEvmRoot(seed: string, context: EvmTradeDerivationContext): Hex {
  return deriveNode(deriveEvmTradeRoot(seed, context), { purpose: 'evm-root' })
}

export function deriveEvmChainRoot(seed: string, context: EvmChainDerivationContext): Hex {
  return deriveNode(deriveEvmRoot(seed, context), {
    purpose: 'chain-root',
    chainId: context.chainId,
  })
}

export function deriveEvmSwapMaterial(seed: string, context: EvmSwapDerivationContext): EvmSwapMaterial {
  const normalizedTradeIndex = assertIndex(context.tradeIndex, 'EVM trade index')
  const attemptIndex = assertIndex(context.attemptIndex, 'EVM swap attempt index')
  const tradeRoot = deriveEvmTradeRoot(seed, context)
  const evmRoot = deriveEvmRoot(seed, context)
  const chainRoot = deriveEvmChainRoot(seed, context)
  const attemptRoot = deriveNode(chainRoot, {
    purpose: 'swap-attempt-root',
    direction: context.direction,
    attemptIndex,
  })
  const secret = deriveNode(attemptRoot, { purpose: 'swap-secret' })
  const secretHash = sha256(secret)
  const operationId = deriveNode(attemptRoot, { purpose: 'operation-id' }).slice(2)

  return {
    tradeIndex: normalizedTradeIndex,
    chainId: context.chainId,
    direction: context.direction,
    attemptIndex,
    tradeRoot,
    evmRoot,
    chainRoot,
    attemptRoot,
    operationId: `${context.direction}-${operationId}`,
    secret,
    secretHash,
    preimage: secret,
    preimageHash: secretHash,
  }
}

export function resolveEvmSeedConfig(seed: string | EvmSeedConfig): EvmSeedConfig {
  if (typeof seed === 'string') return { seed: normalizeEvmSeed(seed) }
  return {
    ...seed,
    seed: normalizeEvmSeed(seed.seed),
  }
}
