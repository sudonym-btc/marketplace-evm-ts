import assert from 'node:assert/strict'
import { test } from 'node:test'

import { privateKeyToAccount } from 'viem/accounts'

import {
  MemoryOperationStore,
  createMarketplaceEvmClient,
  sha256Hex,
} from '../../dist/index.js'
import { amount, anvilFunder, randomTradeId, sendCall } from './support/evm.mjs'
import { arbitrumAaConfig, readStackConfig } from './support/stack.mjs'
import { createClients } from './support/evm.mjs'

const config = await readStackConfig()
const arbitrum = config.chains.arbitrumRegtest
const buyerAccount = privateKeyToAccount(anvilFunder.privateKey)
const sellerAddress = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const arbiterAddress = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const { publicClient, walletClient } = createClients(config, buyerAccount)

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
    if (call.name === 'MultiEscrow.createTrade') createTradeTxHash = txHash
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

async function getMultiEscrowRuntimeHash() {
  const code = await publicClient.getBytecode({ address: arbitrum.multiEscrow.address })
  assert.ok(code && code !== '0x')
  return sha256Hex(code)
}

test('stack exposes the expected EVM contracts and Boltz API', async () => {
  const code = await publicClient.getBytecode({ address: arbitrum.multiEscrow.address })
  assert.ok(code && code !== '0x')
  if (arbitrum.multiEscrow.runtimeBytecodeHash) {
    assert.equal(arbitrum.multiEscrow.runtimeBytecodeHash, await getMultiEscrowRuntimeHash())
  }

  const nodes = await fetch(`${config.boltz.apiUrl}/nodes`).then(response => response.json())
  assert.ok(nodes.BTC)
})

test('validates a USDT escrow deposit against MultiEscrow', async () => {
  const result = await createAndValidateEscrowTrade('USDT', 1_000_000n)
  assert.equal(result.status, 'valid')
  assert.equal(result.assetMatched, true)
  assert.equal(result.recipientMatched, true)
  assert.equal(result.escrowMatched, true)
})

test('validates a tBTC escrow deposit against MultiEscrow', async () => {
  const result = await createAndValidateEscrowTrade('TBTC', 100_000_000_000_000n)
  assert.equal(result.status, 'valid')
  assert.equal(result.assetMatched, true)
  assert.equal(result.recipientMatched, true)
  assert.equal(result.escrowMatched, true)
})
