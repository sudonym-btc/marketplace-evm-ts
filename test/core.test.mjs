import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createEvmAuctionPolicy,
  createEvmEscrowPolicy,
  createMarketplaceEvmClient,
} from '../dist/index.js'
import { multiEscrowAbi, multiEscrowRuntimeBytecodeHash } from '@sudonym-btc/marketplace-evm-contracts'
import { erc20Abi } from '../dist/contracts/erc20.js'
import { calculateEscrowFee } from '../dist/escrow/fees.js'
import { findErc20SwapLockup } from '../dist/swaps/erc20Swap.js'
import { deriveEvmOwnerAccount, deriveEvmSwapMaterial, deriveEvmTradeId } from '../dist/seed.js'
import { MemoryOperationStore } from '../dist/utils/store.js'
import { createPublicClient, decodeFunctionData, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

function aaConfig() {
  return {
    entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    entryPointVersion: '0.7',
    factoryAddress: '0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985',
    bundlerUrl: 'http://127.0.0.1:4337',
    paymasterUrl: 'http://127.0.0.1:3010',
    paymasterAddress: '0x38aef040CEB057B62E1598F5C265946A4E4BaB4C',
  }
}

function indexedSmartAccount(index) {
  return `0x${(BigInt(index) + 1n).toString(16).padStart(40, '0')}`
}

function indexFromSmartAccount(address) {
  return Number(BigInt(address) - 1n)
}

function mockDiscoveryChain({ usedNonces = [], deployed = [] } = {}) {
  const usedNonceIndexes = new Set(usedNonces)
  const deployedIndexes = new Set(deployed)
  return {
    id: 'arbitrum-regtest',
    chainId: 412346,
    rpcUrl: 'http://127.0.0.1:18546',
    publicClient: {
      chain: {
        id: 412346,
        name: 'Arbitrum Regtest',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: ['http://127.0.0.1:18546'] } },
      },
      async getBytecode({ address }) {
        return deployedIndexes.has(indexFromSmartAccount(address)) ? '0x6000' : '0x'
      },
      async readContract({ args }) {
        return usedNonceIndexes.has(indexFromSmartAccount(args[0])) ? 1n : 0n
      },
    },
    nativeAsset: {
      chainId: 412346,
      address: '0x0000000000000000000000000000000000000000',
      denomination: 'ETH',
      decimals: 18,
    },
    accountAbstraction: aaConfig(),
  }
}

async function canRpc(url) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: AbortSignal.timeout(500),
    })
    if (!response.ok) return false
    const payload = await response.json()
    return Boolean(payload.result)
  } catch {
    return false
  }
}

test('calculates clamped escrow fees', () => {
  assert.equal(
    calculateEscrowFee(10_000n, {
      ppm: 10_000,
      base: 5n,
      min: 20n,
      max: 90n,
    }),
    90n,
  )
})

test('stores operation records in memory', async () => {
  const store = new MemoryOperationStore()
  await store.put({
    id: 'op-1',
    kind: 'swap_in',
    status: 'awaiting_onchain',
    chainId: 33,
    data: {},
    createdAt: 1,
    updatedAt: 1,
  })
  assert.equal((await store.list({ kind: 'swap_in' })).length, 1)
  assert.equal((await store.get('op-1')).status, 'awaiting_onchain')
})

test('EVM escrow startup marks stale Boltz operations failed without aborting', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'could not find swap with id: stale-swap' }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  )

  const store = new MemoryOperationStore()
  await store.put({
    id: 'stale-operation',
    kind: 'swap_in',
    status: 'external_payment_required',
    chainId: 412346,
    swapId: 'stale-swap',
    data: {
      request: {
        tradeIndex: 0,
        attemptIndex: 0,
        chainId: 412346,
        assetAddress: '0x0000000000000000000000000000000000000001',
      },
    },
    createdAt: 1,
    updatedAt: 1,
  })

  const policy = createEvmEscrowPolicy({
    operationStore: store,
    chains: [
      {
        id: 'arbitrum-regtest',
        chainId: 412346,
        publicClient: { chain: { id: 412346 } },
        nativeAsset: {
          chainId: 412346,
          address: '0x0000000000000000000000000000000000000000',
          denomination: 'ETH',
          decimals: 18,
        },
        boltz: { apiUrl: 'https://boltz.marketplace.development' },
        accountAbstraction: aaConfig(),
      },
    ],
  })

  const result = await policy.startup({
    seed: '7'.repeat(64),
    highWaterMark: 0,
    nextUnusedIndex: 1,
  })

  assert.equal(result.data.activeOperations, 1)
  assert.equal(result.data.resumed, 0)
  assert.equal(result.data.settled, 0)
  assert.equal(result.data.failed.length, 1)
  assert.match(result.data.failed[0].error, /Boltz API 404/)

  const updated = await store.get('stale-operation')
  assert.equal(updated.status, 'failed')
  assert.match(updated.error, /Boltz API 404/)
  assert.equal(updated.data.failedAtStartup, true)
})

test('EVM auction startup marks stale Boltz operations failed without aborting', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'could not find swap with id: stale-auction-swap' }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  )

  const store = new MemoryOperationStore()
  await store.put({
    id: 'stale-auction-operation',
    kind: 'swap_in',
    status: 'external_payment_required',
    chainId: 412346,
    swapId: 'stale-auction-swap',
    data: {
      request: {
        tradeIndex: 0,
        attemptIndex: 0,
        chainId: 412346,
        assetAddress: '0x0000000000000000000000000000000000000001',
      },
    },
    createdAt: 1,
    updatedAt: 1,
  })

  const policy = createEvmAuctionPolicy({
    operationStore: store,
    chains: [
      {
        id: 'arbitrum-regtest',
        chainId: 412346,
        publicClient: { chain: { id: 412346 } },
        nativeAsset: {
          chainId: 412346,
          address: '0x0000000000000000000000000000000000000000',
          denomination: 'ETH',
          decimals: 18,
        },
        boltz: { apiUrl: 'https://boltz.marketplace.development' },
        accountAbstraction: aaConfig(),
        multiEscrowAddress: '0x0000000000000000000000000000000000000010',
      },
    ],
  })

  const result = await policy.startup({
    seed: '7'.repeat(64),
    highWaterMark: 0,
    nextUnusedIndex: 1,
  })

  assert.equal(result.data.activeOperations, 1)
  assert.equal(result.data.resumed, 0)
  assert.equal(result.data.settled, 0)
  assert.equal(result.data.failed.length, 1)
  assert.match(result.data.failed[0].error, /Boltz API 404/)

  const updated = await store.get('stale-auction-operation')
  assert.equal(updated.status, 'failed')
  assert.match(updated.error, /Boltz API 404/)
  assert.equal(updated.data.failedAtStartup, true)
})

test('uses the shared MultiEscrow contract artifact', () => {
  const tradeCreated = multiEscrowAbi.find(entry => entry.type === 'event' && entry.name === 'TradeCreated')
  assert.ok(tradeCreated)
  assert.equal(tradeCreated.inputs[2].name, 'seller')
  assert.equal(tradeCreated.inputs[3].name, 'buyer')
  assert.equal(tradeCreated.inputs[4].name, 'arbiter')
  assert.match(multiEscrowRuntimeBytecodeHash, /^0x[0-9a-f]{64}$/)
})

test('builds auction bid locks on the shared MultiEscrow contract', () => {
  const evm = createMarketplaceEvmClient({
    chains: [],
    operationStore: new MemoryOperationStore(),
    seed: '8'.repeat(64),
  })
  const auctionId = `0x${'9'.repeat(64)}`
  const bidderAddress = '0x0000000000000000000000000000000000000001'
  const sellerAddress = '0x0000000000000000000000000000000000000002'
  const arbiterAddress = '0x0000000000000000000000000000000000000003'
  const assetAddress = '0x0000000000000000000000000000000000000004'
  const contractAddress = '0x0000000000000000000000000000000000000005'
  const calls = evm.auction.placeBid({
    auctionId,
    bidderAddress,
    sellerAddress,
    arbiterAddress,
    assetAddress,
    bidAmount: { value: 100n, denomination: 'USD', decimals: 6 },
    escrowFee: { value: 5n, denomination: 'USD', decimals: 6 },
    endsAt: 1_800_000_000n,
    contractAddress,
  })

  assert.equal(calls[0].name, 'ERC20.approve')
  assert.equal(calls[1].name, 'MultiEscrow.createAuctionBid')
  const decoded = decodeFunctionData({ abi: multiEscrowAbi, data: calls[1].data })
  assert.equal(decoded.functionName, 'createTradeWithTerms')
  assert.equal(decoded.args[0], auctionId)
  assert.equal(decoded.args[1].toLowerCase(), bidderAddress)
  assert.equal(decoded.args[2].toLowerCase(), sellerAddress)
  assert.equal(decoded.args[3].toLowerCase(), arbiterAddress)
  assert.equal(decoded.args[4].toLowerCase(), assetAddress)
  assert.equal(decoded.args[5], 105n)
  assert.equal(decoded.args[6], 0n)
  assert.equal(decoded.args[8].toLowerCase(), bidderAddress)
  assert.equal(decoded.args[9], 5n)
  assert.equal('settle' in evm.auction, false)
  assert.equal('cancel' in evm.auction, false)
  assert.equal('withdraw' in evm.auction, false)
})

test('includes the ERC-20 functions used by marketplace payment execution', () => {
  assert.ok(erc20Abi.some(entry => entry.type === 'function' && entry.name === 'balanceOf'))
  assert.ok(erc20Abi.some(entry => entry.type === 'function' && entry.name === 'approve'))
})

test('decodes ERC20Swap lockup logs needed for reverse-swap claims', () => {
  const lockup = findErc20SwapLockup([
    {
      address: '0x71c95911e9a5d330f4d621842ec243ee1343292e',
      transactionHash: '0xe14121ddb6666c27b27b96c4b83d8766588d45222ef2c4bb7f14d181b5cf180e',
      topics: [
        '0xa98eaa2bd8230d87a1a4c356f5c1d41cb85ff88131122ec8b1931cb9d31ae145',
        '0x2dca2d6fdb0d9d5d17b0fbbfddd6c8f5cb61a829f7fe535223e24aec6af62dd0',
        '0x0000000000000000000000009dd9be3f94503aeb94ee815edf1cae44e5f4c0f1',
        '0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266',
      ],
      data: '0x00000000000000000000000000000000000000000000000000064fe8886b3c00000000000000000000000000948b3c65b89df0b4894abe91e6d02fe579834f8f000000000000000000000000000000000000000000000000000000000000219c',
    },
  ], {
    transactionHash: '0xe14121ddb6666c27b27b96c4b83d8766588d45222ef2c4bb7f14d181b5cf180e',
    preimageHash: '0x2dca2d6fdb0d9d5d17b0fbbfddd6c8f5cb61a829f7fe535223e24aec6af62dd0',
    claimAddress: '0x9dd9BE3F94503AEb94EE815Edf1CAE44E5F4C0f1',
    tokenAddress: '0x948b3c65b89df0b4894abe91e6d02fe579834f8f',
  })

  assert.equal(lockup.amount, 1_776_710_000_000_000n)
  assert.equal(lockup.timelock, 8604n)
  assert.equal(lockup.refundAddress.toLowerCase(), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')
})

test('derives deterministic EVM owner accounts from the marketplace seed and trade index', () => {
  const seed = '6'.repeat(64)
  const first = deriveEvmOwnerAccount(seed, { tradeIndex: 0, chainId: 412346 })
  const firstAgain = deriveEvmOwnerAccount(seed, { tradeIndex: 0, chainId: 412346 })
  const second = deriveEvmOwnerAccount(seed, { tradeIndex: 1, chainId: 412346 })
  const otherChain = deriveEvmOwnerAccount(seed, { tradeIndex: 0, chainId: 33 })

  assert.equal(first.address, firstAgain.address)
  assert.notEqual(first.address, second.address)
  assert.notEqual(first.address, otherChain.address)
})

test('derives EVM trade ids from trade index only', () => {
  const seed = '6'.repeat(64)
  const first = deriveEvmTradeId(seed, { tradeIndex: 0 })
  const firstWithExtra = deriveEvmTradeId(seed, {
    tradeIndex: 0,
    role: 'auction-bid',
    namespace: 'custom',
    extra: 'ignored',
  })
  const second = deriveEvmTradeId(seed, { tradeIndex: 1 })

  assert.equal(firstWithExtra, first)
  assert.notEqual(second, first)
})

test('derives swap material beneath the EVM trade subtree', () => {
  const seed = '6'.repeat(64)
  const first = deriveEvmSwapMaterial(seed, {
    tradeIndex: 0,
    chainId: 412346,
    direction: 'swap-in',
    attemptIndex: 0,
  })
  const firstAgain = deriveEvmSwapMaterial(seed, {
    tradeIndex: 0,
    chainId: 412346,
    direction: 'swap-in',
    attemptIndex: 0,
  })
  const nextAttempt = deriveEvmSwapMaterial(seed, {
    tradeIndex: 0,
    chainId: 412346,
    direction: 'swap-in',
    attemptIndex: 1,
  })
  const otherTradeSameAttempt = deriveEvmSwapMaterial(seed, {
    tradeIndex: 1,
    chainId: 412346,
    direction: 'swap-in',
    attemptIndex: 0,
  })

  assert.equal(first.preimage, firstAgain.preimage)
  assert.equal(first.preimageHash, firstAgain.preimageHash)
  assert.equal(first.evmRoot, firstAgain.evmRoot)
  assert.notEqual(first.preimage, nextAttempt.preimage)
  assert.notEqual(first.preimage, otherTradeSameAttempt.preimage)
  assert.notEqual(first.evmRoot, otherTradeSameAttempt.evmRoot)
})

test('discovers EVM high-water marks from AA activity without scanning balances', async () => {
  const chain = mockDiscoveryChain({ usedNonces: [4], deployed: [2] })
  const evm = createMarketplaceEvmClient({
    chains: [chain],
    operationStore: new MemoryOperationStore(),
    seed: '7'.repeat(64),
    smartAccountAddressResolver: async ({ tradeIndex }) => indexedSmartAccount(tradeIndex),
  })

  assert.equal(typeof evm.discoverHighWatermark, 'function')
  assert.equal(typeof evm.accounts.ownerAccount, 'function')
  assert.equal('executor' in evm, false)

  const discovery = await evm.discoverHighWatermark({ highWaterMark: -1, unusedWindow: 6 })

  assert.equal(discovery.driver, 'evm')
  assert.equal(discovery.maxUsedIndex, 4)
  assert.equal(discovery.nextUnusedIndex, 5)
  assert.deepEqual(discovery.usedTradeIndexes, [2, 4])
  assert.deepEqual(
    discovery.trades.find(trade => trade.tradeIndex === 2).chains[0].reasons,
    ['smart_account_deployed'],
  )
  assert.deepEqual(
    discovery.trades.find(trade => trade.tradeIndex === 4).chains[0].reasons,
    ['entrypoint_nonce'],
  )
})

test('places escrow validation on the escrow client namespace', async () => {
  const evm = createMarketplaceEvmClient({
    chains: [],
    operationStore: new MemoryOperationStore(),
    executor: {
      async getAddress() {
        return '0x0000000000000000000000000000000000000000'
      },
      async execute() {
        throw new Error('not used')
      },
    },
  })

  assert.equal('validation' in evm, false)
  assert.equal(typeof evm.escrow.validate, 'function')
  assert.equal(typeof evm.auction.validate, 'function')

  const result = await evm.escrow.validate({
    chainId: 33,
    txHash: `0x${'1'.repeat(64)}`,
    tradeId: `0x${'2'.repeat(64)}`,
    contractAddress: '0x0000000000000000000000000000000000000000',
    sellerAddress: '0x0000000000000000000000000000000000000000',
    arbiterAddress: '0x0000000000000000000000000000000000000000',
    assetAddress: '0x0000000000000000000000000000000000000000',
    paymentAmount: { value: 1n, denomination: 'RBTC', decimals: 18 },
  })

  assert.equal(result.status, 'unverifiable')
})

test('marketplace validation accepts typed evm proof drivers', async () => {
  const policy = createEvmEscrowPolicy({
    chains: [],
    operationStore: new MemoryOperationStore(),
  })
  const request = {
    driver: 'evm:multi-escrow',
    proof: {
      driver: 'evm:multi-escrow',
      params: {
        txHash: `0x${'1'.repeat(64)}`,
        chainId: 33,
        tradeId: `0x${'2'.repeat(64)}`,
        contractAddress: '0x0000000000000000000000000000000000000000',
        sellerAddress: '0x0000000000000000000000000000000000000000',
        arbiterAddress: '0x0000000000000000000000000000000000000000',
        assetAddress: '0x0000000000000000000000000000000000000000',
        value: '1',
        paymentAmount: '1',
        bondAmount: '0',
        unlockAt: '0',
        denomination: 'RBTC',
        decimals: 18,
      },
    },
  }

  const typedResult = await policy.validatePayment(request)
  assert.equal(typedResult.status, 'unverifiable')
  assert.notEqual(typedResult.error, 'EVM validator cannot validate evm:multi-escrow')

  const wrongDriverResult = await policy.validatePayment({
    ...request,
    driver: 'cashu',
    proof: { ...request.proof, driver: 'cashu' },
  })
  assert.equal(wrongDriverResult.status, 'unverifiable')
  assert.equal(wrongDriverResult.error, 'EVM validator cannot validate cashu')
})

test('can build a configured executor from a local account and per-chain config', async t => {
  const rpcUrl = 'http://127.0.0.1:18546'
  if (!(await canRpc(rpcUrl))) {
    t.skip('local Arbitrum RPC is not running')
    return
  }

  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f09453811152280db9f94e9ec48b7cae4cf02b8c')
  const publicClient = createPublicClient({
    chain: {
      id: 412346,
      name: 'Arbitrum Regtest',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  })

  const evm = createMarketplaceEvmClient({
    chains: [{
      id: 'arbitrum-regtest',
      chainId: 412346,
      rpcUrl: 'http://127.0.0.1:18546',
      publicClient,
      nativeAsset: {
        chainId: 412346,
        address: '0x0000000000000000000000000000000000000000',
        denomination: 'ETH',
        decimals: 18,
      },
      accountAbstraction: aaConfig(),
    }],
    operationStore: new MemoryOperationStore(),
    account,
  })

  const smartAccount = await evm.executor.getAddress(412346)
  assert.match(smartAccount, /^0x[0-9a-fA-F]{40}$/)
  assert.notEqual(smartAccount.toLowerCase(), account.address.toLowerCase())
})

test('requires account abstraction config for every configured chain', () => {
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f09453811152280db9f94e9ec48b7cae4cf02b8c')
  const publicClient = createPublicClient({
    chain: {
      id: 412346,
      name: 'Arbitrum Regtest',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['http://127.0.0.1:18546'] } },
    },
    transport: http('http://127.0.0.1:18546'),
  })

  assert.throws(
    () => createMarketplaceEvmClient({
      chains: [{
        id: 'arbitrum-regtest',
        chainId: 412346,
        rpcUrl: 'http://127.0.0.1:18546',
        publicClient,
        nativeAsset: {
          chainId: 412346,
          address: '0x0000000000000000000000000000000000000000',
          denomination: 'ETH',
          decimals: 18,
        },
      }],
      operationStore: new MemoryOperationStore(),
      account,
    }),
    /requires accountAbstraction config/,
  )
})
