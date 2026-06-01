import { createSmartAccountClient } from 'permissionless'
import { toSimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { http, type Address, type Chain } from 'viem'
import type { EntryPointVersion } from 'viem/account-abstraction'

import type { EvmCall, NamedEvmCall } from '../types.js'
import type { AaExecutor, AaExecutorOptions } from './types.js'

const ENTRYPOINT_06 = '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789'
const ENTRYPOINT_07 = '0x0000000071727de22e5e9d8baf0edacf37da032'
const ENTRYPOINT_08 = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108'

export function inferEntryPointVersion(address: Address): EntryPointVersion {
  switch (address.toLowerCase()) {
    case ENTRYPOINT_06:
      return '0.6'
    case ENTRYPOINT_08:
      return '0.8'
    case ENTRYPOINT_07:
    default:
      return '0.7'
  }
}

export function createPimlicoAaExecutor(options: AaExecutorOptions): AaExecutor {
  const aa = options.chain.accountAbstraction
  if (!aa) {
    throw new Error(`Chain ${options.chain.id} does not define account abstraction config`)
  }

  const chain = resolveChain(options.chain)
  const entryPoint = {
    address: aa.entryPointAddress,
    version: aa.entryPointVersion ?? inferEntryPointVersion(aa.entryPointAddress),
  } as const

  const paymasterUrl = aa.paymasterUrl ?? aa.bundlerUrl
  const paymasterClient = paymasterUrl
    ? createPimlicoClient({
        chain,
        transport: http(paymasterUrl),
        entryPoint,
      })
    : undefined
  const paymasterContext = mergePaymasterContext(aa.paymasterContext, aa.sponsorshipPolicyId)

  const accountPromise = toSimpleSmartAccount({
    client: options.chain.publicClient,
    owner: options.owner,
    entryPoint,
    factoryAddress: aa.factoryAddress,
  })

  const clientPromise = accountPromise.then(account => createSmartAccountClient({
    account,
    chain,
    client: options.chain.publicClient,
    bundlerTransport: http(aa.bundlerUrl),
    ...(paymasterClient ? { paymaster: paymasterClient } : {}),
    ...(paymasterContext ? { paymasterContext } : {}),
    userOperation: {
      estimateFeesPerGas: async () => {
        try {
          const gasPrice = await paymasterClient?.getUserOperationGasPrice()
          if (gasPrice?.fast) return gasPrice.fast
        } catch {
          // Some local bundlers do not expose Pimlico gas-price helpers.
        }
        return options.chain.publicClient.estimateFeesPerGas({
          chain: options.chain.publicClient.chain,
          type: 'eip1559',
        } as never)
      },
    },
  }))

  return {
    async getSmartAccountAddress() {
      const account = await accountPromise
      return account.address
    },
    async estimateGas(calls: EvmCall[]) {
      const client = await clientPromise
      const request = await (client as never as PreparedUserOperationClient).prepareUserOperation({
        calls: calls.map(toUserOperationCall),
        ...paymasterOperationArgs(aa, paymasterClient, paymasterContext),
      })
      const gasUnits =
        (request.callGasLimit ?? 0n) +
        (request.preVerificationGas ?? 0n) +
        (request.verificationGasLimit ?? 0n) +
        (request.paymasterVerificationGasLimit ?? 0n) +
        (request.paymasterPostOpGasLimit ?? 0n)
      return {
        gasCostWei: gasUnits * (request.maxFeePerGas ?? 0n),
        gasSponsored: isGasSponsored(aa, paymasterClient),
      }
    },
    async execute(calls: NamedEvmCall[]) {
      const client = await clientPromise
      const account = await accountPromise
      const userOperationHash = await (client as never as PreparedUserOperationClient).sendUserOperation({
        calls: calls.map(toUserOperationCall),
        ...paymasterOperationArgs(aa, paymasterClient, paymasterContext),
      })
      const receipt = await (client as never as PreparedUserOperationClient).waitForUserOperationReceipt({
        hash: userOperationHash,
        ...(aa.userOperationReceiptTimeoutMs ? { timeout: aa.userOperationReceiptTimeoutMs } : {}),
        ...(aa.userOperationReceiptPollingIntervalMs ? { pollingInterval: aa.userOperationReceiptPollingIntervalMs } : {}),
      })

      if (receipt.success === false) {
        throw new Error(`AA user operation reverted: ${userOperationHash}`)
      }

      return {
        txHash: receipt.receipt.transactionHash,
        accountAddress: account.address,
        gasSponsored: isGasSponsored(aa, paymasterClient),
        userOperationHash,
      }
    },
  }
}

type PreparedUserOperation = {
  callGasLimit?: bigint
  preVerificationGas?: bigint
  verificationGasLimit?: bigint
  paymasterVerificationGasLimit?: bigint
  paymasterPostOpGasLimit?: bigint
  maxFeePerGas?: bigint
}

type PreparedUserOperationClient = {
  prepareUserOperation(args: unknown): Promise<PreparedUserOperation>
  sendUserOperation(args: unknown): Promise<`0x${string}`>
  waitForUserOperationReceipt(args: unknown): Promise<{
    success?: boolean
    receipt: {
      transactionHash: `0x${string}`
    }
  }>
}

function resolveChain(chainConfig: AaExecutorOptions['chain']): Chain {
  const chain = chainConfig.publicClient.chain
  if (chain) return chain
  const rpcUrl = chainConfig.rpcUrl
  if (!rpcUrl) {
    throw new Error(`Chain ${chainConfig.id} needs publicClient.chain or rpcUrl for account abstraction`)
  }
  return {
    id: chainConfig.chainId,
    name: chainConfig.name ?? chainConfig.id,
    nativeCurrency: {
      name: chainConfig.nativeAsset.denomination,
      symbol: chainConfig.nativeAsset.denomination,
      decimals: chainConfig.nativeAsset.decimals,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  }
}

function toUserOperationCall(call: EvmCall) {
  return {
    to: call.to,
    data: call.data,
    value: call.value ?? 0n,
  }
}

function mergePaymasterContext(context: unknown, sponsorshipPolicyId: string | undefined): unknown {
  if (!sponsorshipPolicyId) return context
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    return { ...context, sponsorshipPolicyId }
  }
  return { sponsorshipPolicyId }
}

function paymasterOperationArgs(
  aa: NonNullable<AaExecutorOptions['chain']['accountAbstraction']>,
  paymasterClient: ReturnType<typeof createPimlicoClient> | undefined,
  paymasterContext: unknown,
) {
  return {
    ...(paymasterClient ? { paymaster: paymasterClient } : aa.paymasterAddress ? { paymaster: aa.paymasterAddress } : {}),
    ...(paymasterContext ? { paymasterContext } : {}),
  }
}

function isGasSponsored(
  aa: NonNullable<AaExecutorOptions['chain']['accountAbstraction']>,
  paymasterClient: ReturnType<typeof createPimlicoClient> | undefined,
) {
  return Boolean(paymasterClient || aa.paymasterAddress)
}
