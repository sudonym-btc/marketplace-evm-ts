import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'

import {
  createMarketplaceEvmClient,
} from '../../dist/index.js'
import { MemoryOperationStore } from '../../dist/utils/store.js'
import { sha256Hex as runtimeSha256Hex } from '../../dist/utils/sha256.js'
import {
  amount,
  createAccount,
  createClients,
  escrowBalance,
  fundAccount,
  randomTradeId,
  assetBalance,
} from './support/evm.mjs'
import { readStackConfig } from './support/stack.mjs'

const config = await readStackConfig()
const arbitrum = config.chains.arbitrumRegtest
const usdt = arbitrum.assets.USDT
const multiEscrow = arbitrum.multiEscrow.address
const { publicClient } = createClients(config)

function aaConfig() {
  const host = process.env.MARKETPLACE_EVM_STACK_HOST ?? '127.0.0.1'
  return {
    bundlerUrl:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_BUNDLER_URL ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_BUNDLER_URL ??
      `http://${host}:4337`,
    paymasterUrl:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_PAYMASTER_URL ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_PAYMASTER_URL ??
      `http://${host}:3010`,
    entryPointAddress:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_ENTRY_POINT_ADDRESS ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_ENTRY_POINT_ADDRESS ??
      '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_ACCOUNT_FACTORY_ADDRESS ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_ACCOUNT_FACTORY_ADDRESS ??
      '0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985',
    paymasterAddress:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_PAYMASTER_ADDRESS ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_PAYMASTER_ADDRESS ??
      '0x38aef040CEB057B62E1598F5C265946A4E4BaB4C',
  }
}

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

function chainConfig() {
  const aa = aaConfig()
  return {
    id: 'arbitrum-regtest',
    chainId: arbitrum.chainId,
    rpcUrl: arbitrum.rpcUrl,
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
    accountAbstraction: {
      entryPointAddress: aa.entryPointAddress,
      entryPointVersion: '0.7',
      factoryAddress: aa.factoryAddress,
      bundlerUrl: aa.bundlerUrl,
      paymasterUrl: aa.paymasterUrl,
      paymasterAddress: aa.paymasterAddress,
      userOperationReceiptTimeoutMs: 120_000,
    },
  }
}

function makeAaEvm(account) {
  return createMarketplaceEvmClient({
    chains: [chainConfig()],
    operationStore: new MemoryOperationStore(),
    account,
  })
}

function makeSeededAaEvm(seed, tradeIndex) {
  return createMarketplaceEvmClient({
    chains: [chainConfig()],
    operationStore: new MemoryOperationStore(),
    seed,
    tradeIndex,
  })
}

function makeRecoveryEvm(seed) {
  return createMarketplaceEvmClient({
    chains: [chainConfig()],
    operationStore: new MemoryOperationStore(),
    seed,
  })
}

async function multiEscrowRuntimeHash() {
  const code = await publicClient.getBytecode({ address: multiEscrow })
  assert.ok(code && code !== '0x')
  return runtimeSha256Hex(code)
}

test('AA paymaster creates a USDT escrow with a zero-native-balance smart account', { timeout: 180_000 }, async t => {
  const aa = aaConfig()
  if (!(await canRpc(aa.bundlerUrl)) || !(await canRpc(aa.paymasterUrl))) {
    t.skip('local account-abstraction bundler/paymaster is not running')
    return
  }

  const buyerOwner = createAccount()
  const evm = makeAaEvm(buyerOwner)
  const buyerSmartAccount = await evm.executor.getAddress(arbitrum.chainId)
  assert.equal(await publicClient.getBalance({ address: buyerSmartAccount }), 0n)

  const paymentValue = 1_500_000n
  await fundAccount(config, publicClient, { address: buyerSmartAccount }, { usdt: paymentValue })
  assert.equal(await assetBalance(publicClient, usdt.address, buyerSmartAccount), paymentValue)

  const seller = createAccount()
  const arbiter = createAccount()
  const tradeId = randomTradeId()
  const paymentAmount = amount(paymentValue, usdt)
  const calls = evm.escrow.createTrade({
    tradeId,
    buyerAddress: buyerSmartAccount,
    sellerAddress: seller.address,
    arbiterAddress: arbiter.address,
    assetAddress: usdt.address,
    paymentAmount,
    contractAddress: multiEscrow,
    unlockAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })

  const execution = await evm.executor.execute(calls, { chainId: arbitrum.chainId })
  assert.equal(execution.gasSponsored, true)
  assert.match(execution.txHash, /^0x[0-9a-f]{64}$/)
  assert.match(execution.userOperationHash, /^0x[0-9a-f]{64}$/)
  assert.equal(await publicClient.getBalance({ address: buyerSmartAccount }), 0n)

  const validation = await evm.escrow.validate({
    chainId: arbitrum.chainId,
    txHash: execution.txHash,
    tradeId,
    contractAddress: multiEscrow,
    contractBytecodeHash: await multiEscrowRuntimeHash(),
    sellerAddress: seller.address,
    arbiterAddress: arbiter.address,
    assetAddress: usdt.address,
    paymentAmount,
  })
  assert.equal(validation.status, 'valid')
  assert.equal(await assetBalance(publicClient, usdt.address, buyerSmartAccount), 0n)
  assert.equal(await escrowBalance(publicClient, multiEscrow, seller.address, usdt.address), 0n)
})

test('recovers a skipped EVM trade index from chain activity only', { timeout: 180_000 }, async t => {
  const aa = aaConfig()
  if (!(await canRpc(aa.bundlerUrl)) || !(await canRpc(aa.paymasterUrl))) {
    t.skip('local account-abstraction bundler/paymaster is not running')
    return
  }

  const seed = randomBytes(32).toString('hex')
  const skippedTradeIndex = 3
  const evm = makeSeededAaEvm(seed, skippedTradeIndex)
  const buyerSmartAccount = await evm.executor.getAddress(arbitrum.chainId)

  const paymentValue = 1_250_000n
  await fundAccount(config, publicClient, { address: buyerSmartAccount }, { usdt: paymentValue })

  const seller = createAccount()
  const arbiter = createAccount()
  const tradeId = randomTradeId()
  const calls = evm.escrow.createTrade({
    tradeId,
    buyerAddress: buyerSmartAccount,
    sellerAddress: seller.address,
    arbiterAddress: arbiter.address,
    assetAddress: usdt.address,
    paymentAmount: amount(paymentValue, usdt),
    contractAddress: multiEscrow,
    unlockAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })

  await evm.executor.execute(calls, { chainId: arbitrum.chainId })

  const recovered = makeRecoveryEvm(seed)
  const discovery = await recovered.discoverHighWatermark({
    highWaterMark: -1,
    unusedWindow: 5,
  })

  assert.equal(discovery.maxUsedIndex, skippedTradeIndex)
  assert.deepEqual(discovery.usedTradeIndexes, [skippedTradeIndex])
  const recoveredTrade = discovery.trades.find(trade => trade.tradeIndex === skippedTradeIndex)
  assert.ok(recoveredTrade)
  assert.equal(recoveredTrade.used, true)
  assert.ok(
    recoveredTrade.chains[0].reasons.includes('entrypoint_nonce') ||
      recoveredTrade.chains[0].reasons.includes('smart_account_deployed'),
  )
})
