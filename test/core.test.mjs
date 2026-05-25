import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MemoryOperationStore,
  calculateEscrowFee,
  multiEscrowAbi,
  multiEscrowRuntimeBytecodeHash,
  normalizeBytes32,
} from '../dist/index.js'

test('normalizes bytes32 trade ids', () => {
  assert.equal(normalizeBytes32('A'.repeat(64)), `0x${'a'.repeat(64)}`)
})

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

test('re-exports the shared MultiEscrow contract artifact', () => {
  const tradeCreated = multiEscrowAbi.find(entry => entry.type === 'event' && entry.name === 'TradeCreated')
  assert.ok(tradeCreated)
  assert.equal(tradeCreated.inputs[2].name, 'seller')
  assert.equal(tradeCreated.inputs[3].name, 'buyer')
  assert.equal(tradeCreated.inputs[4].name, 'arbiter')
  assert.match(multiEscrowRuntimeBytecodeHash, /^0x[0-9a-f]{64}$/)
})
