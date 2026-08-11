import type {
  BoltzPairTable,
  BoltzReversePair,
  BoltzStatusUpdate,
  BoltzSubmarinePair,
} from '../boltz/types.js'
import type { EvmOperationRecord, EvmOperationStatus } from '../types.js'
import { keccak256, sha256, toHex } from 'viem'
import { deriveEvmSwapMaterial, resolveEvmSeedConfig } from '../seed.js'
import { btcAmountToSats } from './amounts.js'
import type { EvmSwapService, SwapAmountLimits, SwapInRequest, SwapOutRequest, SwapServiceOptions } from './types.js'
import { decodeBolt11PaymentHash } from './bolt11.js'
import {
  assertTrustedDexTargets,
  assertTrustedErc20Swap,
  validateProviderDexCalls,
} from './trust.js'

type LimitReason = 'unsupported_pair' | 'below_minimum' | 'above_maximum'

export class SwapAmountLimitError extends Error {
  readonly name = 'SwapAmountLimitError'
  readonly code = 'PAYMENT_AMOUNT_LIMIT'

  constructor(
    readonly reason: LimitReason,
    readonly limits: SwapAmountLimits,
  ) {
    super(formatLimitMessage(reason, limits))
  }
}

function nowSeconds(now?: () => number): number {
  return now ? now() : Math.floor(Date.now() / 1000)
}

function isDuplicatePreimageHashError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /"error"\s*:\s*"a swap with this preimage hash exists already"\s*[,}]/.test(error.message)
}

function formatLimitMessage(reason: LimitReason, limits: SwapAmountLimits): string {
  if (reason === 'unsupported_pair') {
    return `No Boltz ${limits.direction} pair is configured for ${limits.from} -> ${limits.to}`
  }
  if (reason === 'below_minimum') {
    return `Payment amount ${limits.amountSats} sats is below the Boltz ${limits.direction} minimum ${limits.minimal} sats for ${limits.from} -> ${limits.to}`
  }
  return `Payment amount ${limits.amountSats} sats is above the Boltz ${limits.direction} maximum ${limits.maximal} sats for ${limits.from} -> ${limits.to}`
}

function logSwap(
  options: SwapServiceOptions,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>,
  error?: unknown,
): void {
  const logger = options.logger?.child?.({ scope: 'marketplace.evm.swaps' }) ?? options.logger
  void logger?.[level](message, data, error)
}

function pairFor<Pair extends { hash?: string; limits?: { minimal?: number; maximal?: number } }>(
  pairs: BoltzPairTable<Pair>,
  from: string,
  to: string,
): Pair | undefined {
  return pairs[from]?.[to] ?? pairs[from.toUpperCase()]?.[to] ?? pairs[from]?.[to.toUpperCase()]
}

function assertBoltzLimits(input: {
  direction: SwapAmountLimits['direction']
  from: string
  to: string
  amountSats?: number
  pair?: { hash?: string; limits?: { minimal?: number; maximal?: number } }
}): SwapAmountLimits {
  const limits: SwapAmountLimits = {
    source: 'boltz',
    direction: input.direction,
    from: input.from,
    to: input.to,
    minimal: input.pair?.limits?.minimal ?? null,
    maximal: input.pair?.limits?.maximal ?? null,
    ...(input.amountSats !== undefined ? { amountSats: input.amountSats } : {}),
    ...(input.pair?.hash ? { pairHash: input.pair.hash } : {}),
  }
  if (!input.pair) throw new SwapAmountLimitError('unsupported_pair', limits)
  if (input.amountSats !== undefined && limits.minimal !== null && input.amountSats < limits.minimal) {
    throw new SwapAmountLimitError('below_minimum', limits)
  }
  if (input.amountSats !== undefined && limits.maximal !== null && input.amountSats > limits.maximal) {
    throw new SwapAmountLimitError('above_maximum', limits)
  }
  return limits
}

function swapOutFeeAdjustedInvoiceSats(
  pair: BoltzSubmarinePair,
  lockAmountSats: number | undefined,
): number | undefined {
  if (lockAmountSats === undefined) return undefined
  const minerFees = Math.max(0, Math.ceil(pair.fees?.minerFees ?? 0))
  const percentage = Math.max(0, pair.fees?.percentage ?? 0)
  if (lockAmountSats <= minerFees) return 0

  let invoiceAmount = Math.floor((lockAmountSats - minerFees) / (1 + percentage / 100))
  while (
    invoiceAmount > 0
    && Math.ceil(invoiceAmount * (1 + percentage / 100)) + minerFees > lockAmountSats
  ) {
    invoiceAmount -= 1
  }
  return invoiceAmount
}

function routeSwapAmountToSats(input: {
  value: bigint
  boltzCurrency: string
  decimals: number
}): number {
  return btcAmountToSats({
    value: input.value,
    denomination: input.boltzCurrency,
    decimals: input.decimals,
  })
}

function operation(
  request: { id: string; chainId: number },
  kind: EvmOperationRecord['kind'],
  status: EvmOperationStatus,
  data: Record<string, unknown>,
  now?: () => number,
): EvmOperationRecord {
  const timestamp = nowSeconds(now)
  return {
    id: request.id,
    kind,
    status,
    chainId: request.chainId,
    data,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function recoverySwapRequest(
  request: SwapInRequest | SwapOutRequest,
): Record<string, unknown> {
  return {
    tradeIndex: request.tradeIndex,
    attemptIndex: request.attemptIndex,
    chainId: request.chainId,
    ...(request.assetAddress ? { assetAddress: request.assetAddress } : {}),
    ...('recoveryProof' in request && request.recoveryProof
      ? { recoveryProof: request.recoveryProof }
      : {}),
  }
}

function canonicalJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify({ $bigint: value.toString() })
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function requestFingerprint(direction: 'swap-in' | 'swap-out', request: SwapInRequest | SwapOutRequest): string {
  const { invoice: _invoice, ...stableRequest } = request as SwapOutRequest
  return keccak256(toHex(canonicalJson({ direction, request: stableRequest })))
}

function invoiceFingerprint(invoice: string): string {
  return keccak256(toHex(invoice))
}

function providerStatusSummary(update: BoltzStatusUpdate): Record<string, string> {
  const status = /^[a-z0-9._-]{1,64}$/i.test(update.status) ? update.status : 'unknown'
  const providerId = typeof update.id === 'string' && /^[a-z0-9._:-]{1,128}$/i.test(update.id)
    ? update.id
    : undefined
  const candidateHash = update.transaction?.id ?? update.transactionHash
  const transactionHash = candidateHash && /^0x[0-9a-f]{64}$/i.test(candidateHash)
    ? candidateHash
    : undefined
  return {
    status,
    ...(providerId ? { id: providerId } : {}),
    ...(transactionHash ? { transactionHash } : {}),
  }
}

function persistedCreationError(direction: 'swap-in' | 'swap-out', error: unknown): string {
  if (direction === 'swap-in' && isDuplicatePreimageHashError(error)) {
    return 'Boltz reports this deterministic preimage hash already exists; refusing to create a parallel swap'
  }
  return `Unable to safely create Boltz ${direction}`
}

async function reserveOperation(
  store: SwapServiceOptions['store'],
  record: EvmOperationRecord,
): Promise<{ record: EvmOperationRecord; created: boolean }> {
  if (store.putIfAbsent) {
    if (await store.putIfAbsent(record)) return { record, created: true }
    const existing = await store.get(record.id)
    if (!existing) throw new Error(`Operation ${record.id} disappeared during reservation`)
    return { record: existing, created: false }
  }
  const existing = await store.get(record.id)
  if (existing) return { record: existing, created: false }
  await store.put(record)
  return { record, created: true }
}

function assertFingerprint(record: EvmOperationRecord, expected: string): void {
  if (record.data.requestFingerprint !== expected) {
    throw new Error(`Operation ${record.id} already exists for a different request`)
  }
}

function value<T>(record: EvmOperationRecord, key: string): T | undefined {
  return record.data[key] as T | undefined
}

function swapInFromRecord(
  record: EvmOperationRecord,
  material: ReturnType<typeof deriveEvmSwapMaterial>,
  request: SwapInRequest,
  invoice: string | undefined,
): Awaited<ReturnType<EvmSwapService['swapIn']>> {
  if (record.status === 'completed' && record.txHash) {
    return { type: 'completed', operation: record, txHash: record.txHash }
  }
  const swapId = record.swapId ?? value<string>(record, 'swapId')
  const timeoutBlockHeight = value<number>(record, 'timeoutBlockHeight')
  if (!swapId || timeoutBlockHeight === undefined) {
    throw new Error(`Swap-in operation ${record.id} has an ambiguous external creation state; refusing to create a parallel swap`)
  }
  if (!invoice) {
    throw new Error(`Swap-in operation ${record.id} is known, but its Lightning invoice is intentionally not persisted`)
  }
  return {
    type: 'external_payment_required',
    operation: record,
    invoice,
    swapId,
    amount: request.amount,
    preimage: material.preimage,
    preimageHash: material.preimageHash,
    ...(value<number>(record, 'onchainAmount') !== undefined ? { onchainAmount: value<number>(record, 'onchainAmount') } : {}),
    ...(value(record, 'claimAssetAddress') ? { claimAssetAddress: value(record, 'claimAssetAddress') } : {}),
    ...(value(record, 'postClaimCalls') ? { postClaimCalls: value(record, 'postClaimCalls') } : {}),
    ...(value(record, 'limits') ? { limits: value(record, 'limits') } : {}),
    ...(value(record, 'lockupAddress') ? { lockupAddress: value(record, 'lockupAddress') } : {}),
    ...(value(record, 'refundAddress') ? { refundAddress: value(record, 'refundAddress') } : {}),
    timeoutBlockHeight,
  } as Awaited<ReturnType<EvmSwapService['swapIn']>>
}

function swapOutFromRecord(
  record: EvmOperationRecord,
  request: SwapOutRequest,
): Awaited<ReturnType<EvmSwapService['swapOut']>> {
  if (record.status === 'completed') {
    return { type: 'completed', operation: record }
  }
  if (record.status === 'external_invoice_required') {
    return {
      type: 'external_invoice_required',
      operation: record,
      ...(value(record, 'swapAmount') ? { amount: value(record, 'swapAmount') } : request.amount ? { amount: request.amount } : {}),
      ...(value(record, 'invoiceAmountSats') !== undefined ? { invoiceAmountSats: value(record, 'invoiceAmountSats') } : {}),
      ...(request.invoiceDescription ? { description: request.invoiceDescription } : {}),
      ...(value(record, 'lockAssetAddress') ? { lockAssetAddress: value(record, 'lockAssetAddress') } : {}),
      ...(value(record, 'preLockCalls') ? { preLockCalls: value(record, 'preLockCalls') } : {}),
      ...(value(record, 'limits') ? { limits: value(record, 'limits') } : {}),
    } as Awaited<ReturnType<EvmSwapService['swapOut']>>
  }
  const swapId = record.swapId ?? value<string>(record, 'swapId')
  const timeoutBlockHeight = value<number>(record, 'timeoutBlockHeight')
  if (!swapId || timeoutBlockHeight === undefined) {
    throw new Error(`Swap-out operation ${record.id} has an ambiguous external creation state; refusing to create a parallel swap`)
  }
  return {
    type: 'awaiting_resolution',
    operation: record,
    swapId,
    ...(value(record, 'expectedAmount') !== undefined ? { expectedAmount: value(record, 'expectedAmount') } : {}),
    ...(value(record, 'claimAddress') ? { claimAddress: value(record, 'claimAddress') } : {}),
    ...(value(record, 'lockupAddress') ? { lockupAddress: value(record, 'lockupAddress') } : {}),
    ...(value(record, 'lockAssetAddress') ? { lockAssetAddress: value(record, 'lockAssetAddress') } : {}),
    ...(value(record, 'preLockCalls') ? { preLockCalls: value(record, 'preLockCalls') } : {}),
    ...(value(record, 'limits') ? { limits: value(record, 'limits') } : {}),
    ...(value(record, 'preimageHash') ? { preimageHash: value(record, 'preimageHash') } : {}),
    timeoutBlockHeight,
  } as Awaited<ReturnType<EvmSwapService['swapOut']>>
}

export function createEvmSwapService(options: SwapServiceOptions): EvmSwapService {
  const seed = resolveEvmSeedConfig(options.seed)
  const chains = new Map(options.chains.map(chain => [chain.chainId, chain]))
  const swapInInvoices = new Map<string, string>()

  function trustedChain(chainId: number) {
    const chain = chains.get(chainId)
    if (!chain) throw new Error(`No EVM chain configured for chainId ${chainId}`)
    return {
      chain,
      trust: options.trustByChainId?.[chainId],
    }
  }

  return {
    async swapIn(request: SwapInRequest) {
      const { chain, trust } = trustedChain(request.chainId)
      await assertTrustedErc20Swap({ chain, trust, contractAddress: trust?.erc20Swap.address })
      const material = deriveEvmSwapMaterial(seed.seed, {
        tradeIndex: request.tradeIndex,
        chainId: request.chainId,
        direction: 'swap-in',
        attemptIndex: request.attemptIndex,
      })
      const fingerprint = requestFingerprint('swap-in', request)
      const existing = await options.store.get(material.operationId)
      if (existing) {
        assertFingerprint(existing, fingerprint)
        const legacyInvoice = value<string>(existing, 'invoice')
        if (legacyInvoice) {
          swapInInvoices.set(existing.id, legacyInvoice)
          const { invoice: _invoice, ...safeData } = existing.data
          existing.data = safeData
          await options.store.put(existing)
        }
        return swapInFromRecord(existing, material, request, swapInInvoices.get(existing.id))
      }
      const claimAddress = await options.accounts.smartAccountAddress(request.tradeIndex, request.chainId)
      const from = request.lightningCurrency ?? 'BTC'
      const routeVia = request.routeVia
      const to = routeVia?.boltzCurrency ?? request.boltzCurrency
      let postClaimCalls = request.postClaimCalls
      let requestedOnchainAmount = request.boltzAmountSats
      let claimAssetAddress = routeVia?.assetAddress ?? request.assetAddress

      if (routeVia) {
        if (!request.assetAddress) throw new Error('Routed Boltz swap-in requires a target assetAddress')
        await assertTrustedDexTargets({ chain, trust })
        const dex = await options.boltz.quoteTokenAmountOut(routeVia.quoteCurrency, {
          tokenIn: routeVia.assetAddress,
          tokenOut: request.assetAddress,
          amount: request.amount.value,
        })
        const providerCalls = await options.boltz.encodeTokenSwap(routeVia.quoteCurrency, {
          recipient: claimAddress,
          amountIn: dex.amountIn,
          amountOutMin: dex.amountOut,
          data: dex.data,
        })
        const dexCalls = await validateProviderDexCalls({
          chain,
          trust,
          calls: providerCalls,
          tokenIn: routeVia.assetAddress,
          tokenOut: request.assetAddress,
          recipient: claimAddress,
          amountIn: dex.amountIn,
          amountOutMin: dex.amountOut,
        })
        postClaimCalls = [...dexCalls, ...(request.postClaimCalls ?? [])]
        requestedOnchainAmount = request.boltzAmountSats ?? routeSwapAmountToSats({
          value: dex.amountIn,
          boltzCurrency: routeVia.boltzCurrency,
          decimals: routeVia.decimals,
        })
        claimAssetAddress = routeVia.assetAddress
      }

      const pairs = await options.boltz.getReversePairs()
      const pair = pairFor<BoltzReversePair>(pairs, from, to)
      if (!pair) {
        assertBoltzLimits({ direction: 'swap-in', from, to })
        throw new Error('unreachable')
      }
      requestedOnchainAmount ??= btcAmountToSats(request.amount)
      const limits = assertBoltzLimits({
        direction: 'swap-in',
        from,
        to,
        amountSats: requestedOnchainAmount,
        pair,
      })
      logSwap(options, 'debug', 'Resolved Boltz swap-in limits', {
        tradeIndex: request.tradeIndex,
        chainId: request.chainId,
        from,
        to,
        limits,
      })

      const initial = operation(
        { id: material.operationId, chainId: request.chainId },
        'swap_in',
        'initialised',
        {
          request: recoverySwapRequest(request),
          requestFingerprint: fingerprint,
          limits,
          claimAssetAddress,
          postClaimCalls,
        },
        options.now,
      )
      const reserved = await reserveOperation(options.store, initial)
      if (!reserved.created) {
        assertFingerprint(reserved.record, fingerprint)
        return swapInFromRecord(
          reserved.record,
          material,
          request,
          swapInInvoices.get(reserved.record.id),
        )
      }
      initial.data = { ...initial.data, externalRequestStartedAt: nowSeconds(options.now) }
      await options.store.put(initial)

      try {
          const reverse = await options.boltz.createReverseSwap({
            from,
            to,
            preimageHash: material.preimageHash,
            claimAddress,
            onchainAmount: requestedOnchainAmount,
            ...(limits.pairHash ? { pairHash: limits.pairHash } : {}),
            ...(request.description ? { description: request.description } : {}),
          })
          const onchainAmount = reverse.onchainAmount ?? requestedOnchainAmount
          swapInInvoices.set(initial.id, reverse.invoice)
          initial.swapId = reverse.id
          initial.data = {
            ...initial.data,
            onchainAmount,
            lockupAddress: reverse.lockupAddress,
            refundAddress: reverse.refundAddress,
            timeoutBlockHeight: reverse.timeoutBlockHeight,
          }
          initial.updatedAt = nowSeconds(options.now)
          await options.store.put(initial)
          const verifiedSwapContract = await assertTrustedErc20Swap({
            chain,
            trust,
            contractAddress: reverse.lockupAddress,
          })
          initial.status = 'external_payment_required'
          initial.data = { ...initial.data, verifiedSwapContract }
          initial.updatedAt = nowSeconds(options.now)
          await options.store.put(initial)
          logSwap(options, 'info', 'Created Boltz swap-in requiring external payment', {
            operationId: initial.id,
            swapId: reverse.id,
            tradeIndex: request.tradeIndex,
            attemptIndex: request.attemptIndex,
            chainId: request.chainId,
            preimageHash: material.preimageHash,
          })
          return {
            type: 'external_payment_required',
            operation: initial,
            invoice: reverse.invoice,
            swapId: reverse.id,
            amount: request.amount,
            onchainAmount,
            preimage: material.preimage,
            preimageHash: material.preimageHash,
            ...(claimAssetAddress ? { claimAssetAddress } : {}),
            ...(postClaimCalls ? { postClaimCalls } : {}),
            limits,
            ...(reverse.lockupAddress ? { lockupAddress: reverse.lockupAddress } : {}),
            ...(reverse.refundAddress ? { refundAddress: reverse.refundAddress } : {}),
            timeoutBlockHeight: reverse.timeoutBlockHeight,
          }
      } catch (error) {
          swapInInvoices.delete(initial.id)
          initial.status = 'failed'
          initial.error = persistedCreationError('swap-in', error)
          initial.updatedAt = nowSeconds(options.now)
          initial.data = { ...initial.data, creationAmbiguous: Boolean(initial.swapId === undefined) }
          await options.store.put(initial)
          logSwap(options, 'error', 'Unable to safely create Boltz swap-in', {
            tradeIndex: request.tradeIndex,
            chainId: request.chainId,
            attemptIndex: request.attemptIndex,
            preimageHash: material.preimageHash,
          }, error)
          throw new Error(initial.error, { cause: error })
      }
    },

    async swapOut(request: SwapOutRequest) {
      const material = deriveEvmSwapMaterial(seed.seed, {
        tradeIndex: request.tradeIndex,
        chainId: request.chainId,
        direction: 'swap-out',
        attemptIndex: request.attemptIndex,
      })
      const { chain, trust } = trustedChain(request.chainId)
      await assertTrustedErc20Swap({ chain, trust, contractAddress: trust?.erc20Swap.address })
      const fingerprint = requestFingerprint('swap-out', request)
      let record = await options.store.get(material.operationId)
      if (record) {
        assertFingerprint(record, fingerprint)
        if (!request.invoice || record.status !== 'external_invoice_required') {
          if (request.invoice && value<string>(record, 'invoiceFingerprint') !== invoiceFingerprint(request.invoice)) {
            throw new Error(`Operation ${record.id} already exists for a different Lightning invoice`)
          }
          return swapOutFromRecord(record, request)
        }
      }
      const senderAddress = await options.accounts.smartAccountAddress(request.tradeIndex, request.chainId)
      const routeVia = request.routeVia
      const from = routeVia?.boltzCurrency ?? request.boltzCurrency
      const to = request.lightningCurrency ?? 'BTC'
      let preLockCalls = request.preLockCalls
      let swapAmount = request.amount
      let lockAssetAddress = routeVia?.assetAddress ?? request.assetAddress

      if (record) {
        preLockCalls = value(record, 'preLockCalls') ?? preLockCalls
        swapAmount = value(record, 'swapAmount') ?? swapAmount
        lockAssetAddress = value(record, 'lockAssetAddress') ?? lockAssetAddress
      } else if (routeVia) {
        if (!request.assetAddress) throw new Error('Routed Boltz swap-out requires a source assetAddress')
        if (!request.amount) throw new Error('Routed Boltz swap-out requires an amount')
        await assertTrustedDexTargets({ chain, trust })
        const dex = await options.boltz.quoteTokenAmountIn(routeVia.quoteCurrency, {
          tokenIn: request.assetAddress,
          tokenOut: routeVia.assetAddress,
          amount: request.amount.value,
        })
        const providerCalls = await options.boltz.encodeTokenSwap(routeVia.quoteCurrency, {
          recipient: senderAddress,
          amountIn: dex.amountIn,
          amountOutMin: dex.amountOut,
          data: dex.data,
        })
        const dexCalls = await validateProviderDexCalls({
          chain,
          trust,
          calls: providerCalls,
          tokenIn: request.assetAddress,
          tokenOut: routeVia.assetAddress,
          recipient: senderAddress,
          amountIn: dex.amountIn,
          amountOutMin: dex.amountOut,
        })
        preLockCalls = [...(request.preLockCalls ?? []), ...dexCalls]
        swapAmount = {
          value: dex.amountOut,
          denomination: routeVia.boltzCurrency,
          decimals: routeVia.decimals,
        }
        lockAssetAddress = routeVia.assetAddress
      }

      const pairs = record ? undefined : await options.boltz.getSubmarinePairs()
      const pair = pairs ? pairFor<BoltzSubmarinePair>(pairs, from, to) : undefined
      if (!record && !pair) {
        assertBoltzLimits({ direction: 'swap-out', from, to })
        throw new Error('unreachable')
      }
      const amountSats = swapAmount ? btcAmountToSats(swapAmount) : undefined
      const limits = record
        ? value<SwapAmountLimits>(record, 'limits')!
        : assertBoltzLimits({
            direction: 'swap-out',
            from,
            to,
            ...(amountSats !== undefined ? { amountSats } : {}),
            pair: pair!,
          })
      if (!limits) throw new Error(`Operation ${record?.id} is missing its pinned Boltz limits`)
      if (!request.invoice) {
        const invoiceAmountSats = swapOutFeeAdjustedInvoiceSats(pair!, amountSats)
        if (invoiceAmountSats !== undefined) {
          assertBoltzLimits({
            direction: 'swap-out',
            from,
            to,
            amountSats: invoiceAmountSats,
            pair: pair!,
          })
        }
        const initial = operation(
          { id: material.operationId, chainId: request.chainId },
          'swap_out',
          'external_invoice_required',
          {
            request: recoverySwapRequest(request),
            requestFingerprint: fingerprint,
            limits,
            preLockCalls,
            ...(invoiceAmountSats !== undefined ? { invoiceAmountSats } : {}),
            ...(swapAmount ? { swapAmount } : {}),
            ...(lockAssetAddress ? { lockAssetAddress } : {}),
          },
          options.now,
        )
        const reserved = await reserveOperation(options.store, initial)
        record = reserved.record
        assertFingerprint(record, fingerprint)
        logSwap(options, 'info', 'Created swap-out request requiring external invoice', {
          operationId: record.id,
          tradeIndex: request.tradeIndex,
          chainId: request.chainId,
        })
        return swapOutFromRecord(record, request)
      }
      const paymentHash = decodeBolt11PaymentHash(request.invoice)
      const currentInvoiceFingerprint = invoiceFingerprint(request.invoice)
      if (!record) {
        const initial = operation(
          { id: material.operationId, chainId: request.chainId },
          'swap_out',
          'initialised',
          {
            request: recoverySwapRequest(request),
            requestFingerprint: fingerprint,
            limits,
            preLockCalls,
            ...(swapAmount ? { swapAmount } : {}),
            ...(lockAssetAddress ? { lockAssetAddress } : {}),
          },
          options.now,
        )
        const reserved = await reserveOperation(options.store, initial)
        record = reserved.record
        if (!reserved.created) {
          assertFingerprint(record, fingerprint)
          return swapOutFromRecord(record, request)
        }
      }
      const existingInvoiceFingerprint = value<string>(record, 'invoiceFingerprint')
      if (existingInvoiceFingerprint && existingInvoiceFingerprint !== currentInvoiceFingerprint) {
        throw new Error(`Operation ${record.id} already exists for a different Lightning invoice`)
      }
      if (value(record, 'externalRequestStartedAt') && !record.swapId) {
        throw new Error(`Swap-out operation ${record.id} has an ambiguous external creation state; refusing to create a parallel swap`)
      }
      record.status = 'initialised'
      record.data = {
        ...record.data,
        request: recoverySwapRequest(request),
        invoiceFingerprint: currentInvoiceFingerprint,
        preimageHash: paymentHash,
        externalRequestStartedAt: nowSeconds(options.now),
      }
      record.updatedAt = nowSeconds(options.now)
      await options.store.put(record)
      try {
        const submarine = await options.boltz.createSubmarineSwap({
          from,
          to,
          invoice: request.invoice,
          ...(limits.pairHash ? { pairHash: limits.pairHash } : {}),
        })
        record.swapId = submarine.id
        record.data = {
          ...record.data,
          expectedAmount: submarine.expectedAmount,
          claimAddress: submarine.claimAddress,
          lockupAddress: submarine.address,
          timeoutBlockHeight: submarine.timeoutBlockHeight,
        }
        record.updatedAt = nowSeconds(options.now)
        await options.store.put(record)
        const verifiedSwapContract = await assertTrustedErc20Swap({
          chain,
          trust,
          contractAddress: submarine.address,
        })
        record.status = 'awaiting_onchain'
        record.data = { ...record.data, verifiedSwapContract }
        record.updatedAt = nowSeconds(options.now)
        await options.store.put(record)
        logSwap(options, 'info', 'Created Boltz swap-out awaiting on-chain resolution', {
          operationId: record.id,
          swapId: submarine.id,
          tradeIndex: request.tradeIndex,
          chainId: request.chainId,
        })
        return swapOutFromRecord(record, request)
      } catch (error) {
        record.status = 'failed'
        record.error = persistedCreationError('swap-out', error)
        record.data = { ...record.data, creationAmbiguous: Boolean(!record.swapId) }
        record.updatedAt = nowSeconds(options.now)
        await options.store.put(record)
        throw error
      }
    },

    async resume(id: string) {
      const record = await options.store.get(id)
      if (!record) throw new Error(`Operation not found: ${id}`)
      const latestStatus = record.swapId ? await options.boltz.getSwap(record.swapId) : undefined
      let preimage: `0x${string}` | undefined
      let cooperativeRefundSignature: `0x${string}` | undefined
      if (latestStatus) {
        if (
          record.kind === 'swap_in'
          && /^(invoice\.paid|transaction\.|swap\.(?:expired|refunded|failed)|.*(?:failed|expired|refunded))/i.test(latestStatus.status)
        ) {
          swapInInvoices.delete(record.id)
        }
        const { latestStatus: _legacyLatestStatus, ...safeData } = record.data
        record.data = { ...safeData, providerStatus: providerStatusSummary(latestStatus) }
        if (
          record.kind === 'swap_out'
          && /^(invoice\.paid|transaction\.claim(?:ed|\.pending))$/i.test(latestStatus.status)
          && record.swapId
        ) {
          preimage = await options.boltz.getSubmarinePreimage(record.swapId)
          const expectedHash = value<string>(record, 'preimageHash')
          if (!expectedHash || sha256(preimage).toLowerCase() !== expectedHash.toLowerCase()) {
            throw new Error(`Boltz preimage does not match operation ${record.id}`)
          }
          record.status = 'completed'
          record.data = { ...record.data, completedAt: nowSeconds(options.now) }
        } else if (record.kind === 'swap_out' && latestStatus.status === 'transaction.refunded') {
          record.status = 'refunded'
          record.data = { ...record.data, refundedAt: nowSeconds(options.now) }
        } else if (record.kind === 'swap_out' && /failed|expired/i.test(latestStatus.status)) {
          record.status = 'refunding'
          if (record.swapId) {
            cooperativeRefundSignature = await options.boltz.getCooperativeRefundSignature(record.swapId) ?? undefined
          }
        }
        record.updatedAt = nowSeconds(options.now)
        await options.store.put(record)
        logSwap(options, 'debug', 'Updated EVM swap operation from Boltz status', {
          operationId: id,
          swapId: record.swapId,
          status: latestStatus.status,
        })
      }
      return {
        operation: record,
        ...(latestStatus ? { latestStatus } : {}),
        ...(preimage ? { preimage } : {}),
        ...(cooperativeRefundSignature ? { cooperativeRefundSignature } : {}),
      }
    },

    listActive() {
      return options.store.list({
        status: [
          'external_payment_required',
          'initialised',
          'external_invoice_required',
          'awaiting_onchain',
          'claiming',
          'locking',
          'settling',
          'refunding',
        ],
      })
    },
  }
}
