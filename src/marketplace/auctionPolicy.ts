import { erc20Abi } from '../contracts/erc20.js'
import { createEvmAuctionValidator } from '../auction/validator.js'
import { resolveEvmChainConfigs } from '../chains.js'
import { createMarketplaceEvmClient } from '../client.js'
import { erc20SwapClaimCall, findErc20SwapLockup } from '../swaps/erc20Swap.js'
import type { EvmAddress, EvmAmount, EvmHash, EvmHex } from '../types.js'
import { zeroAddress } from '../utils/hex.js'
import { evmPaymentAssets } from './assets.js'
import { evmAuctionPolicies } from './policies.js'
import type {
  EvmAuctionPolicy,
  EvmMarketplacePolicyState,
  EvmMarketplacePolicyOptions,
  EvmPaymentAsset,
  GenericPolicyPaymentState,
  GenericPaymentIntent,
  GenericPaymentProof,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

const swapPollIntervalMs = 2_000
const swapPaymentTimeoutMs = 20 * 60_000

function address(value: string | undefined, label: string): EvmAddress {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid ${label}`)
  return value as EvmAddress
}

function hash(value: string | undefined, label: string): EvmHex {
  if (!value) throw new Error(`Invalid ${label}`)
  const normalized = value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error(`Invalid ${label}`)
  return normalized as EvmHex
}

function chainFor(chains: ResolvedEvmMarketplaceChainConfig[], chainId: number | undefined): ResolvedEvmMarketplaceChainConfig {
  if (chainId === undefined) throw new Error('EVM auction payment intent is missing chainId')
  const chain = chains.find(candidate => candidate.chainId === chainId)
  if (!chain) throw new Error(`No EVM marketplace chain configured for chainId ${chainId}`)
  return chain
}

function assetForIntent(chain: ResolvedEvmMarketplaceChainConfig, intent: GenericPaymentIntent): EvmPaymentAsset {
  const assetAddress = address(intent.asset.assetAddress, 'assetAddress')
  const asset = [chain.nativeAsset, ...(chain.assets ?? [])].find(
    candidate => candidate.address.toLowerCase() === assetAddress.toLowerCase(),
  )
  if (!asset) throw new Error(`No EVM asset configured for ${assetAddress} on chain ${chain.chainId}`)
  return {
    method: 'evm',
    assetId: `${chain.chainId}:${asset.address.toLowerCase()}`,
    denomination: asset.denomination,
    decimals: asset.decimals,
    appId: 'marketplace-evm-ts',
    chainId: chain.chainId,
    assetAddress: asset.address,
    ...(asset.boltzCurrency ? { boltzCurrency: asset.boltzCurrency } : {}),
  }
}

function evmAmount(amount: { value: string; denomination: string; decimals: number }, decimals: number): EvmAmount {
  return {
    value: BigInt(amount.value),
    denomination: amount.denomination,
    decimals,
  }
}

function failedSwapStatus(status: string): boolean {
  return /failed|expired|refunded/i.test(status)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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

function auctionPaymentProof(options: {
  txHash: EvmHash
  policyId: string
  policyHash: EvmHex
  chainId: number
  contractAddress: EvmAddress
  auctionId: string
  bidderAddress: EvmAddress
  sellerAddress: EvmAddress
  arbiterAddress: EvmAddress
  assetAddress: EvmAddress
  value: bigint
  denomination: string
  decimals: number
  escrowFee: bigint
}): GenericPaymentProof {
  return {
    method: 'evm',
    params: {
      txHash: options.txHash,
      policyId: options.policyId,
      policyType: 'evm:multi-auction',
      policyHash: options.policyHash,
      contractBytecodeHash: options.policyHash,
      chainId: options.chainId,
      contractAddress: options.contractAddress,
      auctionId: options.auctionId,
      bidderAddress: options.bidderAddress,
      sellerAddress: options.sellerAddress,
      arbiterAddress: options.arbiterAddress,
      assetAddress: options.assetAddress,
      value: options.value.toString(),
      denomination: options.denomination,
      decimals: options.decimals,
      escrowFee: options.escrowFee.toString(),
    },
  }
}

async function* payEvmAuctionIntent(options: {
  chains: ResolvedEvmMarketplaceChainConfig[]
  operationStore: EvmMarketplacePolicyOptions['operationStore']
  intent: GenericPaymentIntent
  state: EvmMarketplacePolicyState
  setState(state: EvmMarketplacePolicyState): void
}): AsyncIterable<GenericPolicyPaymentState> {
  const intent = options.intent
  if (intent.method !== 'evm') throw new Error(`EVM auction policy cannot pay ${intent.method} intent`)
  if (intent.subject !== 'bid') throw new Error(`EVM auction policy cannot pay ${intent.subject} intents`)
  if (!intent.seed) throw new Error('EVM auction payment requires a marketplace seed')

  const chain = chainFor(options.chains, intent.contract.chainId ?? intent.asset.chainId ?? intent.policy.chainId)
  const asset = assetForIntent(chain, intent)
  const contractAddress = address(intent.contract.address ?? intent.policy.contractAddress, 'contractAddress')
  const sellerAddress = address(intent.participants.seller.address, 'sellerAddress')
  const arbiterAddress = address(intent.participants.escrow.address, 'arbiterAddress')
  const contractBytecodeHash = hash(intent.contract.bytecodeHash ?? intent.policy.hash, 'contractBytecodeHash')
  const bidAmount = evmAmount(intent.amount, asset.decimals)
  const escrowFee = evmAmount(intent.fee, asset.decimals)
  const endsAt = BigInt(intent.unlockAt)
  const description = `Marketplace auction bid ${intent.settlementId}`

  const evm = createMarketplaceEvmClient({
    chains: options.chains,
    operationStore: options.operationStore,
    seed: intent.seed,
    tradeIndex: intent.accountIndex,
    ...(chain.boltz ? { boltz: chain.boltz } : {}),
  })
  if (!evm.executor) throw new Error('EVM deterministic AA execution is unavailable')

  const bidderAddress = await evm.executor.getAddress(chain.chainId)
  const calls = evm.auction.placeBid({
    auctionId: intent.settlementId,
    bidderAddress,
    sellerAddress,
    arbiterAddress,
    assetAddress: asset.assetAddress,
    bidAmount,
    escrowFee,
    endsAt,
    contractAddress,
  })

  const balance =
    asset.assetAddress.toLowerCase() === zeroAddress
      ? await chain.publicClient.getBalance({ address: bidderAddress })
      : ((await chain.publicClient.readContract({
          address: asset.assetAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [bidderAddress],
        })) as bigint)
  const requiredBalance = bidAmount.value

  if (balance >= requiredBalance) {
    const execution = await evm.executor.execute(calls, {
      chainId: chain.chainId,
      operationId: `auction-bid-${intent.settlementId}`,
      waitForReceipt: true,
    })
    options.setState({
      ...options.state,
      nextTradeIndex: intent.accountIndex + 1,
      maxUsedIndex: Math.max(options.state.maxUsedIndex, intent.accountIndex),
    })
    yield {
      type: 'paid',
      proof: auctionPaymentProof({
        txHash: execution.txHash,
        policyId: intent.policy.id,
        policyHash: contractBytecodeHash,
        chainId: chain.chainId,
        contractAddress,
        auctionId: intent.settlementId,
        bidderAddress,
        sellerAddress,
        arbiterAddress,
        assetAddress: asset.assetAddress,
        value: bidAmount.value,
        denomination: bidAmount.denomination,
        decimals: bidAmount.decimals,
        escrowFee: escrowFee.value,
      }),
      data: {
        method: 'evm',
        policyType: 'evm:multi-auction',
        tradeIndex: intent.accountIndex,
        txHash: execution.txHash,
        bidderAddress,
      },
    }
    return
  }

  if (!evm.swaps || !asset.boltzCurrency) {
    throw new Error(`Insufficient ${asset.denomination} balance and no Boltz swap route is configured`)
  }

  const swap = await evm.swaps.swapIn({
    tradeIndex: intent.accountIndex,
    attemptIndex: 0,
    chainId: chain.chainId,
    boltzCurrency: asset.boltzCurrency,
    assetAddress: asset.assetAddress,
    amount: bidAmount,
    description,
    postClaimCalls: calls,
  })
  if (swap.type !== 'external_payment_required') throw new Error('Unexpected swap-in result')

  options.setState({
    ...options.state,
    nextTradeIndex: intent.accountIndex + 1,
    maxUsedIndex: Math.max(options.state.maxUsedIndex, intent.accountIndex),
  })
  yield {
    type: 'payment_required',
    request: {
      type: 'bolt11',
      bolt11: swap.invoice,
      amount: intent.amount,
      description,
      data: {
        method: 'evm',
        policyType: 'evm:multi-auction',
        swapId: swap.swapId,
        preimageHash: swap.preimageHash,
        tradeIndex: intent.accountIndex,
        bidderAddress,
      },
    },
    proof: null,
    data: {
      method: 'evm',
      policyType: 'evm:multi-auction',
      swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
    },
  }

  yield {
    type: 'payment_progress',
    status: 'Waiting for Lightning payment',
    data: { method: 'evm', policyType: 'evm:multi-auction', swapId: swap.swapId, tradeIndex: intent.accountIndex },
  }

  const lockTxHash = await waitForSwapLockTransaction(evm, swap.operation.id)
  yield {
    type: 'payment_progress',
    status: 'Boltz lock transaction detected',
    data: { method: 'evm', policyType: 'evm:multi-auction', swapId: swap.swapId, tradeIndex: intent.accountIndex, txHash: lockTxHash },
  }

  const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: lockTxHash })
  if (receipt.status !== 'success') throw new Error(`Boltz lock transaction reverted: ${lockTxHash}`)
  const lockup = findErc20SwapLockup(receipt.logs, {
    transactionHash: lockTxHash,
    preimageHash: swap.preimageHash,
    claimAddress: bidderAddress,
    tokenAddress: asset.assetAddress,
  })

  yield {
    type: 'payment_progress',
    status: 'Claiming swap into auction',
    data: { method: 'evm', policyType: 'evm:multi-auction', swapId: swap.swapId, tradeIndex: intent.accountIndex, txHash: lockTxHash },
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
      ...calls,
    ],
    {
      chainId: chain.chainId,
      operationId: `auction-claim-${swap.operation.id}`,
      waitForReceipt: true,
    },
  )
  swap.operation.status = 'completed'
  swap.operation.txHash = execution.txHash
  swap.operation.updatedAt = Math.floor(Date.now() / 1000)
  swap.operation.data = {
    ...swap.operation.data,
    lockTxHash,
    claimTxHash: execution.txHash,
    policyType: 'evm:multi-auction',
  }
  await options.operationStore.put(swap.operation)

  yield {
    type: 'paid',
    proof: auctionPaymentProof({
      txHash: execution.txHash,
      policyId: intent.policy.id,
      policyHash: contractBytecodeHash,
      chainId: chain.chainId,
      contractAddress,
      auctionId: intent.settlementId,
      bidderAddress,
      sellerAddress,
      arbiterAddress,
      assetAddress: asset.assetAddress,
      value: bidAmount.value,
      denomination: bidAmount.denomination,
      decimals: bidAmount.decimals,
      escrowFee: escrowFee.value,
    }),
    data: {
      method: 'evm',
      policyType: 'evm:multi-auction',
      tradeIndex: intent.accountIndex,
      txHash: execution.txHash,
      bidderAddress,
      swapId: swap.swapId,
      lockTxHash,
    },
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}`)
  return value
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid ${label}`)
  return value
}

function genericAmount(
  preferred: GenericPaymentValidationRequest['expected']['amount'] | undefined,
  params: Record<string, unknown>,
): EvmAmount {
  const decimals = preferred?.decimals ?? numberValue(params.decimals, 'decimals')
  return {
    value: BigInt(preferred?.value ?? stringValue(params.value, 'auction bid amount')),
    denomination: preferred?.denomination ?? stringValue(params.denomination, 'denomination'),
    decimals,
  }
}

async function validateAuctionPayment(
  chains: ResolvedEvmMarketplaceChainConfig[],
  request: GenericPaymentValidationRequest,
): Promise<GenericPaymentValidationResult> {
  if (request.method !== 'evm' || request.proof.method !== 'evm') {
    return { method: 'evm', status: 'unverifiable', error: `EVM validator cannot validate ${request.method}` }
  }
  try {
    const params = request.proof.params
    const expected = request.expected
    const validator = createEvmAuctionValidator({ chains })
    const result = await validator.validate({
      chainId: expected.contract?.chainId ?? numberValue(params.chainId, 'chainId'),
      txHash: stringValue(params.txHash, 'txHash') as EvmHash,
      auctionId: expected.settlementId,
      contractAddress: address((expected.contract?.address ?? params.contractAddress) as string | undefined, 'contractAddress'),
      ...(expected.contract?.bytecodeHash ?? params.contractBytecodeHash
        ? { contractBytecodeHash: hash((expected.contract?.bytecodeHash ?? params.contractBytecodeHash) as string | undefined, 'contractBytecodeHash') }
        : {}),
      ...(params.bidderAddress ? { bidderAddress: address(params.bidderAddress as string, 'bidderAddress') } : {}),
      sellerAddress: address((expected.participants?.seller?.address ?? params.sellerAddress) as string | undefined, 'sellerAddress'),
      arbiterAddress: address((expected.participants?.escrow?.address ?? params.arbiterAddress) as string | undefined, 'arbiterAddress'),
      assetAddress: address(params.assetAddress as string | undefined, 'assetAddress'),
      bidAmount: genericAmount(expected.amount, params),
      ...(expected.fee || params.escrowFee ? { escrowFee: genericAmount(expected.fee, { ...params, value: params.escrowFee }) } : {}),
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
      ...(result.bid
        ? {
            data: {
              txHash: result.bid.txHash,
              chainId: result.bid.chainId,
              settlementId: result.bid.auctionId,
              bidderAddress: result.bid.bidderAddress,
              assetAddress: result.bid.assetAddress,
            },
          }
        : {}),
      ...(result.error ? { error: result.error } : {}),
    }
  } catch (error) {
    return {
      method: 'evm',
      status: 'unverifiable',
      error: error instanceof Error ? error.message : 'Unable to validate EVM auction payment',
    }
  }
}

export function createEvmAuctionPolicy(options: EvmMarketplacePolicyOptions): EvmAuctionPolicy {
  const chains = resolveEvmChainConfigs(options.chains) as ResolvedEvmMarketplaceChainConfig[]
  let currentState: EvmMarketplacePolicyState = {
    enabled: evmAuctionPolicies(chains).length > 0,
    started: false,
    maxUsedIndex: -1,
    nextTradeIndex: 0,
    startSummary: 'Not started',
  }

  function client(seed: string, tradeIndex?: number) {
    const [primaryChain] = chains
    return createMarketplaceEvmClient({
      chains,
      operationStore: options.operationStore,
      seed,
      ...(tradeIndex !== undefined ? { tradeIndex } : {}),
      ...(primaryChain?.boltz ? { boltz: primaryChain.boltz } : {}),
    })
  }

  return {
    method: 'evm',
    id: 'evm:multi-auction',
    subject: 'bid',
    family: 'auction',
    policies: () => evmAuctionPolicies(chains),
    assets: () => evmPaymentAssets(chains, options.appId),
    state: () => currentState,

    async discoverHighWatermark(context) {
      const evm = client(context.seed)
      if (!evm.discoverHighWatermark) throw new Error('EVM high watermark discovery is unavailable')
      const discovery = await evm.discoverHighWatermark({
        highWaterMark: context.highWaterMark,
        unusedWindow: context.unusedWindow,
      })
      currentState = {
        ...currentState,
        maxUsedIndex: discovery.maxUsedIndex,
        nextTradeIndex: discovery.nextUnusedIndex,
      }
      return {
        policy: 'evm:multi-auction',
        maxUsedIndex: discovery.maxUsedIndex,
        nextUnusedIndex: discovery.nextUnusedIndex,
        scannedFrom: discovery.scannedFrom,
        scannedThrough: discovery.scannedThrough,
        unusedWindow: discovery.unusedWindow,
        usedIndexes: discovery.usedTradeIndexes,
        recoveryActions: discovery.recoveryActions,
      }
    },

    async startup(context) {
      currentState = {
        ...currentState,
        started: true,
        maxUsedIndex: context.highWaterMark,
        nextTradeIndex: context.nextUnusedIndex,
        startSummary: 'EVM auction startup complete',
      }
      return {
        policy: 'evm:multi-auction',
        data: {
          auctionPolicyCount: evmAuctionPolicies(chains).length,
        },
      }
    },

    async *recover(payment) {
      yield {
        type: 'noop',
        data: {
          reason: 'EVM auction recovery is handled by startup and on-chain validation',
          subject: payment.subject,
          method: payment.proof.method,
        },
      }
    },

    pay(intent) {
      return payEvmAuctionIntent({
        chains,
        operationStore: options.operationStore,
        intent,
        state: currentState,
        setState(nextState) {
          currentState = nextState
        },
      })
    },

    validatePayment(request) {
      const policyType = request.proof.params.policyType
      if (policyType && policyType !== 'evm:multi-auction') {
        return Promise.resolve({
          method: 'evm',
          status: 'unverifiable',
          error: `EVM auction policy cannot validate ${String(policyType)}`,
        })
      }
      return validateAuctionPayment(chains, request)
    },
  }
}
