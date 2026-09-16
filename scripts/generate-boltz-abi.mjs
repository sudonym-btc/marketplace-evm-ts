import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const outputPath = fileURLToPath(new URL('../src/contracts/erc20Swap.generated.ts', import.meta.url))

export function readBoltzArtifact(name) {
  return JSON.parse(readFileSync(require.resolve(`boltz-core/out/${name}.sol/${name}.json`), 'utf8'))
}

// Select the overloads used by this driver from the actual upstream artifact.
// Dart uses the full artifact, including the other overloads. Neither driver
// maintains an independently handwritten copy of these contract signatures.
const signatures = [
  'Lockup(bytes32,uint256,address,address,address,uint256)',
  'claim(bytes32,uint256,address,address,uint256)',
  'lock(bytes32,uint256,address,address,uint256)',
  'refund(bytes32,uint256,address,address,uint256)',
  'refundCooperative(bytes32,uint256,address,address,uint256,uint8,bytes32,bytes32)',
]

export function generateBoltzAbi({ check = false } = {}) {
  const artifact = readBoltzArtifact('ERC20Swap')
  const abi = signatures.map(signature => {
    const entry = artifact.abi.find(item => `${item.name}(${item.inputs?.map(input => input.type).join(',')})` === signature)
    if (!entry) throw new Error(`boltz-core is missing ${signature}`)
    return entry
  })
  const generated = '// Generated from boltz-core by scripts/generate-boltz-abi.mjs. Do not edit.\n' +
    `export const erc20SwapAbi = ${JSON.stringify(abi, null, 2)} as const\n`
  if (check) {
    if (readFileSync(outputPath, 'utf8') !== generated) {
      throw new Error('Boltz TypeScript ABI is stale; run npm run generate:boltz-abi')
    }
  } else {
    writeFileSync(outputPath, generated)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateBoltzAbi({ check: process.argv.includes('--check') })
}
