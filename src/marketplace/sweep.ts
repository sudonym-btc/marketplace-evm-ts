import { multiEscrowAbi } from '@sudonym-btc/marketplace-evm-contracts'
import { isMarketplaceDriverEncryptedPaymentProofParams } from '@sudonym-btc/marketplace-driver-interface'

import type { MarketplaceEvmClient } from '../client.js'
import { createEvmEscrowCallBuilder } from '../escrow/callBuilder.js'
import { deriveEvmSwapMaterial } from '../seed.js'
import { btcAmountToSats } from '../swaps/amounts.js'
import { erc20SwapLockCalls } from '../swaps/erc20Swap.js'
import type { SwapOutRequest } from '../swaps/types.js'
import type { EvmAddress, EvmAmount, EvmAsset, EvmOperationStore } from '../types.js'
import { normalizeAddress, zeroAddress } from '../utils/hex.js'
import { evmPayoutInvoiceDescription } from './invoices.js'
import type {
  EvmMarketplacePolicyState,
  GenericBolt11PaymentRequest,
  GenericPaymentSweepInput,
  GenericPaymentSweepState,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

type EvmSweepOptions = {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmOperationStore
  state: EvmMarketplacePolicyState
  payment: GenericPaymentSweepInput
  client(seed: string, tradeIndex?: number): MarketplaceEvmClient
  createPayoutInvoice(options: {
    tradeId: string
    amountSats: number
    description?: string
  }): Promise<GenericBolt11PaymentRequest>
}

type EvmProofParams = {
  chainId: number
  contractAddress: EvmAddress
  tradeId: string
  buyerAddress?: EvmAddress
  sellerAddress?: EvmAddress
  arbiterAddress?: EvmAddress
  timeoutClaimantAddress?: EvmAddress
}

type LocalBeneficiary = {
  tradeIndex: number
  address: EvmAddress
}

type WithdrawableBalance = {
  tokenAddress: EvmAddress
  amount: bigint
}

const withdrawTypes = {
  Withdraw: [
    { name: 'token', type: 'address' },
    { name: 'destination', type: 'address' },
  ],
} as const

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}`)
  return value
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid ${label}`)
  return value
}

function optionalAddress(value: unknown, label: string): EvmAddress | undefined {
  if (value === undefined || value === null) return undefined
  return normalizeAddress(stringValue(value, label), label)
}

function proofParams(payment: GenericPaymentSweepInput): EvmProofParams {
  if (isMarketplaceDriverEncryptedPaymentProofParams(payment.proof.params)) {
    throw new Error('EVM sweep requires clear payment proof params')
  }
  const params = payment.proof.params as Record<string, unknown>
  const chainId = numberValue(params.chainId, 'chainId')
  const contractAddress = optionalAddress(params.contractAddress, 'contractAddress') ?? zeroAddress
  const buyerAddress = optionalAddress(params.buyerAddress, 'buyerAddress')
  const sellerAddress = optionalAddress(params.sellerAddress, 'sellerAddress')
  const arbiterAddress = optionalAddress(params.arbiterAddress, 'arbiterAddress')
  const timeoutClaimantAddress = optionalAddress(params.timeoutClaimantAddress, 'timeoutClaimantAddress')
  return {
    chainId,
    contractAddress,
    tradeId: stringValue(params.tradeId ?? payment.tradeId, 'tradeId'),
    ...(buyerAddress ? { buyerAddress } : {}),
    ...(sellerAddress ? { sellerAddress } : {}),
    ...(arbiterAddress ? { arbiterAddress } : {}),
    ...(timeoutClaimantAddress ? { timeoutClaimantAddress } : {}),
  }
}

function chainFor(chains: ResolvedEvmMarketplaceChainConfig[], chainId: number): ResolvedEvmMarketplaceChainConfig {
  const chain = chains.find(candidate => candidate.chainId === chainId)
  if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${chainId}`)
  return chain
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

function sameBoltzCurrency(value: string | undefined, expected: string): boolean {
  return value?.toUpperCase() === expected.toUpperCase()
}

function boltzQuoteCurrency(chain: ResolvedEvmMarketplaceChainConfig): string | undefined {
  return chain.boltzCurrency ?? chain.boltz?.nativeCurrencyByChainId?.[chain.chainId]
}

function assetForToken(chain: ResolvedEvmMarketplaceChainConfig, tokenAddress: EvmAddress): EvmAsset | undefined {
  return [chain.nativeAsset, ...(chain.assets ?? [])].find(asset => sameAddress(asset.address, tokenAddress))
}

function isEvmSweepDriver(driver: string): boolean {
  return driver === 'evm' || driver.startsWith('evm:')
}

function defaultRouteVia(
  chain: ResolvedEvmMarketplaceChainConfig,
  asset: EvmAsset,
): SwapOutRequest['routeVia'] | undefined {
  if (!sameBoltzCurrency(asset.boltzCurrency, 'USDT')) return undefined
  const quoteCurrency = boltzQuoteCurrency(chain)
  if (!quoteCurrency) return undefined
  const routeAsset = [chain.nativeAsset, ...(chain.assets ?? [])].find(candidate =>
    sameBoltzCurrency(candidate.boltzCurrency, 'tBTC'),
  )
  if (!routeAsset?.boltzCurrency) return undefined
  return {
    boltzCurrency: routeAsset.boltzCurrency,
    assetAddress: routeAsset.address,
    decimals: routeAsset.decimals,
    quoteCurrency,
  }
}

function swapOutRouteVia(
  chain: ResolvedEvmMarketplaceChainConfig,
  asset: EvmAsset,
): SwapOutRequest['routeVia'] | undefined {
  const routeVia = asset.boltzRouteVia ?? defaultRouteVia(chain, asset)
  if (!routeVia) return undefined
  const quoteCurrency = routeVia.quoteCurrency ?? boltzQuoteCurrency(chain)
  if (!quoteCurrency) return undefined
  return {
    boltzCurrency: routeVia.boltzCurrency,
    assetAddress: routeVia.assetAddress,
    decimals: routeVia.decimals,
    quoteCurrency,
  }
}

function candidateIndexes(state: EvmMarketplacePolicyState, payment: GenericPaymentSweepInput): number[] {
  const accountIndex = payment.accountIndex
  const maxIndex = Math.max(
    state.maxUsedIndex,
    state.nextTradeIndex - 1,
    accountIndex ?? -1,
  )
  const indexes = new Set<number>()
  if (accountIndex !== undefined && Number.isSafeInteger(accountIndex) && accountIndex >= 0) {
    indexes.add(accountIndex)
  }
  for (let index = 0; index <= maxIndex; index += 1) indexes.add(index)
  return [...indexes].sort((left, right) => left - right)
}

async function readWithdrawableBalances(
  chain: ResolvedEvmMarketplaceChainConfig,
  contractAddress: EvmAddress,
  beneficiary: EvmAddress,
): Promise<WithdrawableBalance[]> {
  const [tokens, amounts] = await chain.publicClient.readContract({
    address: contractAddress,
    abi: multiEscrowAbi,
    functionName: 'balanceOf',
    args: [beneficiary],
  }) as readonly [readonly EvmAddress[], readonly bigint[]]
  return tokens
    .map((tokenAddress, index) => ({ tokenAddress, amount: amounts[index] ?? 0n }))
    .filter(balance => balance.amount > 0n)
}

async function discoverLocalBeneficiary(
  client: MarketplaceEvmClient,
  chain: ResolvedEvmMarketplaceChainConfig,
  params: EvmProofParams,
  state: EvmMarketplacePolicyState,
  payment: GenericPaymentSweepInput,
): Promise<{ beneficiary: LocalBeneficiary; balances: WithdrawableBalance[] } | null> {
  if (!client.accounts) return null
  const proofAddresses = [
    params.buyerAddress,
    params.sellerAddress,
    params.arbiterAddress,
    params.timeoutClaimantAddress,
  ].filter((value): value is EvmAddress => Boolean(value))
  const normalizedProofAddresses = new Set(proofAddresses.map(address => address.toLowerCase()))
  if (normalizedProofAddresses.size === 0) return null

  for (const tradeIndex of candidateIndexes(state, payment)) {
    const address = await client.accounts.smartAccountAddress(tradeIndex, chain.chainId)
    if (!normalizedProofAddresses.has(address.toLowerCase())) continue
    const balances = await readWithdrawableBalances(chain, params.contractAddress, address)
    if (balances.length > 0) return { beneficiary: { tradeIndex, address }, balances }
  }
  return null
}

function amountForBalance(asset: EvmAsset, amount: bigint): EvmAmount {
  return {
    value: amount,
    denomination: asset.denomination,
    decimals: asset.decimals,
  }
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor
}

function satsToBtcTokenAmount(sats: number, decimals: number): bigint {
  if (!Number.isSafeInteger(sats) || sats < 0) throw new Error(`Invalid sat amount: ${sats}`)
  if (!Number.isSafeInteger(decimals) || decimals < 0) throw new Error(`Invalid BTC token decimals: ${decimals}`)
  return ceilDiv(BigInt(sats) * (10n ** BigInt(decimals)), 100_000_000n)
}

async function signWithdraw(options: {
  client: MarketplaceEvmClient
  tradeIndex: number
  chainId: number
  contractAddress: EvmAddress
  tokenAddress: EvmAddress
  destinationAddress: EvmAddress
}) {
  const owner = options.client.accounts?.ownerAccount(options.tradeIndex, options.chainId)
  if (!owner) throw new Error('EVM sweep requires a marketplace seed')
  return owner.signTypedData({
    domain: {
      name: 'Nostr MultiEscrow',
      version: '6',
      chainId: options.chainId,
      verifyingContract: options.contractAddress,
    },
    types: withdrawTypes,
    primaryType: 'Withdraw',
    message: {
      token: options.tokenAddress,
      destination: options.destinationAddress,
    },
  })
}

export async function* sweepEvmMarketplacePayment(options: EvmSweepOptions): AsyncIterable<GenericPaymentSweepState> {
  const payment = options.payment
  if (!isEvmSweepDriver(payment.proof.driver)) {
    yield { type: 'noop', data: { reason: `EVM policy cannot sweep ${payment.proof.driver}` } }
    return
  }
  if (!payment.seed) {
    yield {
      type: 'noop',
      data: {
        reason: 'EVM sweep requires the local marketplace seed',
        paymentId: payment.paymentId,
      },
    }
    return
  }
  const seed = payment.seed

  const params = proofParams(payment)
  const chain = chainFor(options.chains, params.chainId)
  const contractAddress = sameAddress(params.contractAddress, zeroAddress)
    ? chain.multiEscrowAddress
    : params.contractAddress
  const discoveryClient = options.client(seed)
  const discovered = await discoverLocalBeneficiary(
    discoveryClient,
    chain,
    { ...params, contractAddress },
    options.state,
    payment,
  )
  if (!discovered) {
    yield {
      type: 'noop',
      data: {
        reason: 'No local EVM beneficiary has a withdrawable escrow balance',
        paymentId: payment.paymentId,
        tradeId: params.tradeId,
        chainId: chain.chainId,
      },
    }
    return
  }

  const sweeps: Array<Record<string, unknown>> = []
  for (const balance of discovered.balances) {
    const asset = assetForToken(chain, balance.tokenAddress)
    if (!asset?.boltzCurrency) {
      yield thisProgress('EVM escrow balance cannot be swept without a Boltz currency', {
        tokenAddress: balance.tokenAddress,
        amount: balance.amount.toString(),
      })
      continue
    }

    const sweepClient = options.client(seed, discovered.beneficiary.tradeIndex)
    if (!sweepClient.swaps || !sweepClient.executor) {
      yield thisProgress('EVM Boltz swap-out is not configured for this chain', {
        tokenAddress: balance.tokenAddress,
        amount: balance.amount.toString(),
      })
      continue
    }

    const destinationAddress = discovered.beneficiary.address
    const signature = await signWithdraw({
      client: sweepClient,
      tradeIndex: discovered.beneficiary.tradeIndex,
      chainId: chain.chainId,
      contractAddress,
      tokenAddress: balance.tokenAddress,
      destinationAddress,
    })
    const withdrawCall = createEvmEscrowCallBuilder().withdraw({
      assetAddress: balance.tokenAddress,
      beneficiaryAddress: discovered.beneficiary.address,
      destinationAddress,
      contractAddress,
      signature,
    })
    const routeVia = swapOutRouteVia(chain, asset)
    const baseSwapRequest = {
      tradeIndex: discovered.beneficiary.tradeIndex,
      attemptIndex: 0,
      chainId: chain.chainId,
      boltzCurrency: asset.boltzCurrency,
      lightningCurrency: 'BTC',
      assetAddress: balance.tokenAddress,
      amount: amountForBalance(asset, balance.amount),
      invoiceDescription: evmPayoutInvoiceDescription(params.tradeId),
      preLockCalls: [withdrawCall],
      ...(routeVia ? { routeVia } : {}),
    } satisfies SwapOutRequest

    const invoiceRequest = await sweepClient.swaps.swapOut(baseSwapRequest)
    if (
      invoiceRequest.type !== 'external_invoice_required'
      || (invoiceRequest.invoiceAmountSats === undefined && !invoiceRequest.amount)
    ) {
      yield thisProgress('EVM swap-out did not return an invoiceable amount', {
        tokenAddress: balance.tokenAddress,
        operationId: invoiceRequest.operation.id,
      })
      continue
    }

    const amountSats = invoiceRequest.invoiceAmountSats ?? btcAmountToSats(invoiceRequest.amount!)
    const invoice = await options.createPayoutInvoice({
      tradeId: params.tradeId,
      amountSats,
      description: evmPayoutInvoiceDescription(params.tradeId),
    })
    yield thisProgress('Created EVM payout invoice', {
      tokenAddress: balance.tokenAddress,
      amountSats,
      operationId: invoiceRequest.operation.id,
    })

    const swap = await sweepClient.swaps.swapOut({
      ...baseSwapRequest,
      invoice: invoice.bolt11,
    })
    if (swap.type !== 'awaiting_resolution') {
      yield thisProgress('EVM swap-out did not require an on-chain lock', {
        tokenAddress: balance.tokenAddress,
        operationId: swap.operation.id,
      })
      continue
    }
    if (!swap.expectedAmount || !swap.claimAddress || !swap.lockupAddress || !swap.lockAssetAddress) {
      yield thisProgress('EVM swap-out is waiting for missing Boltz lock details', {
        tokenAddress: balance.tokenAddress,
        operationId: swap.operation.id,
      })
      continue
    }

    const lockAsset = assetForToken(chain, swap.lockAssetAddress)
    if (!lockAsset) {
      yield thisProgress('EVM swap-out lock asset is not configured', {
        tokenAddress: balance.tokenAddress,
        lockAssetAddress: swap.lockAssetAddress,
        operationId: swap.operation.id,
      })
      continue
    }
    const lockAmount = satsToBtcTokenAmount(swap.expectedAmount, lockAsset.decimals)
    if (sameAddress(swap.lockAssetAddress, balance.tokenAddress) && lockAmount > balance.amount) {
      yield thisProgress('EVM payout swap lock amount exceeds withdrawable balance', {
        tokenAddress: balance.tokenAddress,
        amount: balance.amount.toString(),
        lockAssetAddress: swap.lockAssetAddress,
        lockAmount: lockAmount.toString(),
        operationId: swap.operation.id,
      })
      continue
    }
    const material = deriveEvmSwapMaterial(seed, {
      tradeIndex: discovered.beneficiary.tradeIndex,
      chainId: chain.chainId,
      direction: 'swap-out',
      attemptIndex: 0,
    })
    const lockCalls = erc20SwapLockCalls({
      contractAddress: swap.lockupAddress,
      preimageHash: material.preimageHash,
      amount: lockAmount,
      tokenAddress: swap.lockAssetAddress,
      claimAddress: swap.claimAddress,
      timelock: swap.timeoutBlockHeight,
    })
    const calls = [...(swap.preLockCalls ?? []), ...lockCalls]
    const execution = await sweepClient.executor.execute(calls, {
      chainId: chain.chainId,
      operationId: swap.operation.id,
    })
    swap.operation.status = 'locking'
    swap.operation.txHash = execution.txHash
    swap.operation.data = {
      ...swap.operation.data,
      lockTxHash: execution.txHash,
      lockAccountAddress: execution.accountAddress,
    }
    await options.operationStore.put(swap.operation)
    const sweep = {
      tokenAddress: balance.tokenAddress,
      amount: balance.amount.toString(),
      lockAssetAddress: swap.lockAssetAddress,
      amountSats,
      operationId: swap.operation.id,
      swapId: swap.swapId,
      txHash: execution.txHash,
    }
    sweeps.push(sweep)
    yield thisProgress('Submitted EVM payout swap lock transaction', sweep)
  }

  if (sweeps.length === 0) {
    yield {
      type: 'noop',
      data: {
        reason: 'No EVM escrow balances were sweepable',
        paymentId: payment.paymentId,
        tradeId: params.tradeId,
      },
    }
    return
  }

  yield {
    type: 'swept',
    proof: payment.proof,
    data: {
      paymentId: payment.paymentId,
      tradeId: params.tradeId,
      beneficiaryAddress: discovered.beneficiary.address,
      tradeIndex: discovered.beneficiary.tradeIndex,
      sweeps,
    },
  }
}

function thisProgress(status: string, data: Record<string, unknown>): GenericPaymentSweepState {
  return {
    type: 'progress',
    status,
    data,
  }
}
