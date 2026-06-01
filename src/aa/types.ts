import type { LocalAccount } from 'viem'
import type {
  EvmAddress,
  EvmCall,
  EvmExecutionOptions,
  EvmExecutionResult,
  NamedEvmCall,
  ResolvedEvmChainConfig,
} from '../types.js'

export type AaGasEstimate = {
  gasCostWei: bigint
  gasSponsored: boolean
}

export type AaExecutorOptions = {
  chain: ResolvedEvmChainConfig
  owner: LocalAccount
}

export type AaExecutor = {
  getSmartAccountAddress(): Promise<EvmAddress>
  estimateGas(calls: EvmCall[]): Promise<AaGasEstimate>
  execute(calls: NamedEvmCall[], options: EvmExecutionOptions): Promise<EvmExecutionResult>
}
