import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function canFetch(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) })
    return response.ok
  } catch {
    return false
  }
}

async function detectPorts(host) {
  const envArbitrum = process.env.MARKETPLACE_EVM_ARBITRUM_RPC_PORT
  const envRootstock = process.env.MARKETPLACE_EVM_ROOTSTOCK_RPC_PORT
  const envBoltz = process.env.MARKETPLACE_EVM_BOLTZ_API_PORT
  if (envArbitrum || envRootstock || envBoltz) {
    return {
      arbitrumPort: envArbitrum ?? '18546',
      rootstockPort: envRootstock ?? '18545',
      boltzApiPort: envBoltz ?? '19001',
    }
  }

  const standalone = { arbitrumPort: '18546', rootstockPort: '18545', boltzApiPort: '19001' }
  if (await canFetch(`http://${host}:${standalone.boltzApiPort}/v2/nodes`)) return standalone

  const hostr = { arbitrumPort: '8546', rootstockPort: '8545', boltzApiPort: '9001' }
  if (await canFetch(`http://${host}:${hostr.boltzApiPort}/v2/nodes`)) return hostr

  return standalone
}

export async function readStackConfig() {
  if (process.env.MARKETPLACE_EVM_STACK_CONFIG) {
    return JSON.parse(readFileSync(process.env.MARKETPLACE_EVM_STACK_CONFIG, 'utf8'))
  }

  const candidates = [
    resolve(__dirname, '../../stack/data/config/marketplace-evm-stack.json'),
    resolve(__dirname, '../../../../marketplace-evm-stack/data/config/marketplace-evm-stack.json'),
    resolve(process.cwd(), '../marketplace-evm-stack/data/config/marketplace-evm-stack.json'),
  ]
  const configPath = candidates.find(candidate => existsSync(candidate))

  if (configPath) {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  }

  return createDefaultStackConfig(await detectPorts(process.env.MARKETPLACE_EVM_STACK_HOST ?? '127.0.0.1'))
}

function createDefaultStackConfig({ arbitrumPort, rootstockPort, boltzApiPort }) {
  const host = process.env.MARKETPLACE_EVM_STACK_HOST ?? '127.0.0.1'

  return {
    version: 1,
    chains: {
      arbitrumRegtest: {
        name: 'Arbitrum Regtest',
        chainId: 412346,
        rpcUrl: `http://${host}:${arbitrumPort}`,
        nativeAsset: {
          denomination: 'ETH',
          decimals: 18,
        },
        boltzCurrency: 'ARB',
        accountAbstraction: defaultArbitrumAaConfig(host),
        multiEscrow: {
          address: '0x663f3ad617193148711d28f5334ee4ed07016602',
          runtimeBytecodeHash: undefined,
        },
        assets: {
          TBTC: {
            address: '0x948B3c65b89DF0B4894ABE91E6D02FE579834F8F',
            denomination: 'BTC',
            decimals: 18,
            boltzCurrency: 'tBTC',
          },
          USDT: {
            address: '0x712516e61C8B383dF4A63CFe83d7701Bce54B03e',
            denomination: 'USD',
            decimals: 6,
            boltzCurrency: 'USDT',
          },
        },
      },
      rootstockRegtest: {
        name: 'Rootstock Regtest',
        chainId: 33,
        rpcUrl: `http://${host}:${rootstockPort}`,
        nativeAsset: {
          denomination: 'RBTC',
          decimals: 18,
        },
        boltzCurrency: 'RBTC',
      },
    },
    boltz: {
      apiUrl: `http://${host}:${boltzApiPort}/v2`,
    },
    accounts: {
      funder: {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      },
    },
  }
}

export function arbitrumChain(config) {
  const arbitrum = config.chains.arbitrumRegtest
  return {
    id: arbitrum.chainId,
    name: arbitrum.name,
    nativeCurrency: {
      name: arbitrum.nativeAsset.denomination,
      symbol: arbitrum.nativeAsset.denomination,
      decimals: arbitrum.nativeAsset.decimals,
    },
    rpcUrls: {
      default: { http: [arbitrum.rpcUrl] },
    },
  }
}

export function arbitrumAaConfig(config) {
  const host = process.env.MARKETPLACE_EVM_STACK_HOST ?? '127.0.0.1'
  const configured = config.chains.arbitrumRegtest.accountAbstraction ?? {}
  const defaults = defaultArbitrumAaConfig(host)
  return {
    entryPointAddress:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_ENTRY_POINT_ADDRESS ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_ENTRY_POINT_ADDRESS ??
      configured.entryPointAddress ??
      defaults.entryPointAddress,
    entryPointVersion: configured.entryPointVersion ?? defaults.entryPointVersion,
    factoryAddress:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_ACCOUNT_FACTORY_ADDRESS ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_ACCOUNT_FACTORY_ADDRESS ??
      configured.factoryAddress ??
      defaults.factoryAddress,
    bundlerUrl:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_BUNDLER_URL ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_BUNDLER_URL ??
      configured.bundlerUrl ??
      defaults.bundlerUrl,
    paymasterUrl:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_PAYMASTER_URL ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_PAYMASTER_URL ??
      configured.paymasterUrl ??
      defaults.paymasterUrl,
    paymasterAddress:
      process.env.MARKETPLACE_EVM_ARBITRUM_AA_PAYMASTER_ADDRESS ??
      process.env.EVM_CHAIN_ARBITRUM_REGTEST_AA_PAYMASTER_ADDRESS ??
      configured.paymasterAddress ??
      defaults.paymasterAddress,
    userOperationReceiptTimeoutMs:
      configured.userOperationReceiptTimeoutMs ?? defaults.userOperationReceiptTimeoutMs,
  }
}

function defaultArbitrumAaConfig(host) {
  return {
    entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    entryPointVersion: '0.7',
    factoryAddress: '0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985',
    bundlerUrl: `http://${host}:4337`,
    paymasterUrl: `http://${host}:3010`,
    paymasterAddress: '0x38aef040CEB057B62E1598F5C265946A4E4BaB4C',
    userOperationReceiptTimeoutMs: 120_000,
  }
}
