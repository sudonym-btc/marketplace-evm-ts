import { decodeEventLog, encodeFunctionData, parseAbi } from 'viem'

import { erc20Abi } from '../contracts/erc20.js'
import type { EvmAddress, EvmHash, EvmHex, NamedEvmCall } from '../types.js'

export const erc20SwapAbi = parseAbi([
  'event Lockup(bytes32 indexed preimageHash,uint256 amount,address tokenAddress,address indexed claimAddress,address indexed refundAddress,uint256 timelock)',
  'function claim(bytes32 preimage,uint256 amount,address tokenAddress,address refundAddress,uint256 timelock)',
  'function lock(bytes32 preimageHash,uint256 amount,address tokenAddress,address claimAddress,uint256 timelock)',
  'function refund(bytes32 preimageHash,uint256 amount,address tokenAddress,address claimAddress,uint256 timelock)',
  'function refundCooperative(bytes32 preimageHash,uint256 amount,address tokenAddress,address claimAddress,uint256 timelock,uint8 v,bytes32 r,bytes32 s)',
])

export type Erc20SwapLockup = {
  contractAddress: EvmAddress
  transactionHash: EvmHash
  preimageHash: EvmHex
  amount: bigint
  tokenAddress: EvmAddress
  claimAddress: EvmAddress
  refundAddress: EvmAddress
  timelock: bigint
}

export type EvmReceiptLog = {
  address: EvmAddress
  data: EvmHex
  topics: readonly EvmHex[]
  transactionHash?: EvmHash
}

export function erc20SwapClaimCall(options: {
  contractAddress: EvmAddress
  preimage: EvmHex
  amount: bigint
  tokenAddress: EvmAddress
  refundAddress: EvmAddress
  timelock: bigint
}): NamedEvmCall {
  return {
    name: 'ERC20Swap.claim',
    to: options.contractAddress,
    data: encodeFunctionData({
      abi: erc20SwapAbi,
      functionName: 'claim',
      args: [
        options.preimage,
        options.amount,
        options.tokenAddress,
        options.refundAddress,
        options.timelock,
      ],
    }),
  }
}

export function erc20SwapLockCalls(options: {
  contractAddress: EvmAddress
  preimageHash: EvmHex
  amount: bigint
  tokenAddress: EvmAddress
  claimAddress: EvmAddress
  timelock: bigint | number
}): NamedEvmCall[] {
  return [
    {
      name: 'ERC20.approve',
      to: options.tokenAddress,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [options.contractAddress, options.amount],
      }),
    },
    {
      name: 'ERC20Swap.lock',
      to: options.contractAddress,
      data: encodeFunctionData({
        abi: erc20SwapAbi,
        functionName: 'lock',
        args: [
          options.preimageHash,
          options.amount,
          options.tokenAddress,
          options.claimAddress,
          BigInt(options.timelock),
        ],
      }),
    },
  ]
}

export function erc20SwapRefundCall(options: {
  contractAddress: EvmAddress
  preimageHash: EvmHex
  amount: bigint
  tokenAddress: EvmAddress
  claimAddress: EvmAddress
  timelock: bigint | number
}): NamedEvmCall {
  return {
    name: 'ERC20Swap.refund',
    to: options.contractAddress,
    data: encodeFunctionData({
      abi: erc20SwapAbi,
      functionName: 'refund',
      args: [
        options.preimageHash,
        options.amount,
        options.tokenAddress,
        options.claimAddress,
        BigInt(options.timelock),
      ],
    }),
  }
}

export function erc20SwapCooperativeRefundCall(options: {
  contractAddress: EvmAddress
  preimageHash: EvmHex
  amount: bigint
  tokenAddress: EvmAddress
  claimAddress: EvmAddress
  timelock: bigint | number
  signature: EvmHex
}): NamedEvmCall {
  const raw = options.signature.slice(2)
  if (!/^[0-9a-fA-F]{130}$/.test(raw)) throw new Error('Invalid cooperative refund signature')
  const r = `0x${raw.slice(0, 64)}` as EvmHex
  const s = `0x${raw.slice(64, 128)}` as EvmHex
  const recovery = Number.parseInt(raw.slice(128), 16)
  const v = recovery < 27 ? recovery + 27 : recovery
  if (v !== 27 && v !== 28) throw new Error('Invalid cooperative refund recovery id')
  return {
    name: 'ERC20Swap.refundCooperative',
    to: options.contractAddress,
    data: encodeFunctionData({
      abi: erc20SwapAbi,
      functionName: 'refundCooperative',
      args: [
        options.preimageHash,
        options.amount,
        options.tokenAddress,
        options.claimAddress,
        BigInt(options.timelock),
        v,
        r,
        s,
      ],
    }),
  }
}

export function findErc20SwapLockup(
  logs: readonly EvmReceiptLog[],
  expected: {
    transactionHash: EvmHash
    contractAddress: EvmAddress
    preimageHash: EvmHex
    claimAddress: EvmAddress
    tokenAddress?: EvmAddress
    amount?: bigint
    refundAddress?: EvmAddress
  },
): Erc20SwapLockup {
  const contractAddress = expected.contractAddress.toLowerCase()
  const preimageHash = expected.preimageHash.toLowerCase()
  const claimAddress = expected.claimAddress.toLowerCase()
  const tokenAddress = expected.tokenAddress?.toLowerCase()

  for (const log of logs) {
    if (log.address.toLowerCase() !== contractAddress) continue
    try {
      const decoded = decodeEventLog({
        abi: erc20SwapAbi,
        data: log.data,
        topics: [...log.topics] as [EvmHex, ...EvmHex[]],
      })
      if (decoded.eventName !== 'Lockup') continue
      const args = decoded.args
      if (args.preimageHash.toLowerCase() !== preimageHash) continue
      if (args.claimAddress.toLowerCase() !== claimAddress) continue
      if (tokenAddress && args.tokenAddress.toLowerCase() !== tokenAddress) continue
      if (expected.amount !== undefined && args.amount !== expected.amount) continue
      if (expected.refundAddress && args.refundAddress.toLowerCase() !== expected.refundAddress.toLowerCase()) continue
      return {
        contractAddress: log.address,
        transactionHash: log.transactionHash ?? expected.transactionHash,
        preimageHash: args.preimageHash,
        amount: args.amount,
        tokenAddress: args.tokenAddress,
        claimAddress: args.claimAddress,
        refundAddress: args.refundAddress,
        timelock: args.timelock,
      }
    } catch (_) {
      // Receipts contain logs from the entry point, paymaster, token, and escrow contracts too.
    }
  }

  throw new Error(`ERC20Swap lockup log not found for ${expected.preimageHash}`)
}
