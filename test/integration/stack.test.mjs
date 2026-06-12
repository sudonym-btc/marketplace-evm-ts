import assert from 'node:assert/strict'
import { test } from 'node:test'

import { privateKeyToAccount } from 'viem/accounts'

import {
  createMarketplaceEvmClient,
} from '../../dist/index.js'
import { MemoryOperationStore } from '../../dist/utils/store.js'
import { sha256Hex } from '../../dist/utils/sha256.js'
import {
  amount,
  anvilFunder,
  escrowBalance,
  randomTradeId,
  readTrade,
  recycleCovenantHash,
  sendCall,
  signArbitrate,
  signRecycle,
} from './support/evm.mjs'
import { arbitrumAaConfig, readStackConfig } from './support/stack.mjs'
import { createClients } from './support/evm.mjs'

const config = await readStackConfig()
const arbitrum = config.chains.arbitrumRegtest
const buyerAccount = privateKeyToAccount(anvilFunder.privateKey)
const sellerAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const arbiterAccount = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
const sellerAddress = sellerAccount.address
const arbiterAddress = arbiterAccount.address
const { publicClient, walletClient } = createClients(config, buyerAccount)

async function canRpc(url) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return false
    const payload = await response.json()
    return Boolean(payload.result)
  } catch {
    return false
  }
}

const stackTestOptions = (await canRpc(arbitrum.rpcUrl))
  ? {}
  : { skip: 'local EVM stack is not running' }

const evm = createMarketplaceEvmClient({
  chains: [
    {
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
    },
  ],
  operationStore: new MemoryOperationStore(),
  executor: {
    async getAddress() {
      return buyerAccount.address
    },
    async execute(calls) {
      let txHash
      for (const call of calls) {
        txHash = await sendCall(publicClient, walletClient, buyerAccount, call)
      }
      return { txHash, accountAddress: buyerAccount.address }
    },
  },
})

async function createAndValidateEscrowTrade(symbol, paymentValue) {
  const asset = arbitrum.assets[symbol]
  const tradeId = randomTradeId()
  const paymentAmount = amount(paymentValue, asset)

  const calls = evm.escrow.createTrade({
    tradeId,
    buyerAddress: buyerAccount.address,
    sellerAddress,
    arbiterAddress,
    assetAddress: asset.address,
    paymentAmount,
    contractAddress: arbitrum.multiEscrow.address,
    unlockAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })

  let createTradeTxHash
  for (const call of calls) {
    const txHash = await sendCall(publicClient, walletClient, buyerAccount, call)
    if (call.name === 'MultiEscrow.createTradeWithTerms') createTradeTxHash = txHash
  }

  assert.ok(createTradeTxHash)

  return evm.escrow.validate({
    chainId: arbitrum.chainId,
    txHash: createTradeTxHash,
    tradeId,
    contractAddress: arbitrum.multiEscrow.address,
    contractBytecodeHash: await getMultiEscrowRuntimeHash(),
    sellerAddress,
    arbiterAddress,
    assetAddress: asset.address,
    paymentAmount,
  })
}

async function createAndArbitrateEscrowTrade(symbol, paymentValue, bondValue) {
  const asset = arbitrum.assets[symbol]
  const tradeId = randomTradeId()
  const paymentAmount = amount(paymentValue, asset)
  const bondAmount = amount(bondValue, asset)
  const sellerBalanceBefore = await escrowBalance(publicClient, arbitrum.multiEscrow.address, sellerAddress, asset.address)
  const buyerBalanceBefore = await escrowBalance(publicClient, arbitrum.multiEscrow.address, buyerAccount.address, asset.address)

  const calls = evm.escrow.createTrade({
    tradeId,
    buyerAddress: buyerAccount.address,
    sellerAddress,
    arbiterAddress,
    assetAddress: asset.address,
    paymentAmount,
    bondAmount,
    contractAddress: arbitrum.multiEscrow.address,
    unlockAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })
  for (const call of calls) await sendCall(publicClient, walletClient, buyerAccount, call)

  const paymentFactor = 700n
  const bondFactor = 200n
  const signature = await signArbitrate(config, arbiterAccount, arbitrum.multiEscrow.address, tradeId, paymentFactor, bondFactor)
  await sendCall(publicClient, walletClient, buyerAccount, evm.escrow.arbitrate({
    tradeId,
    contractAddress: arbitrum.multiEscrow.address,
    paymentFactor,
    bondFactor,
    signature,
  }))

  const expectedSeller = paymentValue * paymentFactor / 1000n + bondValue * bondFactor / 1000n
  const expectedBuyer = paymentValue + bondValue - expectedSeller
  const sellerBalanceAfter = await escrowBalance(publicClient, arbitrum.multiEscrow.address, sellerAddress, asset.address)
  const buyerBalanceAfter = await escrowBalance(publicClient, arbitrum.multiEscrow.address, buyerAccount.address, asset.address)
  assert.equal(sellerBalanceAfter - sellerBalanceBefore, expectedSeller)
  assert.equal(buyerBalanceAfter - buyerBalanceBefore, expectedBuyer)
  const trade = await readTrade(publicClient, arbitrum.multiEscrow.address, tradeId)
  assert.equal(trade[0].toLowerCase(), '0x0000000000000000000000000000000000000000')
}

async function getMultiEscrowRuntimeHash() {
  const code = await publicClient.getBytecode({ address: arbitrum.multiEscrow.address })
  assert.ok(code && code !== '0x')
  return sha256Hex(code)
}

const zeroHash = `0x${'0'.repeat(64)}`

async function placeValidateAndPromoteAuctionBid(symbol, bidValue) {
  const asset = arbitrum.assets[symbol]
  const auctionId = randomTradeId()
  const targetTradeId = randomTradeId()
  const bidAmount = amount(bidValue, asset)
  const escrowFee = amount(0n, asset)
  const paymentAmount = amount(bidValue + escrowFee.value, asset)
  const unlockAt = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const targetTerms = {
    tradeId: targetTradeId,
    buyer: buyerAccount.address,
    seller: sellerAddress,
    arbiter: arbiterAddress,
    token: asset.address,
    paymentAmount: paymentAmount.value,
    bondAmount: 0n,
    unlockAt,
    timeoutClaimant: sellerAddress,
    escrowFee: escrowFee.value,
    contextHash: zeroHash,
    recycleCovenantHash: zeroHash,
  }
  const sourceCovenantHash = recycleCovenantHash({
    buyer: buyerAccount.address,
    seller: sellerAddress,
    arbiter: arbiterAddress,
    token: asset.address,
    paymentAmount: paymentAmount.value,
    bondAmount: 0n,
    timeoutClaimant: sellerAddress,
    escrowFee: escrowFee.value,
    contextHash: zeroHash,
  })

  const calls = evm.auction.placeBid({
    auctionId,
    bidderAddress: buyerAccount.address,
    sellerAddress,
    arbiterAddress,
    assetAddress: asset.address,
    bidAmount,
    escrowFee,
    contractAddress: arbitrum.multiEscrow.address,
    endsAt: unlockAt,
    recycleCovenantHash: sourceCovenantHash,
  })

  let placeBidTxHash
  for (const call of calls) {
    const txHash = await sendCall(publicClient, walletClient, buyerAccount, call)
    if (call.name === 'MultiEscrow.createAuctionBid') placeBidTxHash = txHash
  }

  assert.ok(placeBidTxHash)

  const validation = await evm.auction.validate({
    chainId: arbitrum.chainId,
    txHash: placeBidTxHash,
    auctionId,
    contractAddress: arbitrum.multiEscrow.address,
    contractBytecodeHash: await getMultiEscrowRuntimeHash(),
    bidderAddress: buyerAccount.address,
    sellerAddress,
    arbiterAddress,
    assetAddress: asset.address,
    bidAmount,
    escrowFee,
    recycleCovenantHash: sourceCovenantHash,
  })
  assert.equal(validation.status, 'valid')
  assert.equal(validation.assetMatched, true)
  assert.equal(validation.recipientMatched, true)
  assert.equal(validation.arbiterMatched, true)
  assert.equal(validation.bid?.bidAmount, bidValue)
  assert.equal(validation.bid?.fundedAmount, paymentAmount.value)
  assert.equal(validation.bid?.timeoutClaimantAddress.toLowerCase(), buyerAccount.address.toLowerCase())

  const sourceTrade = await readTrade(publicClient, arbitrum.multiEscrow.address, auctionId)
  assert.equal(sourceTrade[0].toLowerCase(), buyerAccount.address.toLowerCase())
  assert.equal(sourceTrade[7].toLowerCase(), buyerAccount.address.toLowerCase())

  const signature = await signRecycle(config, arbiterAccount, arbitrum.multiEscrow.address, auctionId, targetTerms)
  await sendCall(publicClient, walletClient, buyerAccount, evm.escrow.recycle({
    sourceTradeId: auctionId,
    targetTradeId,
    buyerAddress: buyerAccount.address,
    sellerAddress,
    arbiterAddress,
    assetAddress: asset.address,
    paymentAmount,
    unlockAt,
    timeoutClaimantAddress: sellerAddress,
    escrowFee,
    contextHash: zeroHash,
    recycleCovenantHash: zeroHash,
    arbiterSignature: signature,
    contractAddress: arbitrum.multiEscrow.address,
  }))

  const recycledSource = await readTrade(publicClient, arbitrum.multiEscrow.address, auctionId)
  const targetTrade = await readTrade(publicClient, arbitrum.multiEscrow.address, targetTradeId)
  assert.equal(recycledSource[0].toLowerCase(), '0x0000000000000000000000000000000000000000')
  assert.equal(targetTrade[0].toLowerCase(), buyerAccount.address.toLowerCase())
  assert.equal(targetTrade[1].toLowerCase(), sellerAddress.toLowerCase())
  assert.equal(targetTrade[2].toLowerCase(), arbiterAddress.toLowerCase())
  assert.equal(targetTrade[4], paymentAmount.value)
  assert.equal(targetTrade[7].toLowerCase(), sellerAddress.toLowerCase())

  return validation
}

test('stack exposes the expected EVM contracts and Boltz API', stackTestOptions, async () => {
  const code = await publicClient.getBytecode({ address: arbitrum.multiEscrow.address })
  assert.ok(code && code !== '0x')
  if (arbitrum.multiEscrow.runtimeBytecodeHash) {
    assert.equal(arbitrum.multiEscrow.runtimeBytecodeHash, await getMultiEscrowRuntimeHash())
  }

  const nodes = await fetch(`${config.boltz.apiUrl}/nodes`).then(response => response.json())
  assert.ok(nodes.BTC)
})

test('validates a USDT escrow deposit against MultiEscrow', stackTestOptions, async () => {
  const result = await createAndValidateEscrowTrade('USDT', 1_000_000n)
  assert.equal(result.status, 'valid')
  assert.equal(result.assetMatched, true)
  assert.equal(result.recipientMatched, true)
  assert.equal(result.arbiterMatched, true)
})

test('validates a tBTC escrow deposit against MultiEscrow', stackTestOptions, async () => {
  const result = await createAndValidateEscrowTrade('TBTC', 100_000_000_000_000n)
  assert.equal(result.status, 'valid')
  assert.equal(result.assetMatched, true)
  assert.equal(result.recipientMatched, true)
  assert.equal(result.arbiterMatched, true)
})

test('arbitrates a USDT escrow deposit against MultiEscrow', stackTestOptions, async () => {
  await createAndArbitrateEscrowTrade('USDT', 1_500_000n, 500_000n)
})

test('arbitrates a tBTC escrow deposit against MultiEscrow', stackTestOptions, async () => {
  await createAndArbitrateEscrowTrade('TBTC', 150_000_000_000_000n, 50_000_000_000_000n)
})

test('places, validates, and promotes a USDT auction bid against MultiEscrow', stackTestOptions, async () => {
  const result = await placeValidateAndPromoteAuctionBid('USDT', 1_000_000n)
  assert.equal(result.status, 'valid')
  assert.equal(result.assetMatched, true)
  assert.equal(result.recipientMatched, true)
  assert.equal(result.arbiterMatched, true)
})

test('places, validates, and promotes a tBTC auction bid against MultiEscrow', stackTestOptions, async () => {
  const result = await placeValidateAndPromoteAuctionBid('TBTC', 100_000_000_000_000n)
  assert.equal(result.status, 'valid')
  assert.equal(result.assetMatched, true)
  assert.equal(result.recipientMatched, true)
  assert.equal(result.arbiterMatched, true)
})
