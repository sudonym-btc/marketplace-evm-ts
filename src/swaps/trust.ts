import { decodeAbiParameters, decodeFunctionData, parseAbi } from 'viem'

import { erc20Abi } from '../contracts/erc20.js'
import type {
  EvmAddress,
  EvmBoltzChainTrust,
  EvmHex,
  NamedEvmCall,
  ResolvedEvmChainConfig,
} from '../types.js'
import { sha256Hex } from '../utils/sha256.js'

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function selector(data: EvmHex): EvmHex {
  if (!/^0x[0-9a-fA-F]{8}/.test(data)) throw new Error('Provider call is missing a function selector')
  return data.slice(0, 10).toLowerCase() as EvmHex
}

const exactInputAbi = parseAbi([
  'function swap(address tokenIn,address tokenOut,address recipient,uint256 amountIn,uint256 amountOutMin)',
])
const permit2Abi = parseAbi([
  'function approve(address token,address spender,uint160 amount,uint48 expiration)',
])
const universalRouterAbi = parseAbi([
  'function execute(bytes commands,bytes[] inputs)',
])

type SemanticCall =
  | { kind: 'swap'; target: EvmAddress; tokenIn: EvmAddress; tokenOut: EvmAddress; recipient: EvmAddress; amountIn: bigint; amountOutMin: bigint; index: number }
  | { kind: 'permit2'; target: EvmAddress; token: EvmAddress; spender: EvmAddress; amount: bigint; index: number }

function v3PathTokens(path: EvmHex): { tokenIn: EvmAddress; tokenOut: EvmAddress } {
  const raw = path.slice(2)
  // A single V3 hop is token(20) + fee(3) + token(20). Multi-hop paths are
  // rejected because intermediate assets are not part of the signed quote.
  if (!/^[0-9a-fA-F]{86}$/.test(raw)) throw new Error('Universal Router V3 path must contain exactly one hop')
  return {
    tokenIn: `0x${raw.slice(0, 40)}` as EvmAddress,
    tokenOut: `0x${raw.slice(46, 86)}` as EvmAddress,
  }
}

function decodeSemanticCall(
  decoder: import('../types.js').EvmTrustedCallDecoder,
  call: NamedEvmCall,
  index: number,
): SemanticCall {
  if (decoder === 'exact-input-v1') {
    const decoded = decodeFunctionData({ abi: exactInputAbi, data: call.data })
    if (decoded.functionName !== 'swap') throw new Error('Invalid exact-input call')
    const [tokenIn, tokenOut, recipient, amountIn, amountOutMin] = decoded.args
    return { kind: 'swap', target: call.to, tokenIn, tokenOut, recipient, amountIn, amountOutMin, index }
  }
  if (decoder === 'permit2-approve-v1') {
    const decoded = decodeFunctionData({ abi: permit2Abi, data: call.data })
    if (decoded.functionName !== 'approve') throw new Error('Invalid Permit2 approval call')
    const [token, spender, amount] = decoded.args
    return { kind: 'permit2', target: call.to, token, spender, amount, index }
  }
  if (decoder === 'uniswap-universal-router-v3-exact-in-v1') {
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data: call.data })
    if (decoded.functionName !== 'execute') throw new Error('Invalid Universal Router call')
    const [commands, inputs] = decoded.args
    if (commands.toLowerCase() !== '0x00' || inputs.length !== 1) {
      throw new Error('Universal Router bundle must contain only one V3_SWAP_EXACT_IN command')
    }
    const [recipient, amountIn, amountOutMin, path, payerIsUser] = decodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes' },
        { type: 'bool' },
      ],
      inputs[0]!,
    )
    if (!payerIsUser) throw new Error('Universal Router swap must debit the calling account')
    return { kind: 'swap', target: call.to, ...v3PathTokens(path), recipient, amountIn, amountOutMin, index }
  }
  const exhaustive: never = decoder
  throw new Error(`No semantic decoder implemented for ${String(exhaustive)}`)
}

async function assertRuntime(
  chain: ResolvedEvmChainConfig,
  address: EvmAddress,
  expectedHash: EvmHex,
  label: string,
): Promise<void> {
  const bytecode = await chain.publicClient.getBytecode({ address })
  if (!bytecode || bytecode === '0x') throw new Error(`${label} has no runtime bytecode`)
  const actualHash = await sha256Hex(bytecode)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`${label} runtime bytecode hash mismatch`)
  }
}

export async function assertTrustedErc20Swap(options: {
  chain: ResolvedEvmChainConfig
  trust: EvmBoltzChainTrust | undefined
  contractAddress: EvmAddress | undefined
}): Promise<{ address: EvmAddress; runtimeBytecodeHash: EvmHex }> {
  if (!options.trust) throw new Error(`No Boltz trust roots configured for chainId ${options.chain.chainId}`)
  if (!options.contractAddress) throw new Error('Boltz response did not identify its ERC20Swap contract')
  const trusted = options.trust.erc20Swap
  if (!sameAddress(options.contractAddress, trusted.address)) {
    throw new Error('Boltz swap contract does not match the configured ERC20Swap deployment')
  }
  await assertRuntime(options.chain, trusted.address, trusted.runtimeBytecodeHash, 'Configured ERC20Swap contract')
  return trusted
}

/**
 * Verify every configured routed-DEX target before asking the provider for a
 * quote or encoded call bundle. The selected targets are checked again when
 * the returned bundle is validated, closing the provider-call TOCTOU window.
 */
export async function assertTrustedDexTargets(options: {
  chain: ResolvedEvmChainConfig
  trust: EvmBoltzChainTrust | undefined
}): Promise<void> {
  const rules = options.trust?.dexCallTargets
  if (!rules || rules.length === 0) {
    throw new Error(`No trusted DEX call targets configured for chainId ${options.chain.chainId}`)
  }
  for (const rule of rules) {
    await assertRuntime(
      options.chain,
      rule.address,
      rule.runtimeBytecodeHash,
      `Configured DEX target ${rule.address}`,
    )
  }
}

/**
 * Validate every provider-produced call against local trust roots and bind the
 * bundle to the quoted token pair, amounts, and recipient. Unknown selectors,
 * native value, over-approvals, and omitted quote fields are rejected.
 */
export async function validateProviderDexCalls(options: {
  chain: ResolvedEvmChainConfig
  trust: EvmBoltzChainTrust | undefined
  calls: NamedEvmCall[]
  tokenIn: EvmAddress
  tokenOut: EvmAddress
  recipient: EvmAddress
  amountIn: bigint
  amountOutMin: bigint
}): Promise<NamedEvmCall[]> {
  const rules = options.trust?.dexCallTargets
  if (!rules || rules.length === 0) {
    throw new Error(`No trusted DEX call targets configured for chainId ${options.chain.chainId}`)
  }
  if (options.calls.length === 0) throw new Error('Boltz returned an empty DEX call bundle')

  const approvals: Array<{ spender: EvmAddress; amount: bigint; index: number }> = []
  const semanticCalls: SemanticCall[] = []

  for (const [index, call] of options.calls.entries()) {
    const value = call.value ?? 0n
    const callSelector = selector(call.data)
    if (sameAddress(call.to, options.tokenIn) && callSelector === '0x095ea7b3') {
      if (value !== 0n) throw new Error('ERC-20 approval call must not send native value')
      const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data })
      if (decoded.functionName !== 'approve') throw new Error('Invalid ERC-20 approval call')
      const [spender, approvalAmount] = decoded.args
      if (approvalAmount !== options.amountIn) {
        throw new Error('ERC-20 approval amount does not exactly match the quoted input amount')
      }
      approvals.push({ spender, amount: approvalAmount, index })
      continue
    }

    const rule = rules.find(candidate => sameAddress(candidate.address, call.to))
    if (!rule) throw new Error(`Provider call target ${call.to} is not allowlisted`)
    const trustedFunction = rule.functions.find(candidate => candidate.selector.toLowerCase() === callSelector)
    if (!trustedFunction) {
      throw new Error(`Provider call selector ${callSelector} is not allowlisted for ${call.to}`)
    }
    if (value > (rule.maxValue ?? 0n)) throw new Error(`Provider call exceeds native value limit for ${call.to}`)
    await assertRuntime(options.chain, rule.address, rule.runtimeBytecodeHash, `Configured DEX target ${rule.address}`)
    semanticCalls.push(decodeSemanticCall(trustedFunction.decoder, call, index))
  }

  if (approvals.length !== 1) throw new Error('Provider DEX bundle must contain one exact ERC-20 input approval')
  const swaps = semanticCalls.filter((item): item is Extract<SemanticCall, { kind: 'swap' }> => item.kind === 'swap')
  const permits = semanticCalls.filter((item): item is Extract<SemanticCall, { kind: 'permit2' }> => item.kind === 'permit2')
  if (swaps.length !== 1) throw new Error('Provider DEX bundle must contain one semantically decoded swap')
  if (permits.length > 1) throw new Error('Provider DEX bundle contains multiple Permit2 approvals')
  const swap = swaps[0]!
  if (!sameAddress(swap.tokenIn, options.tokenIn)) throw new Error('Provider swap input token does not match quote')
  if (!sameAddress(swap.tokenOut, options.tokenOut)) throw new Error('Provider swap output token does not match quote')
  if (!sameAddress(swap.recipient, options.recipient)) throw new Error('Provider swap recipient does not match quote')
  if (swap.amountIn !== options.amountIn) throw new Error('Provider swap input amount does not match quote')
  if (swap.amountOutMin !== options.amountOutMin) throw new Error('Provider swap minimum output does not match quote')
  const approval = approvals[0]!
  if (permits.length === 0) {
    if (!sameAddress(approval.spender, swap.target) || approval.index > swap.index) {
      throw new Error('ERC-20 approval is not exactly scoped to the decoded swap target')
    }
  } else {
    const permit = permits[0]!
    if (
      !sameAddress(approval.spender, permit.target)
      || !sameAddress(permit.token, options.tokenIn)
      || !sameAddress(permit.spender, swap.target)
      || permit.amount !== options.amountIn
      || !(approval.index < permit.index && permit.index < swap.index)
    ) {
      throw new Error('Permit2 approval flow does not exactly match the decoded swap')
    }
  }
  return options.calls
}
