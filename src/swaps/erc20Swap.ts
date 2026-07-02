import { decodeEventLog, encodeFunctionData, parseAbi } from 'viem'

import { erc20Abi } from '../contracts/erc20.js'
import type { EvmAddress, EvmHash, EvmHex, NamedEvmCall } from '../types.js'

export const erc20SwapAbi = parseAbi([
  'event Lockup(bytes32 indexed preimageHash,uint256 amount,address tokenAddress,address indexed claimAddress,address indexed refundAddress,uint256 timelock)',
  'function claim(bytes32 preimage,uint256 amount,address tokenAddress,address refundAddress,uint256 timelock)',
  'function lock(bytes32 preimageHash,uint256 amount,address tokenAddress,address claimAddress,uint256 timelock)',
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

export function findErc20SwapLockup(
  logs: readonly EvmReceiptLog[],
  expected: {
    transactionHash: EvmHash
    preimageHash: EvmHex
    claimAddress: EvmAddress
    tokenAddress?: EvmAddress
  },
): Erc20SwapLockup {
  const preimageHash = expected.preimageHash.toLowerCase()
  const claimAddress = expected.claimAddress.toLowerCase()
  const tokenAddress = expected.tokenAddress?.toLowerCase()

  for (const log of logs) {
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
