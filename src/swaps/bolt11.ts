import type { EvmHex } from '../types.js'

const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let check = 1
  for (const value of values) {
    const top = check >>> 25
    check = ((check & 0x1ffffff) << 5) ^ value
    for (let index = 0; index < generators.length; index += 1) {
      if ((top >>> index) & 1) check ^= generators[index]!
    }
  }
  return check >>> 0
}

function expandHrp(hrp: string): number[] {
  return [
    ...[...hrp].map(character => character.charCodeAt(0) >>> 5),
    0,
    ...[...hrp].map(character => character.charCodeAt(0) & 31),
  ]
}

function wordsToBytes(words: number[]): Uint8Array {
  let accumulator = 0
  let bits = 0
  const bytes: number[] = []
  for (const current of words) {
    accumulator = (accumulator << 5) | current
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 0xff)
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) {
    throw new Error('Invalid BOLT11 payment hash padding')
  }
  return Uint8Array.from(bytes)
}

/** Decode and checksum-verify the mandatory BOLT11 `p` (payment hash) tag. */
export function decodeBolt11PaymentHash(invoice: string): EvmHex {
  if (!invoice || invoice !== invoice.toLowerCase()) throw new Error('BOLT11 invoice must use canonical lowercase encoding')
  const separator = invoice.lastIndexOf('1')
  if (separator < 1 || separator + 7 > invoice.length) throw new Error('Invalid BOLT11 invoice encoding')
  const hrp = invoice.slice(0, separator)
  if (!hrp.startsWith('ln')) throw new Error('Invalid BOLT11 human-readable prefix')
  const words = [...invoice.slice(separator + 1)].map(character => {
    const index = charset.indexOf(character)
    if (index < 0) throw new Error(`Invalid BOLT11 character: ${character}`)
    return index
  })
  if (polymod([...expandHrp(hrp), ...words]) !== 1) throw new Error('Invalid BOLT11 checksum')
  const data = words.slice(0, -6)
  let offset = 7 // 35-bit timestamp
  while (offset + 3 <= data.length) {
    const tag = charset[data[offset]!]!
    const length = (data[offset + 1]! << 5) | data[offset + 2]!
    offset += 3
    if (offset + length > data.length) throw new Error('Truncated BOLT11 tagged field')
    const field = data.slice(offset, offset + length)
    offset += length
    if (tag !== 'p') continue
    const bytes = wordsToBytes(field)
    if (bytes.length !== 32) throw new Error('Invalid BOLT11 payment hash length')
    return `0x${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}` as EvmHex
  }
  throw new Error('BOLT11 invoice is missing its payment hash')
}
