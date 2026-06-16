import { encodeAbiParameters, keccak256, toHex } from 'viem'

import { erc20Abi } from '../contracts/erc20.js'
import { createMarketplaceEvmClient } from '../client.js'
import { erc20SwapClaimCall, findErc20SwapLockup } from '../swaps/erc20Swap.js'
import { zeroAddress } from '../utils/hex.js'
import { resolveEvmPaymentIntent } from './intent.js'
import type {
  EvmPayRequest,
  EvmResolvedPaymentIntent,
  GenericPolicyPaymentState,
  GenericPaymentProof,
} from './types.js'
import type { MarketplaceDriverPaymentTerms, MarketplaceDriverPaymentTermAmount } from '@sudonym-btc/marketplace-driver-interface'
import type { EvmBoltzRouteVia, EvmHash, EvmHex } from '../types.js'
import type { SwapInRequest } from '../swaps/types.js'

const swapPollIntervalMs = 2_000
const swapPaymentTimeoutMs = 20 * 60_000
const zeroHash = `0x${'0'.repeat(64)}` as EvmHex
const recycleCovenantTypeHash = keccak256(toHex('RecycleCovenant(address buyer,address seller,address arbiter,address token,uint256 paymentAmount,uint256 bondAmount,address timeoutClaimant,uint256 escrowFee,bytes32 contextHash)'))

function logEvmPay(
  request: EvmPayRequest,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>,
  error?: unknown,
): void {
  const logger = request.logger?.child?.({ scope: 'marketplace.evm.pay' }) ?? request.logger
  void logger?.[level](message, data, error)
}

function boltzQuoteCurrency(intent: EvmResolvedPaymentIntent): string | undefined {
  return intent.chain.boltzCurrency ?? intent.chain.boltz?.nativeCurrencyByChainId?.[intent.chain.chainId]
}

function sameBoltzCurrency(value: string | undefined, expected: string): boolean {
  return value?.toUpperCase() === expected.toUpperCase()
}

function termAmount(options: {
  value: bigint
  currency?: string
  denomination: string
  decimals: number
  assetId: string
}): MarketplaceDriverPaymentTermAmount {
  return {
    value: options.value.toString(),
    ...(options.currency ? { currency: options.currency } : {}),
    denomination: options.denomination,
    decimals: options.decimals,
    assetId: options.assetId,
  }
}

function evmPaymentTerms(options: {
  policyId: string
  policyType: string
  chainId: number
  contractAddress: `0x${string}`
  tradeId: string
  buyerAddress: `0x${string}`
  sellerAddress: `0x${string}`
  arbiterAddress: `0x${string}`
  assetAddress: `0x${string}`
  value: bigint
  bondAmount: bigint
  currency?: string
  denomination: string
  decimals: number
  escrowFee: bigint
  fundedValue: bigint
  unlockAt: bigint
  timeoutClaimantAddress: `0x${string}`
  contextHash: EvmHex
  recycleCovenantHash: EvmHex
}): MarketplaceDriverPaymentTerms {
  const assetId = `${options.chainId}:${options.assetAddress.toLowerCase()}`
  const paymentAmount = termAmount({
    value: options.value,
    ...(options.currency ? { currency: options.currency } : {}),
    denomination: options.denomination,
    decimals: options.decimals,
    assetId,
  })
  const fundedAmount = termAmount({
    value: options.fundedValue,
    ...(options.currency ? { currency: options.currency } : {}),
    denomination: options.denomination,
    decimals: options.decimals,
    assetId,
  })
  const escrowFee = termAmount({
    value: options.escrowFee,
    ...(options.currency ? { currency: options.currency } : {}),
    denomination: options.denomination,
    decimals: options.decimals,
    assetId,
  })
  return {
    version: 1,
    asset: paymentAmount,
    parties: [
      { role: 'buyer', id: options.buyerAddress },
      { role: 'seller', id: options.sellerAddress },
      { role: 'arbiter', id: options.arbiterAddress },
    ],
    lock: {
      id: options.tradeId,
      policyId: options.policyId,
      kind: 'contract',
      amount: fundedAmount,
      controls: [
        { role: 'buyer', id: options.buyerAddress },
        { role: 'seller', id: options.sellerAddress },
        { role: 'arbiter', id: options.arbiterAddress },
      ],
      conditions: {
        policyType: options.policyType,
        chainId: options.chainId,
        contractAddress: options.contractAddress,
        contextHash: options.contextHash,
        recycleCovenantHash: options.recycleCovenantHash,
        timeoutClaimantAddress: options.timeoutClaimantAddress,
        unlockAt: options.unlockAt.toString(),
        escrowFee,
        arbitration: {
          type: 'continuous',
          denominator: '1000000',
        },
      },
    },
  }
}

function defaultRouteVia(intent: EvmResolvedPaymentIntent): EvmBoltzRouteVia | undefined {
  if (!sameBoltzCurrency(intent.asset.boltzCurrency, 'USDT')) return undefined
  const quoteCurrency = boltzQuoteCurrency(intent)
  if (!quoteCurrency) return undefined
  const routeAsset = [intent.chain.nativeAsset, ...(intent.chain.assets ?? [])].find(asset =>
    sameBoltzCurrency(asset.boltzCurrency, 'tBTC'),
  )
  if (!routeAsset?.boltzCurrency) return undefined
  return {
    boltzCurrency: routeAsset.boltzCurrency,
    assetAddress: routeAsset.address,
    decimals: routeAsset.decimals,
    quoteCurrency,
  }
}

function swapInRouteVia(intent: EvmResolvedPaymentIntent): SwapInRequest['routeVia'] | undefined {
  const routeVia = intent.asset.boltzRouteVia ?? defaultRouteVia(intent)
  if (!routeVia) return undefined
  const quoteCurrency = routeVia.quoteCurrency ?? boltzQuoteCurrency(intent)
  if (!quoteCurrency) return undefined
  return {
    boltzCurrency: routeVia.boltzCurrency,
    assetAddress: routeVia.assetAddress,
    decimals: routeVia.decimals,
    quoteCurrency,
  }
}

type EvmRecycleArgs = {
  version: 1
  type: 'evm:multi-escrow-recycle-v1'
  source: {
    tradeId: string
    settlementId: string
    policyType: string
  }
  target: {
    chainId: number
    contractAddress: `0x${string}`
    contractBytecodeHash: `0x${string}`
    buyerAddress: `0x${string}`
    sellerAddress: `0x${string}`
    arbiterAddress: `0x${string}`
    assetAddress: `0x${string}`
    paymentAmount: string
    bondAmount: string
    timeoutClaimantAddress: `0x${string}`
    escrowFee: string
    contextHash: EvmHex
    recycleCovenantHash: EvmHex
    covenantHash: EvmHex
    order?: Record<string, unknown>
  }
}

function paymentProof(options: {
  txHash: `0x${string}`
  policyId: string
  policyType: string
  policyHash: `0x${string}`
  chainId: number
  contractAddress: `0x${string}`
  tradeId: string
  buyerAddress: `0x${string}`
  sellerAddress: `0x${string}`
  arbiterAddress: `0x${string}`
  assetAddress: `0x${string}`
  value: bigint
  bondAmount: bigint
  currency?: string
  denomination: string
  decimals: number
  escrowFee: bigint
  fundedValue: bigint
  unlockAt: bigint
  timeoutClaimantAddress: `0x${string}`
  contextHash: EvmHex
  recycleCovenantHash: EvmHex
  recycleArgs?: EvmRecycleArgs
}): GenericPaymentProof {
  const terms = evmPaymentTerms(options)
  return {
    driver: 'evm',
    terms,
    params: {
      txHash: options.txHash,
      policyId: options.policyId,
      policyType: options.policyType,
      policyHash: options.policyHash,
      contractBytecodeHash: options.policyHash,
      chainId: options.chainId,
      contractAddress: options.contractAddress,
      tradeId: options.tradeId,
      buyerAddress: options.buyerAddress,
      sellerAddress: options.sellerAddress,
      arbiterAddress: options.arbiterAddress,
      assetAddress: options.assetAddress,
      value: options.value.toString(),
      paymentAmount: options.value.toString(),
      fundedValue: options.fundedValue.toString(),
      bondAmount: options.bondAmount.toString(),
      ...(options.currency ? { currency: options.currency } : {}),
      denomination: options.denomination,
      decimals: options.decimals,
      escrowFee: options.escrowFee.toString(),
      unlockAt: options.unlockAt.toString(),
      timeoutClaimantAddress: options.timeoutClaimantAddress,
      contextHash: options.contextHash,
      recycleCovenantHash: options.recycleCovenantHash,
      ...(options.recycleArgs ? { recycleArgs: options.recycleArgs } : {}),
    },
  }
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => `${JSON.stringify(key)}:${sortedJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function paymentContextHash(input: {
  purpose: 'order' | 'bid'
  tradeId: string
  settlementId: string
  chainId: number
  assetAddress: `0x${string}`
  amount: string
  denomination: string
  decimals: number
  listingAnchor?: unknown
}): EvmHex {
  return keccak256(toHex(sortedJson(input)))
}

function targetOrderContext(value: unknown, fallbackListingAnchor?: unknown): Record<string, unknown> {
  const order = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const context: Record<string, unknown> = {}
  const listingAnchor = typeof order.listingAnchor === 'string' && order.listingAnchor.length > 0
    ? order.listingAnchor
    : typeof fallbackListingAnchor === 'string' && fallbackListingAnchor.length > 0
      ? fallbackListingAnchor
      : undefined
  if (listingAnchor) context.listingAnchor = listingAnchor
  for (const key of ['start', 'end', 'quantity', 'recipient'] as const) {
    if (order[key] !== undefined) context[key] = order[key]
  }
  return context
}

function auctionOrderContextHash(input: {
  chainId: number
  contractAddress: `0x${string}`
  assetAddress: `0x${string}`
  denomination: string
  decimals: number
  buyerAddress: `0x${string}`
  sellerAddress: `0x${string}`
  arbiterAddress: `0x${string}`
  order: Record<string, unknown>
}): EvmHex {
  return keccak256(toHex(sortedJson({
    version: 1,
    type: 'evm:multi-escrow-auction-target-order-v1',
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    assetAddress: input.assetAddress,
    denomination: input.denomination,
    decimals: input.decimals,
    buyerAddress: input.buyerAddress,
    sellerAddress: input.sellerAddress,
    arbiterAddress: input.arbiterAddress,
    order: input.order,
  })))
}

function recycleCovenantHash(input: {
  buyerAddress: `0x${string}`
  sellerAddress: `0x${string}`
  arbiterAddress: `0x${string}`
  assetAddress: `0x${string}`
  paymentAmount: bigint
  bondAmount: bigint
  timeoutClaimantAddress: `0x${string}`
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

function recycleArgs(options: {
  intent: ReturnType<typeof resolveEvmPaymentIntent>
  buyerAddress: `0x${string}`
  escrowPaymentAmount: { value: bigint; denomination: string; decimals: number }
  contextHash: EvmHex
  covenantHash: EvmHex
  order: Record<string, unknown>
}): EvmRecycleArgs {
  return {
    version: 1,
    type: 'evm:multi-escrow-recycle-v1',
    source: {
      tradeId: options.intent.tradeId,
      settlementId: options.intent.settlementId,
      policyType: options.intent.policy.type,
    },
    target: {
      chainId: options.intent.chain.chainId,
      contractAddress: options.intent.contractAddress,
      contractBytecodeHash: options.intent.contractBytecodeHash,
      buyerAddress: options.buyerAddress,
      sellerAddress: options.intent.sellerAddress,
      arbiterAddress: options.intent.arbiterAddress,
      assetAddress: options.intent.asset.assetAddress,
      paymentAmount: options.escrowPaymentAmount.value.toString(),
      bondAmount: '0',
      timeoutClaimantAddress: options.intent.sellerAddress,
      escrowFee: options.intent.fee.value.toString(),
      contextHash: options.contextHash,
      recycleCovenantHash: zeroHash,
      covenantHash: options.covenantHash,
      ...(Object.keys(options.order).length > 0 ? { order: options.order } : {}),
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function failedSwapStatus(status: string): boolean {
  return /failed|expired|refunded/i.test(status)
}

async function waitForSwapLockTransaction(
  evm: ReturnType<typeof createMarketplaceEvmClient>,
  operationId: string,
): Promise<EvmHash> {
  const deadline = Date.now() + swapPaymentTimeoutMs
  let lastStatus: string | undefined

  while (Date.now() < deadline) {
    const resumed = await evm.swaps?.resume(operationId)
    const status = resumed?.latestStatus?.status
    if (status && status !== lastStatus) lastStatus = status
    const txHash = resumed?.latestStatus?.transaction?.id ?? resumed?.latestStatus?.transactionHash
    if (txHash) return txHash
    if (status && failedSwapStatus(status)) {
      throw new Error(`Boltz swap failed with ${status}`)
    }
    await sleep(swapPollIntervalMs)
  }

  throw new Error(`Timed out waiting for Boltz swap lock transaction; last status: ${lastStatus ?? 'unknown'}`)
}

export async function* payEvmIntent(request: EvmPayRequest): AsyncIterable<GenericPolicyPaymentState> {
  const intent = resolveEvmPaymentIntent(request.chains, request.intent)
  logEvmPay(request, 'info', 'Resolved EVM payment intent', {
    purpose: intent.purpose,
    settlementId: intent.settlementId,
    tradeIndex: intent.accountIndex,
    chainId: intent.chain.chainId,
    denomination: intent.amount.denomination,
    amount: intent.amount.value.toString(),
  })
  const evm = createMarketplaceEvmClient({
    chains: request.chains,
    operationStore: request.operationStore,
    seed: intent.seed,
    tradeIndex: intent.accountIndex,
    ...(intent.chain.boltz ? { boltz: intent.chain.boltz } : {}),
    ...(request.logger ? { logger: request.logger } : {}),
  })
  if (!evm.executor) throw new Error('EVM deterministic AA execution is unavailable')

  const buyerAddress = await evm.executor.getAddress(intent.chain.chainId)
  logEvmPay(request, 'debug', 'Resolved EVM buyer account', {
    buyerAddress,
    chainId: intent.chain.chainId,
    tradeIndex: intent.accountIndex,
  })
  const escrowPaymentAmount = {
    ...intent.amount,
    value: intent.amount.value + intent.fee.value,
  }
  const targetOrder = targetOrderContext(intent.metadata?.targetOrder, intent.metadata?.targetListingAnchor)
  const contextHash = intent.purpose === 'bid'
    ? auctionOrderContextHash({
        chainId: intent.chain.chainId,
        contractAddress: intent.contractAddress,
        assetAddress: intent.asset.assetAddress,
        denomination: intent.amount.denomination,
        decimals: intent.amount.decimals,
        buyerAddress,
        sellerAddress: intent.sellerAddress,
        arbiterAddress: intent.arbiterAddress,
        order: targetOrder,
      })
    : paymentContextHash({
        purpose: intent.purpose,
        tradeId: intent.tradeId,
        settlementId: intent.settlementId,
        chainId: intent.chain.chainId,
        assetAddress: intent.asset.assetAddress,
        amount: intent.amount.value.toString(),
        denomination: intent.amount.denomination,
        decimals: intent.amount.decimals,
        listingAnchor: intent.metadata?.listingAnchor,
      })
  const timeoutClaimantAddress = intent.purpose === 'bid' ? buyerAddress : intent.sellerAddress
  const recycleCovenantHashValue = intent.purpose === 'bid'
    ? recycleCovenantHash({
        buyerAddress,
        sellerAddress: intent.sellerAddress,
        arbiterAddress: intent.arbiterAddress,
        assetAddress: intent.asset.assetAddress,
        paymentAmount: escrowPaymentAmount.value,
        bondAmount: 0n,
        timeoutClaimantAddress: intent.sellerAddress,
        escrowFee: intent.fee.value,
        contextHash,
      })
    : zeroHash
  const bidRecycleArgs = intent.purpose === 'bid'
    ? recycleArgs({
        intent,
        buyerAddress,
        escrowPaymentAmount,
        contextHash,
        covenantHash: recycleCovenantHashValue,
        order: targetOrder,
      })
    : undefined
  const calls = evm.escrow.createTrade({
    tradeId: intent.settlementId,
    buyerAddress,
    sellerAddress: intent.sellerAddress,
    arbiterAddress: intent.arbiterAddress,
    assetAddress: intent.asset.assetAddress,
    paymentAmount: escrowPaymentAmount,
    escrowFee: intent.fee,
    contractAddress: intent.contractAddress,
    unlockAt: intent.unlockAt,
    timeoutClaimantAddress,
    contextHash,
    recycleCovenantHash: recycleCovenantHashValue,
  })

  const balance =
    intent.asset.assetAddress.toLowerCase() === zeroAddress
      ? await intent.chain.publicClient.getBalance({ address: buyerAddress })
      : ((await intent.chain.publicClient.readContract({
          address: intent.asset.assetAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [buyerAddress],
        })) as bigint)
  const requiredBalance = escrowPaymentAmount.value
  logEvmPay(request, 'debug', 'Checked EVM escrow funding balance', {
    balance: balance.toString(),
    requiredBalance: requiredBalance.toString(),
    denomination: intent.amount.denomination,
    chainId: intent.chain.chainId,
  })

  if (balance >= requiredBalance) {
    logEvmPay(request, 'info', 'Funding escrow directly from EVM balance', {
      settlementId: intent.settlementId,
      tradeIndex: intent.accountIndex,
    })
    const execution = await evm.executor.execute(calls, {
      chainId: intent.chain.chainId,
      operationId: `escrow-${intent.settlementId}`,
      waitForReceipt: true,
    })
    const validation = await evm.escrow.validate({
      chainId: intent.chain.chainId,
      txHash: execution.txHash,
      tradeId: intent.settlementId,
      contractAddress: intent.contractAddress,
      contractBytecodeHash: intent.contractBytecodeHash,
      sellerAddress: intent.sellerAddress,
      arbiterAddress: intent.arbiterAddress,
      assetAddress: intent.asset.assetAddress,
      paymentAmount: intent.amount,
      bondAmount: { value: 0n, denomination: intent.amount.denomination, decimals: intent.amount.decimals },
      unlockAt: intent.unlockAt,
      timeoutClaimantAddress,
      escrowFee: intent.fee,
      contextHash,
      recycleCovenantHash: recycleCovenantHashValue,
      minConfirmations: 1,
    })
    request.setState({
      ...request.state,
      nextTradeIndex: intent.accountIndex + 1,
      maxUsedIndex: Math.max(request.state.maxUsedIndex, intent.accountIndex),
    })
    logEvmPay(request, 'info', 'EVM escrow funded directly', {
      txHash: execution.txHash,
      validationStatus: validation.status,
      settlementId: intent.settlementId,
    })
    yield {
      type: 'paid',
      proof: paymentProof({
        txHash: execution.txHash,
        policyId: intent.policy.id,
        policyType: intent.policy.type,
        policyHash: intent.contractBytecodeHash,
        chainId: intent.chain.chainId,
        contractAddress: intent.contractAddress,
        tradeId: intent.settlementId,
        buyerAddress,
        sellerAddress: intent.sellerAddress,
        arbiterAddress: intent.arbiterAddress,
        assetAddress: intent.asset.assetAddress,
        value: intent.amount.value,
        bondAmount: 0n,
        ...(intent.amount.currency ? { currency: intent.amount.currency } : {}),
        denomination: intent.amount.denomination,
        decimals: intent.amount.decimals,
        escrowFee: intent.fee.value,
        fundedValue: escrowPaymentAmount.value,
        unlockAt: intent.unlockAt,
        timeoutClaimantAddress,
        contextHash,
        recycleCovenantHash: recycleCovenantHashValue,
        ...(bidRecycleArgs ? { recycleArgs: bidRecycleArgs } : {}),
      }),
      data: {
        method: 'evm',
        purpose: intent.purpose,
        tradeIndex: intent.accountIndex,
        txHash: execution.txHash,
        validationStatus: validation.status,
        buyerAddress,
      },
    }
    return
  }

  if (!evm.swaps || !intent.asset.boltzCurrency) {
    throw new Error(`Insufficient ${intent.asset.denomination} balance and no Boltz swap route is configured`)
  }

  logEvmPay(request, 'info', 'Creating Boltz swap-in for EVM escrow funding', {
    settlementId: intent.settlementId,
    tradeIndex: intent.accountIndex,
    boltzCurrency: intent.asset.boltzCurrency,
    amount: escrowPaymentAmount.value.toString(),
  })
  const routeVia = swapInRouteVia(intent)
  const swap = await evm.swaps.swapIn({
    tradeIndex: intent.accountIndex,
    attemptIndex: 0,
    chainId: intent.chain.chainId,
    boltzCurrency: intent.asset.boltzCurrency,
    assetAddress: intent.asset.assetAddress,
    amount: escrowPaymentAmount,
    description: intent.description,
    ...(routeVia ? { routeVia } : {}),
    postClaimCalls: calls,
  })
  if (swap.type !== 'external_payment_required') throw new Error('Unexpected swap-in result')
  logEvmPay(request, 'info', 'External Lightning payment required for EVM swap-in', {
    swapId: swap.swapId,
    preimageHash: swap.preimageHash,
    tradeIndex: intent.accountIndex,
    limits: swap.limits,
  })

  request.setState({
    ...request.state,
    nextTradeIndex: intent.accountIndex + 1,
    maxUsedIndex: Math.max(request.state.maxUsedIndex, intent.accountIndex),
  })
  yield {
    type: 'payment_required',
    request: {
      type: 'bolt11',
      bolt11: swap.invoice,
      amount: {
        value: escrowPaymentAmount.value.toString(),
        denomination: escrowPaymentAmount.denomination,
        decimals: escrowPaymentAmount.decimals,
      },
      description: intent.description,
      data: {
        method: 'evm',
        purpose: intent.purpose,
        swapId: swap.swapId,
        preimageHash: swap.preimageHash,
        tradeIndex: intent.accountIndex,
        buyerAddress,
        limits: swap.limits,
      },
    },
    proof: null,
    data: {
      method: 'evm',
      purpose: intent.purpose,
      swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
      limits: swap.limits,
    },
  }

  yield {
    type: 'payment_progress',
    status: 'Waiting for Lightning payment',
    data: {
        method: 'evm',
        purpose: intent.purpose,
        swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
    },
  }
  logEvmPay(request, 'info', 'Waiting for Lightning payment', {
    swapId: swap.swapId,
    tradeIndex: intent.accountIndex,
  })

  const lockTxHash = await waitForSwapLockTransaction(evm, swap.operation.id)
  logEvmPay(request, 'info', 'Boltz lock transaction detected', {
    swapId: swap.swapId,
    txHash: lockTxHash,
    tradeIndex: intent.accountIndex,
  })
  yield {
    type: 'payment_progress',
    status: 'Boltz lock transaction detected',
    data: {
      method: 'evm',
      purpose: intent.purpose,
      swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
      txHash: lockTxHash,
    },
  }

  const receipt = await intent.chain.publicClient.waitForTransactionReceipt({ hash: lockTxHash })
  if (receipt.status !== 'success') throw new Error(`Boltz lock transaction reverted: ${lockTxHash}`)
  const claimAssetAddress = swap.claimAssetAddress ?? intent.asset.assetAddress
  const lockup = findErc20SwapLockup(receipt.logs, {
    transactionHash: lockTxHash,
    preimageHash: swap.preimageHash,
    claimAddress: buyerAddress,
    tokenAddress: claimAssetAddress,
  })

  logEvmPay(request, 'info', 'Claiming Boltz swap into escrow', {
    swapId: swap.swapId,
    lockTxHash,
    tradeIndex: intent.accountIndex,
  })
  yield {
    type: 'payment_progress',
    status: 'Claiming swap into escrow',
    data: {
      method: 'evm',
      purpose: intent.purpose,
      swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
      txHash: lockTxHash,
    },
  }

  const execution = await evm.executor.execute(
    [
      erc20SwapClaimCall({
        contractAddress: lockup.contractAddress,
        preimage: swap.preimage!,
        amount: lockup.amount,
        tokenAddress: lockup.tokenAddress,
        refundAddress: lockup.refundAddress,
        timelock: lockup.timelock,
      }),
      ...(swap.postClaimCalls ?? calls),
    ],
    {
      chainId: intent.chain.chainId,
      operationId: `claim-${swap.operation.id}`,
      waitForReceipt: true,
    },
  )
  const validation = await evm.escrow.validate({
    chainId: intent.chain.chainId,
    txHash: execution.txHash,
    tradeId: intent.settlementId,
    contractAddress: intent.contractAddress,
    contractBytecodeHash: intent.contractBytecodeHash,
    sellerAddress: intent.sellerAddress,
    arbiterAddress: intent.arbiterAddress,
    assetAddress: intent.asset.assetAddress,
    paymentAmount: intent.amount,
    bondAmount: { value: 0n, denomination: intent.amount.denomination, decimals: intent.amount.decimals },
    unlockAt: intent.unlockAt,
    timeoutClaimantAddress,
    escrowFee: intent.fee,
    contextHash,
    recycleCovenantHash: recycleCovenantHashValue,
    minConfirmations: 1,
  })
  swap.operation.status = 'completed'
  swap.operation.txHash = execution.txHash
  swap.operation.updatedAt = Math.floor(Date.now() / 1000)
  swap.operation.data = {
    ...swap.operation.data,
    lockTxHash,
    claimTxHash: execution.txHash,
    validationStatus: validation.status,
    purpose: intent.purpose,
  }
  await request.operationStore.put(swap.operation)
  logEvmPay(request, 'info', 'EVM swap claimed and escrow funded', {
    swapId: swap.swapId,
    lockTxHash,
    claimTxHash: execution.txHash,
    validationStatus: validation.status,
    settlementId: intent.settlementId,
  })

  yield {
    type: 'paid',
    proof: paymentProof({
      txHash: execution.txHash,
      policyId: intent.policy.id,
      policyType: intent.policy.type,
      policyHash: intent.contractBytecodeHash,
      chainId: intent.chain.chainId,
      contractAddress: intent.contractAddress,
      tradeId: intent.settlementId,
      buyerAddress,
      sellerAddress: intent.sellerAddress,
      arbiterAddress: intent.arbiterAddress,
      assetAddress: intent.asset.assetAddress,
      value: intent.amount.value,
      bondAmount: 0n,
      ...(intent.amount.currency ? { currency: intent.amount.currency } : {}),
      denomination: intent.amount.denomination,
      decimals: intent.amount.decimals,
      escrowFee: intent.fee.value,
      fundedValue: escrowPaymentAmount.value,
      unlockAt: intent.unlockAt,
      timeoutClaimantAddress,
      contextHash,
      recycleCovenantHash: recycleCovenantHashValue,
      ...(bidRecycleArgs ? { recycleArgs: bidRecycleArgs } : {}),
    }),
    data: {
      method: 'evm',
      purpose: intent.purpose,
      tradeIndex: intent.accountIndex,
      txHash: execution.txHash,
      validationStatus: validation.status,
      buyerAddress,
      swapId: swap.swapId,
      lockTxHash,
    },
  }
}
