import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputFile = resolve(rootDir, 'src/boltz/openapi.generated.ts')
const cacheDir = resolve(rootDir, 'node_modules/.cache/marketplace-evm-ts')
const tempSpecFile = resolve(cacheDir, 'boltz-openapi.json')

function readSpecFromFile(path) {
  return readFileSync(resolve(rootDir, path), 'utf8')
}

async function readSpecFromUrl(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to fetch Boltz OpenAPI spec from ${url}: ${response.status}`)
  return await response.text()
}

function readSpecFromDocker(container) {
  return execFileSync(
    'docker',
    ['exec', container, 'cat', '/boltz-backend/dist/lib/api/static/swagger-spec.json'],
    { encoding: 'utf8' },
  )
}

function normalizeSpec(raw) {
  const spec = JSON.parse(raw)
  if (!spec.openapi || !spec.paths) throw new Error('Boltz OpenAPI spec did not contain openapi/paths fields')
  return `${JSON.stringify(spec, null, 2)}\n`
}

async function main() {
  const sourceFile = process.env.BOLTZ_OPENAPI_SPEC
  const sourceUrl = process.env.BOLTZ_OPENAPI_URL
  const container = process.env.BOLTZ_BACKEND_CONTAINER ?? 'boltz-backend'

  const rawSpec = sourceFile
    ? readSpecFromFile(sourceFile)
    : sourceUrl
      ? await readSpecFromUrl(sourceUrl)
      : readSpecFromDocker(container)

  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(tempSpecFile, normalizeSpec(rawSpec))

  const openapiTypescript = resolve(rootDir, 'node_modules/.bin/openapi-typescript')
  if (!existsSync(openapiTypescript)) throw new Error('openapi-typescript is not installed')

  execFileSync(openapiTypescript, [tempSpecFile, '--output', outputFile], {
    cwd: rootDir,
    stdio: 'inherit',
  })
  rmSync(tempSpecFile, { force: true })
}

await main()
