import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MemoryOperationStore, btcAmountToSats, createEvmSwapService, deriveEvmSwapMaterial } from '../dist/index.js'

const seed = '8'.repeat(64)

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

    async createReverseSwap(request) {
      this.reverseRequests.push(request)
      return {
        id: 'reverse-1',
        invoice: 'lnbc1reverse',
        onchainAmount: 50_000,
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
        address: '0x0000000000000000000000000000000000000010',
        timeoutBlockHeight: 456,
      }
    },

    async getSwap(id) {
      this.statusRequests.push(id)
      return {
        id,
        status: 'transaction.confirmed',
        transaction: {
          id: '0x' + 'a'.repeat(64),
        },
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
  const service = createEvmSwapService({ boltz, store, seed, accounts, now: () => 100 })
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
  })
  assert.equal(result.preimage, material.preimage)
  assert.equal(result.preimageHash, material.preimageHash)

  const stored = await store.get(material.operationId)
  assert.equal(stored.swapId, 'reverse-1')
  assert.equal(stored.status, 'external_payment_required')
  assert.equal(stored.data.invoice, 'lnbc1reverse')
  assert.equal(stored.data.refundAddress, '0x00000000000000000000000000000000000000f1')
  assert.equal('preimage' in stored.data.request, false)
  assert.equal(stored.data.request.preimageHash, material.preimageHash)

  const resumed = await service.resume(material.operationId)
  assert.equal(resumed.latestStatus.status, 'transaction.confirmed')
  assert.equal(resumed.operation.data.latestStatus.transaction.id, '0x' + 'a'.repeat(64))
  assert.deepEqual(boltz.statusRequests, ['reverse-1'])

  const active = await service.listActive()
  assert.deepEqual(active.map(record => record.id), [material.operationId])
})

test('swap-in skips to the next deterministic attempt on Boltz duplicate preimage hash', async () => {
  const duplicateError = new Error('Boltz API 400: {"error":"a swap with this preimage hash exists already"}')
  const boltz = boltzStub({
    async createReverseSwap(request) {
      this.reverseRequests.push(request)
      if (this.reverseRequests.length === 1) throw duplicateError
      return {
        id: 'reverse-2',
        invoice: 'lnbc1retry',
        onchainAmount: 50_000,
        refundAddress: '0x00000000000000000000000000000000000000f2',
        timeoutBlockHeight: 124,
      }
    },
  })
  const store = new MemoryOperationStore()
  const service = createEvmSwapService({ boltz, store, seed, accounts, now: () => 125 })
  const firstAttempt = deriveEvmSwapMaterial(seed, {
    tradeIndex: 2,
    chainId: 42161,
    direction: 'swap-in',
    attemptIndex: 0,
  })
  const secondAttempt = deriveEvmSwapMaterial(seed, {
    tradeIndex: 2,
    chainId: 42161,
    direction: 'swap-in',
    attemptIndex: 1,
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
  assert.equal(result.swapId, 'reverse-2')
  assert.equal(result.invoice, 'lnbc1retry')
  assert.equal(result.preimageHash, secondAttempt.preimageHash)
  assert.equal(boltz.reverseRequests.length, 2)
  assert.equal(boltz.reverseRequests[0].preimageHash, firstAttempt.preimageHash)
  assert.equal(boltz.reverseRequests[1].preimageHash, secondAttempt.preimageHash)
  assert.equal(await store.get(firstAttempt.operationId), null)

  const stored = await store.get(secondAttempt.operationId)
  assert.equal(stored.swapId, 'reverse-2')
  assert.equal(stored.data.request.attemptIndex, 1)
  assert.equal(stored.data.request.preimageHash, secondAttempt.preimageHash)
})

test('swap-in only retries the exact duplicate-preimage Boltz error', async () => {
  const boltz = boltzStub({
    async createReverseSwap(request) {
      this.reverseRequests.push(request)
      throw new Error('Boltz API 400: {"error":"a swap with this preimage hash exists already."}')
    },
  })
  const service = createEvmSwapService({
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
    /preimage hash exists already\./,
  )
  assert.equal(boltz.reverseRequests.length, 1)
})

test('swap-in converts BTC-denominated EVM base units to Boltz satoshis', async () => {
  const boltz = boltzStub()
  const service = createEvmSwapService({
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

test('converts BTC-like EVM amounts to sats with upward rounding', () => {
  assert.equal(btcAmountToSats({ value: 1_776_710_000_000_000n, denomination: 'BTC', decimals: 18 }), 177_671)
  assert.equal(btcAmountToSats({ value: 1_781_162_907_268_409n, denomination: 'BTC', decimals: 18 }), 178_117)
  assert.equal(btcAmountToSats({ value: 50_000n, denomination: 'tBTC', decimals: 8 }), 50_000)
  assert.equal(btcAmountToSats({ value: 1n, denomination: 'BTC', decimals: 18 }), 1)
})

test('swap-out stores invoice-required state before creating a Boltz swap', async () => {
  const boltz = boltzStub()
  const store = new MemoryOperationStore()
  const service = createEvmSwapService({ boltz, store, seed, accounts, now: () => 200 })
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
    amount: { value: 25_000n, denomination: 'tBTC', decimals: 8 },
    invoiceDescription: 'order payment',
  })

  assert.equal(result.type, 'external_invoice_required')
  assert.equal(boltz.submarineRequests.length, 0)

  const stored = await store.get(material.operationId)
  assert.equal(stored.status, 'external_invoice_required')
  assert.equal(stored.data.request.invoiceDescription, 'order payment')
})

test('swap-out persists the Boltz submarine swap and resumes status by swap id', async () => {
  const boltz = boltzStub()
  const store = new MemoryOperationStore()
  const service = createEvmSwapService({ boltz, store, seed, accounts, now: () => 300 })
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
    invoice: 'lnbc1submarine',
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
    invoice: 'lnbc1submarine',
  })

  const stored = await store.get(material.operationId)
  assert.equal(stored.swapId, 'submarine-1')
  assert.equal(stored.status, 'awaiting_onchain')
  assert.equal(stored.data.expectedAmount, 49_000)

  const resumed = await service.resume(material.operationId)
  assert.equal(resumed.latestStatus.status, 'transaction.confirmed')
  assert.deepEqual(boltz.statusRequests, ['submarine-1'])
})

test('resuming a missing swap fails loudly', async () => {
  const service = createEvmSwapService({
    boltz: boltzStub(),
    store: new MemoryOperationStore(),
    seed,
    accounts,
  })

  await assert.rejects(() => service.resume('missing-swap'), /Operation not found: missing-swap/)
})
