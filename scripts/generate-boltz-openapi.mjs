import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString, COMMENT_HEADER } from '@sudonym-btc/nmdk-openapi-tooling'

// This pinned document also generates the Dart driver's Chopper models. Updating
// a running backend must never silently change either driver's public types.
export const boltzSchemaPath = fileURLToPath(new URL('../schemas/boltz.openapi.json', import.meta.url))
const outputPath = fileURLToPath(new URL('../src/boltz/openapi.generated.ts', import.meta.url))

export async function generateBoltzTypes({ check = false } = {}) {
  const spec = JSON.parse(readFileSync(boltzSchemaPath, 'utf8'))
  if (!spec.openapi || !spec.paths) throw new Error('Boltz schema must contain openapi and paths')
  const generated = COMMENT_HEADER + astToString(await openapiTS(spec))
  if (check) {
    if (readFileSync(outputPath, 'utf8') !== generated) {
      throw new Error('Boltz TypeScript types are stale; run npm run generate:boltz-openapi')
    }
  } else {
    writeFileSync(outputPath, generated)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateBoltzTypes({ check: process.argv.includes('--check') })
}
