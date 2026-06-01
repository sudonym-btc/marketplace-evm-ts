import { erc20Abi } from '../contracts/erc20.js'
import { createMarketplaceEvmClient } from '../client.js'
import { erc20SwapClaimCall, findErc20SwapLockup } from '../swaps/erc20Swap.js'
import { zeroAddress } from '../utils/hex.js'
import { resolveEvmPaymentIntent } from './intent.js'
import type { EvmPayRequest, GenericPolicyPaymentState, GenericPaymentProof } from './types.js'
import type { EvmHash } from '../types.js'

const swapPollIntervalMs = 2_000
const swapPaymentTimeoutMs = 20 * 60_000

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
  denomination: string
  decimals: number
  escrowFee: bigint
}): GenericPaymentProof {
  return {
    method: 'evm',
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
      denomination: options.denomination,
      decimals: options.decimals,
      escrowFee: options.escrowFee.toString(),
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
  const evm = createMarketplaceEvmClient({
    chains: request.chains,
    operationStore: request.operationStore,
    seed: intent.seed,
    tradeIndex: intent.accountIndex,
    ...(intent.chain.boltz ? { boltz: intent.chain.boltz } : {}),
  })
  if (!evm.executor) throw new Error('EVM deterministic AA execution is unavailable')

  const buyerAddress = await evm.executor.getAddress(intent.chain.chainId)
  const calls = evm.escrow.createTrade({
    tradeId: intent.settlementId,
    buyerAddress,
    sellerAddress: intent.sellerAddress,
    arbiterAddress: intent.arbiterAddress,
    assetAddress: intent.asset.assetAddress,
    paymentAmount: intent.amount,
    escrowFee: intent.fee,
    contractAddress: intent.contractAddress,
    unlockAt: intent.unlockAt,
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
  const requiredBalance = intent.amount.value + intent.fee.value

  if (balance >= requiredBalance) {
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
      escrowFee: intent.fee,
      minConfirmations: 1,
    })
    request.setState({
      ...request.state,
      nextTradeIndex: intent.accountIndex + 1,
      maxUsedIndex: Math.max(request.state.maxUsedIndex, intent.accountIndex),
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
        denomination: intent.amount.denomination,
        decimals: intent.amount.decimals,
        escrowFee: intent.fee.value,
      }),
      data: {
        method: 'evm',
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

  const swap = await evm.swaps.swapIn({
    tradeIndex: intent.accountIndex,
    attemptIndex: 0,
    chainId: intent.chain.chainId,
    boltzCurrency: intent.asset.boltzCurrency,
    assetAddress: intent.asset.assetAddress,
    amount: intent.amount,
    description: intent.description,
    postClaimCalls: calls,
  })
  if (swap.type !== 'external_payment_required') throw new Error('Unexpected swap-in result')

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
      amount: request.intent.amount,
      description: intent.description,
      data: {
        method: 'evm',
        swapId: swap.swapId,
        preimageHash: swap.preimageHash,
        tradeIndex: intent.accountIndex,
        buyerAddress,
      },
    },
    proof: null,
    data: {
      method: 'evm',
      swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
    },
  }

  yield {
    type: 'payment_progress',
    status: 'Waiting for Lightning payment',
    data: {
      method: 'evm',
      swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
    },
  }

  const lockTxHash = await waitForSwapLockTransaction(evm, swap.operation.id)
  yield {
    type: 'payment_progress',
    status: 'Boltz lock transaction detected',
    data: {
      method: 'evm',
      swapId: swap.swapId,
      tradeIndex: intent.accountIndex,
      txHash: lockTxHash,
    },
  }

  const receipt = await intent.chain.publicClient.waitForTransactionReceipt({ hash: lockTxHash })
  if (receipt.status !== 'success') throw new Error(`Boltz lock transaction reverted: ${lockTxHash}`)
  const lockup = findErc20SwapLockup(receipt.logs, {
    transactionHash: lockTxHash,
    preimageHash: swap.preimageHash,
    claimAddress: buyerAddress,
    tokenAddress: intent.asset.assetAddress,
  })

  yield {
    type: 'payment_progress',
    status: 'Claiming swap into escrow',
    data: {
      method: 'evm',
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
      ...calls,
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
    escrowFee: intent.fee,
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
  }
  await request.operationStore.put(swap.operation)

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
      denomination: intent.amount.denomination,
      decimals: intent.amount.decimals,
      escrowFee: intent.fee.value,
    }),
    data: {
      method: 'evm',
      tradeIndex: intent.accountIndex,
      txHash: execution.txHash,
      validationStatus: validation.status,
      buyerAddress,
      swapId: swap.swapId,
      lockTxHash,
    },
  }
}
