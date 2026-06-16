import { randomBytes } from 'node:crypto'

import { multiEscrowAbi } from '@sudonym-btc/marketplace-evm-contracts'
import { createPublicClient, createWalletClient, encodeFunctionData, hashStruct, http, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import erc20Artifact from 'boltz-core/out/ERC20.sol/ERC20.json' with { type: 'json' }
import erc20SwapArtifact from 'boltz-core/out/ERC20Swap.sol/ERC20Swap.json' with { type: 'json' }

import { arbitrumChain } from './stack.mjs'

export const erc20Abi = erc20Artifact.abi
export const erc20SwapAbi = erc20SwapArtifact.abi

export const anvilFunder = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
}

export function accountFromPrivateKey(privateKey) {
  return privateKeyToAccount(privateKey)
}

export function createAccount() {
  return privateKeyToAccount(generatePrivateKey())
}

export function createClients(config, account = privateKeyToAccount(anvilFunder.privateKey)) {
  const chain = arbitrumChain(config)
  return {
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http(config.chains.arbitrumRegtest.rpcUrl),
    }),
    walletClient: createWalletClient({
      account,
      chain,
      transport: http(config.chains.arbitrumRegtest.rpcUrl),
    }),
  }
}

export async function sendCall(publicClient, walletClient, account, call) {
  const hash = await walletClient.sendTransaction({
    account,
    to: call.to,
    data: call.data,
    value: call.value,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${call.name ?? 'call'} reverted: ${hash}`)
  return hash
}

export async function sendCalls(publicClient, walletClient, account, calls) {
  let txHash
  for (const call of calls) {
    txHash = await sendCall(publicClient, walletClient, account, call)
  }
  return txHash
}

export async function fundAccount(config, publicClient, account, { eth = '0', tbtc = 0n, usdt = 0n } = {}) {
  const funder = privateKeyToAccount(anvilFunder.privateKey)
  const { walletClient } = createClients(config, funder)
  const assets = config.chains.arbitrumRegtest.assets

  if (eth && parseEther(eth) > 0n) {
    const hash = await walletClient.sendTransaction({
      account: funder,
      to: account.address,
      value: parseEther(eth),
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }

  if (tbtc > 0n) {
    await transferAsset(publicClient, walletClient, funder, assets.TBTC.address, account.address, tbtc)
  }

  if (usdt > 0n) {
    await transferAsset(publicClient, walletClient, funder, assets.USDT.address, account.address, usdt)
  }
}

export async function transferAsset(publicClient, walletClient, account, assetAddress, recipient, amount) {
  return sendCall(publicClient, walletClient, account, {
    name: 'ERC20.transfer',
    to: assetAddress,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient, amount],
    }),
  })
}

export async function assetBalance(publicClient, assetAddress, owner) {
  return publicClient.readContract({
    address: assetAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })
}

export function erc20ApproveCall(assetAddress, spender, amount) {
  return {
    name: 'ERC20.approve',
    to: assetAddress,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
    }),
  }
}

export function erc20SwapClaimCall({ contractAddress, preimage, amount, assetAddress, refundAddress, timelock }) {
  return {
    name: 'ERC20Swap.claim',
    to: contractAddress,
    data: encodeFunctionData({
      abi: erc20SwapAbi,
      functionName: 'claim',
      args: [preimage, amount, assetAddress, refundAddress, BigInt(timelock)],
    }),
  }
}

export function erc20SwapLockCalls({ contractAddress, preimageHash, amount, assetAddress, claimAddress, timelock }) {
  return [
    erc20ApproveCall(assetAddress, contractAddress, amount),
    {
      name: 'ERC20Swap.lock',
      to: contractAddress,
      data: encodeFunctionData({
        abi: erc20SwapAbi,
        functionName: 'lock',
        args: [preimageHash, amount, assetAddress, claimAddress, BigInt(timelock)],
      }),
    },
  ]
}

export function randomTradeId() {
  return `0x${randomBytes(32).toString('hex')}`
}

export function amount(value, asset) {
  return {
    value,
    denomination: asset.denomination,
    decimals: asset.decimals,
  }
}

export function zeroTrade() {
  return [
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
    0n,
    0n,
    0n,
    0n,
  ]
}

export async function readTrade(publicClient, contractAddress, tradeId) {
  return publicClient.readContract({
    address: contractAddress,
    abi: multiEscrowAbi,
    functionName: 'trades',
    args: [tradeId],
  })
}

export function escrowBalance(publicClient, contractAddress, beneficiary, assetAddress) {
  return publicClient.readContract({
    address: contractAddress,
    abi: multiEscrowAbi,
    functionName: 'balances',
    args: [beneficiary, assetAddress],
  })
}

function escrowDomain(config, contractAddress) {
  return {
    name: 'Nostr MultiEscrow',
    version: '6',
    chainId: config.chains.arbitrumRegtest.chainId,
    verifyingContract: contractAddress,
  }
}

export function signRelease(config, account, contractAddress, tradeId, actorAddress) {
  return account.signTypedData({
    domain: escrowDomain(config, contractAddress),
    types: {
      Release: [
        { name: 'tradeId', type: 'bytes32' },
        { name: 'actor', type: 'address' },
      ],
    },
    primaryType: 'Release',
    message: {
      tradeId,
      actor: actorAddress,
    },
  })
}

export function signArbitrate(config, account, contractAddress, tradeId, paymentFactor, bondFactor) {
  return account.signTypedData({
    domain: escrowDomain(config, contractAddress),
    types: {
      Arbitrate: [
        { name: 'tradeId', type: 'bytes32' },
        { name: 'paymentFactor', type: 'uint256' },
        { name: 'bondFactor', type: 'uint256' },
      ],
    },
    primaryType: 'Arbitrate',
    message: {
      tradeId,
      paymentFactor,
      bondFactor,
    },
  })
}

const tradeTermsTypes = {
  TradeTerms: [
    { name: 'tradeId', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'arbiter', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'paymentAmount', type: 'uint256' },
    { name: 'bondAmount', type: 'uint256' },
    { name: 'unlockAt', type: 'uint256' },
    { name: 'timeoutClaimant', type: 'address' },
    { name: 'escrowFee', type: 'uint256' },
    { name: 'contextHash', type: 'bytes32' },
    { name: 'recycleCovenantHash', type: 'bytes32' },
  ],
}

const recycleCovenantTypes = {
  RecycleCovenant: [
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'arbiter', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'paymentAmount', type: 'uint256' },
    { name: 'bondAmount', type: 'uint256' },
    { name: 'timeoutClaimant', type: 'address' },
    { name: 'escrowFee', type: 'uint256' },
    { name: 'contextHash', type: 'bytes32' },
  ],
}

export function tradeTermsHash(terms) {
  return hashStruct({
    types: tradeTermsTypes,
    primaryType: 'TradeTerms',
    data: terms,
  })
}

export function recycleCovenantHash(covenant) {
  return hashStruct({
    types: recycleCovenantTypes,
    primaryType: 'RecycleCovenant',
    data: covenant,
  })
}

export function signRecycle(config, account, contractAddress, sourceTradeId, targetTerms, deadline = 0n) {
  return account.signTypedData({
    domain: escrowDomain(config, contractAddress),
    types: {
      Recycle: [
        { name: 'sourceTradeId', type: 'bytes32' },
        { name: 'targetTermsHash', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Recycle',
    message: {
      sourceTradeId,
      targetTermsHash: tradeTermsHash(targetTerms),
      deadline,
    },
  })
}
