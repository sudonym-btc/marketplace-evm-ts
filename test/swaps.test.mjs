import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SwapAmountLimitError, createEvmSwapService } from '../dist/index.js'
import { btcAmountToSats } from '../dist/swaps/amounts.js'
import { deriveEvmSwapMaterial } from '../dist/seed.js'
import { MemoryOperationStore } from '../dist/utils/store.js'
import { encodeAbiParameters, encodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

const seed = '8'.repeat(64)
const swapContract = '0x0000000000000000000000000000000000000010'
const routerContract = '0x0000000000000000000000000000000000000d0e'
const tokenA = '0x00000000000000000000000000000000000000ad'
const tokenB = '0x0000000000000000000000000000000000000b7c'
const runtimeHash = '0xf3df0a62b10f205b0f29768aa3d69e777154caaa179f64aabb0a4899c666b017'
const swapAbi = parseAbi(['function swap(address tokenIn,address tokenOut,address recipient,uint256 amountIn,uint256 amountOutMin)'])
const swapSelector = toFunctionSelector('swap(address,address,address,uint256,uint256)')
const approveSelector = toFunctionSelector('approve(address,uint256)')
const transferSelector = toFunctionSelector('transfer(address,uint256)')
const testInvoice = 'lnbc1qqqqqqqpp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq2xy284'

function persistedJson(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)
}

function createTestSwapService(options) {
  return createEvmSwapService({
    ...options,
    chains: [{
      chainId: 42161,
      publicClient: { async getBytecode() { return '0x6000' } },
    }],
    trustByChainId: {
      42161: {
        erc20Swap: { address: swapContract, runtimeBytecodeHash: runtimeHash },
        dexCallTargets: [
          ...[tokenA, tokenB].map(address => ({
            address,
            runtimeBytecodeHash: runtimeHash,
            functions: [
              { selector: approveSelector, decoder: 'erc20-approve-v1' },
              { selector: transferSelector, decoder: 'erc20-transfer-v1' },
            ],
          })),
          {
            address: routerContract,
            runtimeBytecodeHash: runtimeHash,
            functions: [{ selector: swapSelector, decoder: 'exact-input-v1' }],
          },
        ],
      },
    },
  })
}

const accounts = {
  ownerAccount() {
    throw new Error('not used')
  },
  async smartAccountAddress(tradeIndex) {
    return `0x${(0xc100n + BigInt(tradeIndex)).toString(16).padStart(40, '0')}`
  },
  executorForTradeIndex() {
    throw new Error('not used')
  },
}

function boltzStub(overrides = {}) {
  return {
    reverseRequests: [],
    submarineRequests: [],
    statusRequests: [],
    quoteInRequests: [],
    quoteOutRequests: [],
    encodeRequests: [],

    async getReversePairs() {
      return {
        BTC: {
          tBTC: {
            hash: 'reverse-pair-hash',
            rate: 1,
            limits: { minimal: 50_000, maximal: 4_294_967 },
            fees: { percentage: 0.25, minerFees: { claim: 66, lockup: 232 } },
          },
        },
      }
    },

    async getSubmarinePairs() {
      return {
        tBTC: {
          BTC: {
            hash: 'submarine-pair-hash',
            rate: 1,
            limits: { minimal: 50_000, maximal: 4_294_967, maximalZeroConf: 0 },
            fees: { percentage: 0.1, minerFees: 33 },
          },
        },
      }
    },

    async createReverseSwap(request) {
      this.reverseRequests.push(request)
      return {
        id: 'reverse-1',
        invoice: 'lnbc1reverse',
        onchainAmount: 50_000,
        lockupAddress: swapContract,
        refundAddress: '0x00000000000000000000000000000000000000f1',
        timeoutBlockHeight: 123,
      }
    },

    async createSubmarineSwap(request) {
      this.submarineRequests.push(request)
      return {
        id: 'submarine-1',
        expectedAmount: 49_000,
        claimAddress: '0x00000000000000000000000000000000000000c1',
        address: swapContract,
        timeoutBlockHeight: 456,
      }
    },

    async quoteTokenAmountOut(currency, request) {
      this.quoteOutRequests.push({ currency, request })
      return {
        amountIn: 500_000_000_000_000n,
        amountOut: request.amount,
        data: { type: 'mock-dex', tokenIn: request.tokenIn, tokenOut: request.tokenOut },
      }
    },

    async quoteTokenAmountIn(currency, request) {
      this.quoteInRequests.push({ currency, request })
      return {
        amountIn: request.amount,
        amountOut: 500_000_000_000_000n,
        data: { type: 'mock-dex', tokenIn: request.tokenIn, tokenOut: request.tokenOut },
      }
    },

    async encodeTokenSwap(currency, request) {
      this.encodeRequests.push({ currency, request })
      return [
        {
          name: 'ERC20.approve',
          to: request.data.tokenIn,
          value: 0n,
          data: encodeFunctionData({
            abi: parseAbi(['function approve(address spender,uint256 amount)']),
            functionName: 'approve',
            args: [routerContract, request.amountIn],
          }),
        },
        {
          name: 'DEX.swap',
          to: routerContract,
          value: 0n,
          data: encodeFunctionData({
            abi: swapAbi,
            functionName: 'swap',
            args: [request.data.tokenIn, request.data.tokenOut, request.recipient, request.amountIn, request.amountOutMin],
          }),
        },
      ]
    },

    async getSwap(id) {
      this.statusRequests.push(id)
      return {
        id,
        status: 'transaction.confirmed',
        transaction: {
          id: '0x' + 'a'.repeat(64),
          hex: 'provider-opaque-transaction-secret',
        },
        error: 'provider-opaque-error-secret',
        unknownExtension: { secret: 'provider-opaque-extension-secret' },
      }
    },

    subscribeSwap() {
      throw new Error('not used')
    },

    ...overrides,
  }
}

test('swap-in persists the Boltz reverse swap and can be resumed from storage', async () => {
  const boltz = boltzStub()
  const store = new MemoryOperationStore()
  const service = createTestSwapService({ boltz, store, seed, accounts, now: () => 100 })
  const material = deriveEvmSwapMaterial(seed, {
    tradeIndex: 2,
    chainId: 42161,
    direction: 'swap-in',
    attemptIndex: 0,
  })

  const result = await service.swapIn({
    tradeIndex: 2,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    amount: { value: 50_000n, denomination: 'tBTC', decimals: 8 },
    boltzAmountSats: 50_000,
  })

  assert.equal(result.type, 'external_payment_required')
  assert.equal(result.swapId, 'reverse-1')
  assert.equal(result.onchainAmount, 50_000)
  assert.equal(result.timeoutBlockHeight, 123)
  assert.equal(boltz.reverseRequests.length, 1)
  assert.deepEqual(boltz.reverseRequests[0], {
    from: 'BTC',
    to: 'tBTC',
    preimageHash: material.preimageHash,
    claimAddress: '0x000000000000000000000000000000000000c102',
    onchainAmount: 50_000,
    pairHash: 'reverse-pair-hash',
  })
  assert.deepEqual(result.limits, {
    source: 'boltz',
    direction: 'swap-in',
    from: 'BTC',
    to: 'tBTC',
    amountSats: 50_000,
    minimal: 50_000,
    maximal: 4_294_967,
    pairHash: 'reverse-pair-hash',
  })
  assert.equal(result.preimage, material.preimage)
  assert.equal(result.preimageHash, material.preimageHash)

  const retried = await service.swapIn({
    tradeIndex: 2,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    amount: { value: 50_000n, denomination: 'tBTC', decimals: 8 },
    boltzAmountSats: 50_000,
  })
  assert.equal(retried.type, 'external_payment_required')
  assert.equal(retried.swapId, result.swapId)
  assert.equal(boltz.reverseRequests.length, 1)

  const stored = await store.get(material.operationId)
  assert.equal(stored.swapId, 'reverse-1')
  assert.equal(stored.status, 'external_payment_required')
  assert.equal('invoice' in stored.data, false)
  assert.equal(stored.data.refundAddress, '0x00000000000000000000000000000000000000f1')
  assert.equal('preimage' in stored.data.request, false)
  assert.equal('preimageHash' in stored.data.request, false)
  assert.equal(persistedJson(stored).includes(material.preimage), false)
  assert.equal(persistedJson(stored).includes('lnbc1reverse'), false)

  const resumed = await service.resume(material.operationId)
  assert.equal(resumed.latestStatus.status, 'transaction.confirmed')
  assert.deepEqual(resumed.operation.data.providerStatus, {
    status: 'transaction.confirmed',
    id: 'reverse-1',
    transactionHash: '0x' + 'a'.repeat(64),
  })
  assert.equal('latestStatus' in resumed.operation.data, false)
  assert.equal(persistedJson(resumed.operation).includes('provider-opaque'), false)
  assert.deepEqual(boltz.statusRequests, ['reverse-1'])

  const restarted = createTestSwapService({ boltz, store, seed, accounts, now: () => 101 })
  await assert.rejects(() => restarted.swapIn({
    tradeIndex: 2,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    amount: { value: 50_000n, denomination: 'tBTC', decimals: 8 },
    boltzAmountSats: 50_000,
  }), /invoice is intentionally not persisted/)
  assert.equal(boltz.reverseRequests.length, 1)

  const active = await service.listActive()
  assert.deepEqual(active.map(record => record.id), [material.operationId])
})

test('swap-in fails closed instead of creating a parallel swap on duplicate preimage hash', async () => {
  const duplicateError = new Error('Boltz API 400: {"error":"a swap with this preimage hash exists already"}')
  const boltz = boltzStub({
    async createReverseSwap(request) {
      this.reverseRequests.push(request)
      throw duplicateError
    },
  })
  const store = new MemoryOperationStore()
  const service = createTestSwapService({ boltz, store, seed, accounts, now: () => 125 })
  const firstAttempt = deriveEvmSwapMaterial(seed, {
    tradeIndex: 2,
    chainId: 42161,
    direction: 'swap-in',
    attemptIndex: 0,
  })
  await assert.rejects(() => service.swapIn({
    tradeIndex: 2,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    amount: { value: 50_000n, denomination: 'tBTC', decimals: 8 },
    boltzAmountSats: 50_000,
  }), /refusing to create a parallel swap/)

  assert.equal(boltz.reverseRequests.length, 1)
  assert.equal(boltz.reverseRequests[0].preimageHash, firstAttempt.preimageHash)
  const stored = await store.get(firstAttempt.operationId)
  assert.equal(stored.status, 'failed')
  assert.equal(stored.data.creationAmbiguous, true)
  assert.equal(stored.error, 'Boltz reports this deterministic preimage hash already exists; refusing to create a parallel swap')
  assert.equal(persistedJson(stored).includes(duplicateError.message), false)
})

test('swap-in only retries the exact duplicate-preimage Boltz error', async () => {
  const boltz = boltzStub({
    async createReverseSwap(request) {
      this.reverseRequests.push(request)
      throw new Error('Boltz API 400: {"error":"a swap with this preimage hash exists already."}')
    },
  })
  const service = createTestSwapService({
    boltz,
    store: new MemoryOperationStore(),
    seed,
    accounts,
    now: () => 130,
  })

  await assert.rejects(
    () =>
      service.swapIn({
        tradeIndex: 2,
        attemptIndex: 0,
        chainId: 42161,
        boltzCurrency: 'tBTC',
        lightningCurrency: 'BTC',
        amount: { value: 50_000n, denomination: 'tBTC', decimals: 8 },
        boltzAmountSats: 50_000,
      }),
    /Unable to safely create Boltz swap-in|preimage hash exists already/,
  )
  assert.equal(boltz.reverseRequests.length, 1)
})

test('swap-in converts BTC-denominated EVM base units to Boltz satoshis', async () => {
  const boltz = boltzStub()
  const service = createTestSwapService({
    boltz,
    store: new MemoryOperationStore(),
    seed,
    accounts,
    now: () => 150,
  })

  const result = await service.swapIn({
    tradeIndex: 2,
    attemptIndex: 1,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    amount: { value: 1_776_710_000_000_000n, denomination: 'BTC', decimals: 18 },
  })

  assert.equal(result.type, 'external_payment_required')
  assert.equal(boltz.reverseRequests[0].onchainAmount, 177_671)
})

test('swap-in rejects amounts below Boltz reverse swap limits before creating a swap', async () => {
  const boltz = boltzStub()
  const service = createTestSwapService({
    boltz,
    store: new MemoryOperationStore(),
    seed,
    accounts,
  })

  await assert.rejects(
    () =>
      service.swapIn({
        tradeIndex: 2,
        attemptIndex: 0,
        chainId: 42161,
        boltzCurrency: 'tBTC',
        lightningCurrency: 'BTC',
        amount: { value: 20_283n, denomination: 'tBTC', decimals: 8 },
      }),
    error => {
      assert.equal(error instanceof SwapAmountLimitError, true)
      assert.equal(error.reason, 'below_minimum')
      assert.equal(error.limits.minimal, 50_000)
      assert.equal(error.limits.amountSats, 20_283)
      return true
    },
  )
  assert.equal(boltz.reverseRequests.length, 0)
})

test('swap-in performs no provider side effect when chain trust roots are missing', async () => {
  const boltz = boltzStub()
  const service = createEvmSwapService({
    boltz,
    store: new MemoryOperationStore(),
    seed,
    accounts,
    chains: [{ chainId: 42161, publicClient: { async getBytecode() { return '0x6000' } } }],
  })
  await assert.rejects(() => service.swapIn({
    tradeIndex: 9,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    amount: { value: 50_000n, denomination: 'tBTC', decimals: 8 },
  }), /No Boltz trust roots configured/)
  assert.equal(boltz.reverseRequests.length, 0)
})

test('swap-in rejects unsupported Boltz pairs before amount conversion', async () => {
  const boltz = boltzStub()
  const service = createTestSwapService({
    boltz,
    store: new MemoryOperationStore(),
    seed,
    accounts,
  })

  await assert.rejects(
    () =>
      service.swapIn({
        tradeIndex: 2,
        attemptIndex: 0,
        chainId: 42161,
        boltzCurrency: 'USDT',
        lightningCurrency: 'BTC',
        amount: { value: 1_000_000n, denomination: 'USD', decimals: 6 },
      }),
    error => {
      assert.equal(error instanceof SwapAmountLimitError, true)
      assert.equal(error.reason, 'unsupported_pair')
      assert.equal(error.limits.from, 'BTC')
      assert.equal(error.limits.to, 'USDT')
      return true
    },
  )
  assert.equal(boltz.reverseRequests.length, 0)
})

test('swap-in routes stablecoin funding through tBTC DEX calls before post-claim escrow calls', async () => {
  const boltz = boltzStub()
  const store = new MemoryOperationStore()
  const service = createTestSwapService({ boltz, store, seed, accounts, now: () => 175 })
  const escrowCall = {
    name: 'Escrow.createTrade',
    to: '0x0000000000000000000000000000000000000e50',
    value: 0n,
    data: '0xabcd',
  }

  const result = await service.swapIn({
    tradeIndex: 2,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'USDT',
    lightningCurrency: 'BTC',
    assetAddress: '0x00000000000000000000000000000000000000ad',
    amount: { value: 225_000_000n, denomination: 'USD', decimals: 6 },
    routeVia: {
      boltzCurrency: 'tBTC',
      assetAddress: '0x0000000000000000000000000000000000000b7c',
      decimals: 18,
      quoteCurrency: 'ARB',
    },
    postClaimCalls: [escrowCall],
  })

  assert.equal(result.type, 'external_payment_required')
  assert.equal(result.claimAssetAddress, '0x0000000000000000000000000000000000000b7c')
  assert.deepEqual(boltz.quoteOutRequests, [{
    currency: 'ARB',
    request: {
      tokenIn: '0x0000000000000000000000000000000000000b7c',
      tokenOut: '0x00000000000000000000000000000000000000ad',
      amount: 225_000_000n,
    },
  }])
  assert.deepEqual(boltz.encodeRequests, [{
    currency: 'ARB',
    request: {
      recipient: '0x000000000000000000000000000000000000c102',
      amountIn: 500_000_000_000_000n,
      amountOutMin: 225_000_000n,
      data: {
        type: 'mock-dex',
        tokenIn: '0x0000000000000000000000000000000000000b7c',
        tokenOut: '0x00000000000000000000000000000000000000ad',
      },
    },
  }])
  assert.equal(boltz.reverseRequests[0].to, 'tBTC')
  assert.equal(boltz.reverseRequests[0].onchainAmount, 50_000)
  assert.deepEqual(result.postClaimCalls.map(call => call.name), ['ERC20.approve', 'DEX.swap', escrowCall.name])

  const stored = await store.get(result.operation.id)
  assert.equal(stored.data.claimAssetAddress, '0x0000000000000000000000000000000000000b7c')
  assert.deepEqual(stored.data.request, {
    tradeIndex: 2,
    attemptIndex: 0,
    chainId: 42161,
    assetAddress: '0x00000000000000000000000000000000000000ad',
  })
  assert.equal(stored.data.postClaimCalls.length, 3)
})

test('routed swap trust is verified before provider quote or encoding calls', async () => {
  const boltz = boltzStub()
  const service = createEvmSwapService({
    boltz,
    store: new MemoryOperationStore(),
    seed,
    accounts,
    chains: [{
      chainId: 42161,
      publicClient: {
        async getBytecode({ address }) {
          return address.toLowerCase() === routerContract.toLowerCase() ? '0x6001' : '0x6000'
        },
      },
    }],
    trustByChainId: {
      42161: {
        erc20Swap: { address: swapContract, runtimeBytecodeHash: runtimeHash },
        dexCallTargets: [{
          address: routerContract,
          runtimeBytecodeHash: runtimeHash,
          functions: [{ selector: swapSelector, decoder: 'exact-input-v1' }],
        }],
      },
    },
  })

  await assert.rejects(() => service.swapIn({
    tradeIndex: 11,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'USDT',
    assetAddress: '0x00000000000000000000000000000000000000ad',
    amount: { value: 225_000_000n, denomination: 'USD', decimals: 6 },
    routeVia: {
      boltzCurrency: 'tBTC',
      assetAddress: '0x0000000000000000000000000000000000000b7c',
      decimals: 18,
      quoteCurrency: 'ARB',
    },
  }), /runtime bytecode hash mismatch/)
  assert.equal(boltz.quoteOutRequests.length, 0)
  assert.equal(boltz.encodeRequests.length, 0)
  assert.equal(boltz.reverseRequests.length, 0)
})

test('swap-in rejects provider calls to an untrusted DEX target before creating a swap', async () => {
  const boltz = boltzStub({
    async encodeTokenSwap(_currency, request) {
      return [{
        name: 'malicious',
        to: '0x0000000000000000000000000000000000000bad',
        data: encodeFunctionData({
          abi: swapAbi,
          functionName: 'swap',
          args: [request.data.tokenIn, request.data.tokenOut, request.recipient, request.amountIn, request.amountOutMin],
        }),
      }]
    },
  })
  const service = createTestSwapService({ boltz, store: new MemoryOperationStore(), seed, accounts })
  await assert.rejects(() => service.swapIn({
    tradeIndex: 7,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'USDT',
    assetAddress: '0x00000000000000000000000000000000000000ad',
    amount: { value: 225_000_000n, denomination: 'USD', decimals: 6 },
    routeVia: {
      boltzCurrency: 'tBTC',
      assetAddress: '0x0000000000000000000000000000000000000b7c',
      decimals: 18,
      quoteCurrency: 'ARB',
    },
  }), /not allowlisted|missing an exact ERC-20 input approval/)
  assert.equal(boltz.reverseRequests.length, 0)
})

test('DEX validation ignores irrelevant expected words and rejects malicious decoded arguments', async () => {
  const tokenIn = '0x0000000000000000000000000000000000000b7c'
  const tokenOut = '0x00000000000000000000000000000000000000ad'
  const boltz = boltzStub({
    async encodeTokenSwap(_currency, request) {
      const approval = encodeFunctionData({
        abi: parseAbi(['function approve(address spender,uint256 amount)']),
        functionName: 'approve',
        args: [routerContract, request.amountIn],
      })
      const malicious = encodeFunctionData({
        abi: swapAbi,
        functionName: 'swap',
        args: [
          '0x0000000000000000000000000000000000000bad',
          '0x0000000000000000000000000000000000000bee',
          '0x0000000000000000000000000000000000000def',
          1n,
          1n,
        ],
      })
      const irrelevantExpectedWords = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
        [tokenIn, tokenOut, request.recipient, request.amountIn, request.amountOutMin],
      )
      return [
        { name: 'ERC20.approve', to: tokenIn, data: approval },
        { name: 'DEX.swap', to: routerContract, data: `${malicious}${irrelevantExpectedWords.slice(2)}` },
      ]
    },
  })
  const service = createTestSwapService({ boltz, store: new MemoryOperationStore(), seed, accounts })
  await assert.rejects(() => service.swapIn({
    tradeIndex: 10,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'USDT',
    assetAddress: tokenOut,
    amount: { value: 225_000_000n, denomination: 'USD', decimals: 6 },
    routeVia: { boltzCurrency: 'tBTC', assetAddress: tokenIn, decimals: 18, quoteCurrency: 'ARB' },
  }), /input token does not match quote/)
  assert.equal(boltz.reverseRequests.length, 0)
})

test('swap-in refuses to expose a preimage for an untrusted swap contract', async () => {
  const boltz = boltzStub({
    async createReverseSwap(request) {
      this.reverseRequests.push(request)
      return {
        id: 'malicious-reverse',
        invoice: 'lnbc1malicious',
        onchainAmount: 50_000,
        lockupAddress: '0x0000000000000000000000000000000000000bad',
        refundAddress: '0x00000000000000000000000000000000000000f1',
        timeoutBlockHeight: 123,
      }
    },
  })
  const store = new MemoryOperationStore()
  const service = createTestSwapService({ boltz, store, seed, accounts })
  await assert.rejects(() => service.swapIn({
    tradeIndex: 8,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    amount: { value: 50_000n, denomination: 'tBTC', decimals: 8 },
  }), error => {
    assert.equal(error.message, 'Unable to safely create Boltz swap-in')
    assert.match(error.cause?.message ?? '', /does not match the configured ERC20Swap deployment/)
    return true
  })
  const [record] = await store.list({ kind: 'swap_in' })
  assert.equal(record.status, 'failed')
  assert.equal(record.swapId, 'malicious-reverse')
  assert.equal(record.error, 'Unable to safely create Boltz swap-in')
  assert.equal(persistedJson(record).includes('does not match the configured ERC20Swap deployment'), false)
})

test('converts BTC-like EVM amounts to sats with upward rounding', () => {
  assert.equal(btcAmountToSats({ value: 1_776_710_000_000_000n, denomination: 'BTC', decimals: 18 }), 177_671)
  assert.equal(btcAmountToSats({ value: 1_781_162_907_268_409n, denomination: 'BTC', decimals: 18 }), 178_117)
  assert.equal(btcAmountToSats({ value: 50_000n, denomination: 'tBTC', decimals: 8 }), 50_000)
  assert.equal(btcAmountToSats({ value: 1n, denomination: 'BTC', decimals: 18 }), 1)
})

test('swap-out stores invoice-required state before creating a Boltz swap', async () => {
  const boltz = boltzStub()
  const store = new MemoryOperationStore()
  const service = createTestSwapService({ boltz, store, seed, accounts, now: () => 200 })
  const material = deriveEvmSwapMaterial(seed, {
    tradeIndex: 3,
    chainId: 42161,
    direction: 'swap-out',
    attemptIndex: 0,
  })

  const result = await service.swapOut({
    tradeIndex: 3,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    amount: { value: 60_000n, denomination: 'tBTC', decimals: 8 },
    invoiceDescription: 'order payment',
  })

  assert.equal(result.type, 'external_invoice_required')
  assert.equal(result.amount.value, 60_000n)
  assert.equal(result.invoiceAmountSats, 59_907)
  assert.equal(boltz.submarineRequests.length, 0)

  const stored = await store.get(material.operationId)
  assert.equal(stored.status, 'external_invoice_required')
  assert.deepEqual(stored.data.request, { tradeIndex: 3, attemptIndex: 0, chainId: 42161 })
  assert.equal(stored.data.invoiceAmountSats, 59_907)
})

test('swap-out persists the Boltz submarine swap and resumes status by swap id', async () => {
  const boltz = boltzStub()
  const store = new MemoryOperationStore()
  const service = createTestSwapService({ boltz, store, seed, accounts, now: () => 300 })
  const material = deriveEvmSwapMaterial(seed, {
    tradeIndex: 4,
    chainId: 42161,
    direction: 'swap-out',
    attemptIndex: 1,
  })

  const result = await service.swapOut({
    tradeIndex: 4,
    attemptIndex: 1,
    chainId: 42161,
    boltzCurrency: 'tBTC',
    lightningCurrency: 'BTC',
    invoice: testInvoice,
  })

  assert.equal(result.type, 'awaiting_resolution')
  assert.equal(result.swapId, 'submarine-1')
  assert.equal(result.expectedAmount, 49_000)
  assert.equal(result.claimAddress, '0x00000000000000000000000000000000000000c1')
  assert.equal(result.lockupAddress, '0x0000000000000000000000000000000000000010')
  assert.equal(result.timeoutBlockHeight, 456)
  assert.deepEqual(boltz.submarineRequests[0], {
    from: 'tBTC',
    to: 'BTC',
    invoice: testInvoice,
    pairHash: 'submarine-pair-hash',
  })

  const stored = await store.get(material.operationId)
  assert.equal(stored.swapId, 'submarine-1')
  assert.equal(stored.status, 'awaiting_onchain')
  assert.equal(stored.data.expectedAmount, 49_000)
  assert.equal(persistedJson(stored).includes(testInvoice), false)

  const resumed = await service.resume(material.operationId)
  assert.equal(resumed.latestStatus.status, 'transaction.confirmed')
  assert.deepEqual(boltz.statusRequests, ['submarine-1'])
})

test('swap-out routes stablecoin balance through DEX calls before the Boltz lock', async () => {
  const boltz = boltzStub()
  const store = new MemoryOperationStore()
  const service = createTestSwapService({ boltz, store, seed, accounts, now: () => 325 })
  const withdrawCall = {
    name: 'MultiEscrow.withdraw',
    to: '0x0000000000000000000000000000000000000e50',
    value: 0n,
    data: '0xabcd',
  }

  const result = await service.swapOut({
    tradeIndex: 5,
    attemptIndex: 0,
    chainId: 42161,
    boltzCurrency: 'USDT',
    lightningCurrency: 'BTC',
    assetAddress: '0x00000000000000000000000000000000000000ad',
    amount: { value: 225_000_000n, denomination: 'USD', decimals: 6 },
    invoice: testInvoice,
    routeVia: {
      boltzCurrency: 'tBTC',
      assetAddress: '0x0000000000000000000000000000000000000b7c',
      decimals: 18,
      quoteCurrency: 'ARB',
    },
    preLockCalls: [withdrawCall],
  })

  assert.equal(result.type, 'awaiting_resolution')
  assert.equal(result.lockAssetAddress, '0x0000000000000000000000000000000000000b7c')
  assert.deepEqual(boltz.quoteInRequests, [{
    currency: 'ARB',
    request: {
      tokenIn: '0x00000000000000000000000000000000000000ad',
      tokenOut: '0x0000000000000000000000000000000000000b7c',
      amount: 225_000_000n,
    },
  }])
  assert.deepEqual(boltz.encodeRequests, [{
    currency: 'ARB',
    request: {
      recipient: '0x000000000000000000000000000000000000c105',
      amountIn: 225_000_000n,
      amountOutMin: 500_000_000_000_000n,
      data: {
        type: 'mock-dex',
        tokenIn: '0x00000000000000000000000000000000000000ad',
        tokenOut: '0x0000000000000000000000000000000000000b7c',
      },
    },
  }])
  assert.deepEqual(boltz.submarineRequests[0], {
    from: 'tBTC',
    to: 'BTC',
    invoice: testInvoice,
    pairHash: 'submarine-pair-hash',
  })
  assert.deepEqual(result.preLockCalls.map(call => call.name), [withdrawCall.name, 'ERC20.approve', 'DEX.swap'])

  const stored = await store.get(result.operation.id)
  assert.equal(stored.data.lockAssetAddress, '0x0000000000000000000000000000000000000b7c')
  assert.deepEqual(stored.data.request, {
    tradeIndex: 5,
    attemptIndex: 0,
    chainId: 42161,
    assetAddress: '0x00000000000000000000000000000000000000ad',
  })
  assert.equal(stored.data.preLockCalls.length, 3)
  assert.equal(persistedJson(stored).includes(testInvoice), false)
})

test('resuming a missing swap fails loudly', async () => {
  const service = createTestSwapService({
    boltz: boltzStub(),
    store: new MemoryOperationStore(),
    seed,
    accounts,
  })

  await assert.rejects(() => service.resume('missing-swap'), /Operation not found: missing-swap/)
})
