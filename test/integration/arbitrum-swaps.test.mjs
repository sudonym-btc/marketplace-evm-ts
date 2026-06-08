import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'

import {
  createMarketplaceEvmClient,
} from '../../dist/index.js'
import { createBoltzRestClient } from '../../dist/boltz/restClient.js'
import { MemoryOperationStore } from '../../dist/utils/store.js'
import { sha256Hex as runtimeSha256Hex } from '../../dist/utils/sha256.js'
import { clearBoltzPendingEvmTransactions, dexQuoteIn, dexQuoteOut, encodeDexCalls, satsToTbtcWei, sha256Hex, tbtcWeiToSatsCeil, waitForSwapStatus } from './support/boltz.mjs'
import {
  amount,
  createAccount,
  createClients,
  erc20SwapClaimCall,
  erc20SwapLockCalls,
  escrowBalance,
  fundAccount,
  randomTradeId,
  readTrade,
  sendCall,
  sendCalls,
  signArbitrate,
  signRelease,
  assetBalance,
} from './support/evm.mjs'
import { createInvoice, payInvoice } from './support/lightning.mjs'
import { arbitrumAaConfig, readStackConfig } from './support/stack.mjs'

const config = await readStackConfig()
const arbitrum = config.chains.arbitrumRegtest
const tbtc = arbitrum.assets.TBTC
const usdt = arbitrum.assets.USDT
const multiEscrow = arbitrum.multiEscrow.address
const erc20Swap = '0x71C95911E9a5D330f4D621842EC243EE1343292e'
const { publicClient } = createClients(config)
const boltz = createBoltzRestClient({ apiUrl: config.boltz.apiUrl })

function arbitrumChainConfig() {
  return {
    id: 'arbitrum-regtest',
    chainId: arbitrum.chainId,
    publicClient,
    nativeAsset: {
      chainId: arbitrum.chainId,
      address: '0x0000000000000000000000000000000000000000',
      denomination: arbitrum.nativeAsset.denomination,
      decimals: arbitrum.nativeAsset.decimals,
    },
    assets: Object.values(arbitrum.assets).map(asset => ({
      chainId: arbitrum.chainId,
      address: asset.address,
      denomination: asset.denomination,
      decimals: asset.decimals,
    })),
    accountAbstraction: arbitrumAaConfig(config),
  }
}

function makeEoaEvm(account) {
  const { walletClient } = createClients(config, account)
  const store = new MemoryOperationStore()
  const evm = createMarketplaceEvmClient({
    chains: [arbitrumChainConfig()],
    operationStore: store,
    executor: {
      async getAddress() {
        return account.address
      },
      async execute(calls, options) {
        const txHash = await sendCalls(publicClient, walletClient, account, calls)
        return { txHash, accountAddress: account.address, chainId: options.chainId }
      },
    },
  })
  return { evm, store, walletClient }
}

function makeSeededAaEvm({ seed = randomBytes(32).toString('hex'), tradeIndex = 0 } = {}) {
  const store = new MemoryOperationStore()
  const evm = createMarketplaceEvmClient({
    chains: [arbitrumChainConfig()],
    operationStore: store,
    seed,
    tradeIndex,
    boltz: {
      apiUrl: config.boltz.apiUrl,
    },
  })
  return { evm, store, seed, tradeIndex }
}

async function reverseSwapTbtcToSmartAccount(evm, store, tradeIndex, attemptIndex, onchainSats) {
  clearBoltzPendingEvmTransactions({ apiUrl: config.boltz.apiUrl })
  const smartAccount = await evm.executor.getAddress(arbitrum.chainId)
  const result = await evm.swaps.swapIn({
    tradeIndex,
    attemptIndex,
    chainId: arbitrum.chainId,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    assetAddress: tbtc.address,
    amount: { value: BigInt(onchainSats), denomination: 'BTC', decimals: 8 },
    boltzAmountSats: onchainSats,
    description: 'marketplace-evm-ts integration',
  })

  assert.equal(result.type, 'external_payment_required')
  assert.ok(result.invoice)
  assert.equal((await store.get(result.operation.id)).status, 'external_payment_required')

  const payment = payInvoice(result.invoice, { apiUrl: config.boltz.apiUrl })
  try {
    const status = await waitForSwapStatus(boltz, result.swapId, ['transaction.mempool', 'transaction.confirmed'])
    assert.ok(status.transaction?.id)
    await publicClient.waitForTransactionReceipt({ hash: status.transaction.id })
    assert.ok(result.refundAddress)
    assert.ok(result.onchainAmount)

    const claim = await evm.executor.execute([erc20SwapClaimCall({
      contractAddress: erc20Swap,
      preimage: result.preimage,
      amount: satsToTbtcWei(result.onchainAmount),
      assetAddress: tbtc.address,
      refundAddress: result.refundAddress,
      timelock: result.timeoutBlockHeight,
    })], { chainId: arbitrum.chainId })

    return {
      preimage: result.preimage,
      preimageHash: result.preimageHash,
      result,
      smartAccount,
      claimHash: claim.txHash,
      onchainWei: satsToTbtcWei(result.onchainAmount),
    }
  } finally {
    payment.stop()
  }
}

async function createAndLockSubmarineSwap(evm, tradeIndex, attemptIndex, invoice, paymentHash) {
  const result = await evm.swaps.swapOut({
    tradeIndex,
    attemptIndex,
    chainId: arbitrum.chainId,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    assetAddress: tbtc.address,
    invoice,
  })

  assert.equal(result.type, 'awaiting_resolution')
  assert.ok(result.expectedAmount)
  assert.ok(result.claimAddress)
  assert.ok(result.lockupAddress)

  const lockedAmount = satsToTbtcWei(result.expectedAmount)
  const calls = erc20SwapLockCalls({
    contractAddress: result.lockupAddress,
    preimageHash: `0x${paymentHash}`,
    amount: lockedAmount,
    assetAddress: tbtc.address,
    claimAddress: result.claimAddress,
    timelock: result.timeoutBlockHeight,
  })
  await evm.executor.execute(calls, { chainId: arbitrum.chainId })

  const status = await waitForSwapStatus(
    boltz,
    result.swapId,
    ['invoice.paid', 'transaction.claimed', 'transaction.claim.pending'],
  )
  const preimage = await boltz.getSubmarinePreimage(result.swapId)
  const normalizedPreimage = preimage.replace(/^0x/, '')
  assert.equal(sha256Hex(Buffer.from(normalizedPreimage, 'hex')), paymentHash)

  return {
    result,
    status,
    lockedAmount,
    preimage: normalizedPreimage,
  }
}

async function multiEscrowRuntimeHash() {
  const code = await publicClient.getBytecode({ address: multiEscrow })
  assert.ok(code && code !== '0x')
  return runtimeSha256Hex(code)
}

test('swap-in claims tBTC on Arbitrum after paying the Boltz Lightning invoice', { timeout: 180_000 }, async () => {
  const { evm, store, tradeIndex } = makeSeededAaEvm({ tradeIndex: 0 })
  const smartAccount = await evm.executor.getAddress(arbitrum.chainId)

  const before = await assetBalance(publicClient, tbtc.address, smartAccount)
  const swap = await reverseSwapTbtcToSmartAccount(evm, store, tradeIndex, 0, 100_000)
  const after = await assetBalance(publicClient, tbtc.address, smartAccount)

  assert.equal(after - before, swap.onchainWei)
  assert.match(swap.claimHash, /^0x[0-9a-f]{64}$/)
})

test('swap-out locks tBTC on Arbitrum and verifies the Lightning preimage', { timeout: 180_000 }, async () => {
  const { evm, tradeIndex } = makeSeededAaEvm({ tradeIndex: 1 })
  const smartAccount = await evm.executor.getAddress(arbitrum.chainId)
  await fundAccount(config, publicClient, { address: smartAccount }, {
    tbtc: satsToTbtcWei(200_000),
  })

  const { invoice, paymentHash } = createInvoice(100_000, 'marketplace-evm-ts tBTC swap-out', {
    apiUrl: config.boltz.apiUrl,
  })
  const before = await assetBalance(publicClient, tbtc.address, smartAccount)
  const swap = await createAndLockSubmarineSwap(evm, tradeIndex, 0, invoice, paymentHash)
  const after = await assetBalance(publicClient, tbtc.address, smartAccount)

  assert.equal(before - after, swap.lockedAmount)
  assert.ok(['invoice.paid', 'transaction.claimed', 'transaction.claim.pending'].includes(swap.status.status))
})

test('swap-in can bridge through tBTC, DEX into USDT, and fund a USDT escrow', { timeout: 240_000 }, async () => {
  const { evm, store, tradeIndex } = makeSeededAaEvm({ tradeIndex: 2 })
  const smartAccount = await evm.executor.getAddress(arbitrum.chainId)

  const escrowUsdtAmount = 100_000_000n
  const dex = await dexQuoteOut(config.boltz.apiUrl, arbitrum.boltzCurrency, {
    tokenIn: tbtc.address,
    tokenOut: usdt.address,
    amountOut: escrowUsdtAmount,
  })
  const requiredSats = tbtcWeiToSatsCeil(dex.amountIn)
  await reverseSwapTbtcToSmartAccount(evm, store, tradeIndex, 0, requiredSats)

  const dexCalls = await encodeDexCalls(config.boltz.apiUrl, arbitrum.boltzCurrency, {
    recipient: smartAccount,
    amountIn: dex.amountIn,
    amountOutMin: dex.amountOut,
    data: dex.data,
  })
  await evm.executor.execute(dexCalls, { chainId: arbitrum.chainId })

  const usdtBalance = await assetBalance(publicClient, usdt.address, smartAccount)
  assert.ok(usdtBalance >= escrowUsdtAmount)

  const seller = createAccount()
  const arbiter = createAccount()
  const tradeId = randomTradeId()
  const paymentAmount = amount(escrowUsdtAmount, usdt)
  const calls = evm.escrow.createTrade({
    tradeId,
    buyerAddress: smartAccount,
    sellerAddress: seller.address,
    arbiterAddress: arbiter.address,
    assetAddress: usdt.address,
    paymentAmount,
    contractAddress: multiEscrow,
    unlockAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })

  const createTradeTxHash = (await evm.executor.execute(calls, { chainId: arbitrum.chainId })).txHash
  assert.ok(createTradeTxHash)

  const validation = await evm.escrow.validate({
    chainId: arbitrum.chainId,
    txHash: createTradeTxHash,
    tradeId,
    contractAddress: multiEscrow,
    contractBytecodeHash: await multiEscrowRuntimeHash(),
    sellerAddress: seller.address,
    arbiterAddress: arbiter.address,
    assetAddress: usdt.address,
    paymentAmount,
  })
  assert.equal(validation.status, 'valid')
  assert.equal(validation.assetMatched, true)
  assert.equal(validation.recipientMatched, true)
  assert.equal(validation.escrowMatched, true)
})

test('swap-out can DEX USDT into tBTC and settle a Lightning invoice', { timeout: 240_000 }, async () => {
  const { evm, tradeIndex } = makeSeededAaEvm({ tradeIndex: 3 })
  const smartAccount = await evm.executor.getAddress(arbitrum.chainId)
  await fundAccount(config, publicClient, { address: smartAccount }, {
    usdt: 100_000_000n,
  })

  const dex = await dexQuoteIn(config.boltz.apiUrl, arbitrum.boltzCurrency, {
    tokenIn: usdt.address,
    tokenOut: tbtc.address,
    amountIn: 100_000_000n,
  })
  const dexCalls = await encodeDexCalls(config.boltz.apiUrl, arbitrum.boltzCurrency, {
    recipient: smartAccount,
    amountIn: dex.amountIn,
    amountOutMin: dex.amountOut,
    data: dex.data,
  })
  await evm.executor.execute(dexCalls, { chainId: arbitrum.chainId })

  const bridgeBalance = await assetBalance(publicClient, tbtc.address, smartAccount)
  assert.ok(bridgeBalance >= satsToTbtcWei(100_000))

  const { invoice, paymentHash } = createInvoice(100_000, 'marketplace-evm-ts USDT swap-out', {
    apiUrl: config.boltz.apiUrl,
  })
  const swap = await createAndLockSubmarineSwap(evm, tradeIndex, 0, invoice, paymentHash)

  assert.ok(bridgeBalance >= swap.lockedAmount)
  assert.match(swap.preimage, /^[0-9a-f]{64}$/)
})

test('release credits the seller balance after a buyer-signed USDT release', { timeout: 120_000 }, async () => {
  const buyer = createAccount()
  const seller = createAccount()
  const arbiter = createAccount()
  await fundAccount(config, publicClient, buyer, { eth: '1', usdt: 7_000_000n })
  const { evm, walletClient } = makeEoaEvm(buyer)

  const tradeId = randomTradeId()
  const paymentValue = 7_000_000n
  const calls = evm.escrow.createTrade({
    tradeId,
    buyerAddress: buyer.address,
    sellerAddress: seller.address,
    arbiterAddress: arbiter.address,
    assetAddress: usdt.address,
    paymentAmount: amount(paymentValue, usdt),
    contractAddress: multiEscrow,
    unlockAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })
  await sendCalls(publicClient, walletClient, buyer, calls)

  const signature = await signRelease(config, buyer, multiEscrow, tradeId, buyer.address)
  await sendCall(publicClient, walletClient, buyer, evm.escrow.release({
    tradeId,
    contractAddress: multiEscrow,
    actorAddress: buyer.address,
    signature,
  }))

  const sellerBalance = await escrowBalance(publicClient, multiEscrow, seller.address, usdt.address)
  const trade = await readTrade(publicClient, multiEscrow, tradeId)
  assert.equal(sellerBalance, paymentValue)
  assert.equal(trade[0].toLowerCase(), '0x0000000000000000000000000000000000000000')
})

test('arbitrate splits tBTC payment and bond with an arbiter signature', { timeout: 120_000 }, async () => {
  const buyer = createAccount()
  const seller = createAccount()
  const arbiter = createAccount()
  await fundAccount(config, publicClient, buyer, {
    eth: '1',
    tbtc: 200_000_000_000_000n,
  })
  const { evm, walletClient } = makeEoaEvm(buyer)

  const tradeId = randomTradeId()
  const paymentValue = 100_000_000_000_000n
  const bondValue = 50_000_000_000_000n
  const calls = evm.escrow.createTrade({
    tradeId,
    buyerAddress: buyer.address,
    sellerAddress: seller.address,
    arbiterAddress: arbiter.address,
    assetAddress: tbtc.address,
    paymentAmount: amount(paymentValue, tbtc),
    bondAmount: amount(bondValue, tbtc),
    contractAddress: multiEscrow,
    unlockAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })
  await sendCalls(publicClient, walletClient, buyer, calls)

  const paymentFactor = 700n
  const bondFactor = 200n
  const signature = await signArbitrate(config, arbiter, multiEscrow, tradeId, paymentFactor, bondFactor)
  await sendCall(publicClient, walletClient, buyer, evm.escrow.arbitrate({
    tradeId,
    contractAddress: multiEscrow,
    paymentFactor,
    bondFactor,
    signature,
  }))

  const expectedSeller = paymentValue * paymentFactor / 1000n + bondValue * bondFactor / 1000n
  const expectedBuyer = paymentValue + bondValue - expectedSeller
  assert.equal(await escrowBalance(publicClient, multiEscrow, seller.address, tbtc.address), expectedSeller)
  assert.equal(await escrowBalance(publicClient, multiEscrow, buyer.address, tbtc.address), expectedBuyer)
})
