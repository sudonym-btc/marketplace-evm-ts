import type { EvmAmount } from '../types.js'

const SATS_PER_BTC = 100_000_000n
const BTC_DENOMINATIONS = new Set(['BTC', 'TBTC', 'RBTC', 'L-BTC'])

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor
}

function checkedNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds Number.MAX_SAFE_INTEGER`)
  return Number(value)
}

export function btcAmountToSats(amount: EvmAmount): number {
  const denomination = amount.denomination.trim().toUpperCase()
  if (!BTC_DENOMINATIONS.has(denomination)) {
    throw new Error(`Cannot convert ${amount.denomination} amount to Boltz satoshis`)
  }
  if (!Number.isInteger(amount.decimals) || amount.decimals < 0) {
    throw new Error(`Invalid BTC amount decimals: ${amount.decimals}`)
  }

  const scale = 10n ** BigInt(amount.decimals)
  const sats = ceilDiv(amount.value * SATS_PER_BTC, scale)
  return checkedNumber(sats, 'Boltz onchain amount')
}

