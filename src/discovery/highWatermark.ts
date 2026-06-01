import type { Abi } from 'viem'

import { createEvmAccountManager } from '../accounts.js'
import type { ResolvedEvmChainConfig } from '../types.js'
import { resolveEvmSeedConfig, type EvmSeedConfig } from '../seed.js'
import type {
  EvmChainIndexActivity,
  EvmDiscoverHighWatermarkOptions,
  EvmHighWatermarkDiscovery,
  EvmIndexActivityReason,
  EvmProtocolActivityProbe,
  EvmSmartAccountAddressResolver,
  EvmTradeIndexActivity,
} from './types.js'

const entryPointAbi = [
  {
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
] as const satisfies Abi

export type EvmHighWatermarkDiscoveryOptions = {
  chains: ResolvedEvmChainConfig[]
  seed: string | EvmSeedConfig
  protocolActivityProbe?: EvmProtocolActivityProbe
  smartAccountAddressResolver?: EvmSmartAccountAddressResolver
}

export type EvmHighWatermarkDiscoveryService = {
  discoverHighWatermark(options?: EvmDiscoverHighWatermarkOptions): Promise<EvmHighWatermarkDiscovery>
}

function safeWatermark(value: number | undefined): number {
  if (value === undefined) return -1
  if (!Number.isSafeInteger(value) || value < -1) throw new Error(`Invalid highWaterMark: ${value}`)
  return value
}

function safeWindow(value: number | undefined): number {
  const window = value ?? 50
  if (!Number.isSafeInteger(window) || window < 1) throw new Error(`Invalid unusedWindow: ${value}`)
  return window
}

function safeFromTradeIndex(value: number | undefined): number {
  const fromTradeIndex = value ?? 0
  if (!Number.isSafeInteger(fromTradeIndex) || fromTradeIndex < 0) {
    throw new Error(`Invalid fromTradeIndex: ${value}`)
  }
  return fromTradeIndex
}

function chainFilter(
  chains: ResolvedEvmChainConfig[],
  chainIds: number[] | undefined,
): ResolvedEvmChainConfig[] {
  if (!chainIds) return chains
  const requested = new Set(chainIds)
  return chains.filter(chain => requested.has(chain.chainId))
}

async function entryPointNonce(chain: ResolvedEvmChainConfig, sender: `0x${string}`): Promise<bigint> {
  return chain.publicClient.readContract({
    address: chain.accountAbstraction.entryPointAddress,
    abi: entryPointAbi,
    functionName: 'getNonce',
    args: [sender, 0n],
  }) as Promise<bigint>
}

async function chainActivity(
  chain: ResolvedEvmChainConfig,
  seed: EvmSeedConfig,
  tradeIndex: number,
  probe: EvmProtocolActivityProbe | undefined,
  smartAccountAddressResolver: EvmSmartAccountAddressResolver | undefined,
): Promise<EvmChainIndexActivity> {
  const accountManager = createEvmAccountManager({ chains: [chain], seed })
  const owner = accountManager.ownerAccount(tradeIndex, chain.chainId)
  const smartAccountAddress = smartAccountAddressResolver
    ? await smartAccountAddressResolver({ chain, tradeIndex, ownerAddress: owner.address, seed })
    : await accountManager.smartAccountAddress(tradeIndex, chain.chainId)
  const [bytecode, nonce] = await Promise.all([
    chain.publicClient.getBytecode({ address: smartAccountAddress }),
    entryPointNonce(chain, smartAccountAddress),
  ])
  const protocolActivity = await probe?.({
    chain,
    tradeIndex,
    ownerAddress: owner.address,
    smartAccountAddress,
    seed,
  })

  const smartAccountDeployed = Boolean(bytecode && bytecode !== '0x')
  const reasons: EvmIndexActivityReason[] = []
  if (smartAccountDeployed) reasons.push('smart_account_deployed')
  if (nonce > 0n) reasons.push('entrypoint_nonce')
  if (protocolActivity?.used) reasons.push('protocol_activity')

  return {
    chainId: chain.chainId,
    ownerAddress: owner.address,
    smartAccountAddress,
    smartAccountDeployed,
    entryPointNonce: nonce,
    used: reasons.length > 0,
    reasons,
    ...(protocolActivity ? { protocolActivity } : {}),
  }
}

export function createEvmHighWatermarkDiscovery(
  options: EvmHighWatermarkDiscoveryOptions,
): EvmHighWatermarkDiscoveryService {
  const defaultSeed = resolveEvmSeedConfig(options.seed)

  return {
    async discoverHighWatermark(discoveryOptions: EvmDiscoverHighWatermarkOptions = {}) {
      const seed = discoveryOptions.seed ? resolveEvmSeedConfig(discoveryOptions.seed) : defaultSeed
      const highWaterMark = safeWatermark(discoveryOptions.highWaterMark)
      const unusedWindow = safeWindow(discoveryOptions.unusedWindow)
      const scannedFrom = safeFromTradeIndex(discoveryOptions.fromTradeIndex)
      const scannedThrough = Math.max(scannedFrom - 1, highWaterMark + unusedWindow)
      const chains = chainFilter(options.chains, discoveryOptions.chainIds)
      const protocolActivityProbe = discoveryOptions.protocolActivityProbe ?? options.protocolActivityProbe
      const smartAccountAddressResolver =
        discoveryOptions.smartAccountAddressResolver ?? options.smartAccountAddressResolver

      const trades: EvmTradeIndexActivity[] = []
      const recoveryActions: unknown[] = []
      let maxUsedIndex = -1

      for (let tradeIndex = scannedFrom; tradeIndex <= scannedThrough; tradeIndex += 1) {
        const chainActivities = await Promise.all(
          chains.map(chain =>
            chainActivity(chain, seed, tradeIndex, protocolActivityProbe, smartAccountAddressResolver),
          ),
        )
        const used = chainActivities.some(activity => activity.used)
        for (const activity of chainActivities) {
          if (activity.protocolActivity?.recoveryActions) {
            recoveryActions.push(...activity.protocolActivity.recoveryActions)
          }
        }
        if (used) maxUsedIndex = Math.max(maxUsedIndex, tradeIndex)
        trades.push({ tradeIndex, used, chains: chainActivities })
      }

      return {
        driver: 'evm',
        maxUsedIndex,
        nextUnusedIndex: maxUsedIndex + 1,
        highWaterMark,
        scannedFrom,
        scannedThrough,
        unusedWindow,
        usedTradeIndexes: trades.filter(trade => trade.used).map(trade => trade.tradeIndex),
        trades,
        recoveryActions,
      }
    },
  }
}
