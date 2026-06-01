import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const satsToTbtcWei = sats => BigInt(Math.ceil(Number(sats))) * 10n ** 10n
export const tbtcWeiToSatsCeil = wei => Number((wei + 10n ** 10n - 1n) / 10n ** 10n)

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function waitForSwapStatus(boltz, id, statuses, { timeoutMs = 180_000, intervalMs = 2_000 } = {}) {
  const wanted = new Set(statuses)
  const deadline = Date.now() + timeoutMs
  let last

  while (Date.now() < deadline) {
    last = await boltz.getSwap(id)
    if (wanted.has(last.status)) return last
    if (/failed|expired/i.test(last.status)) {
      throw new Error(`Swap ${id} failed with ${last.status}: ${JSON.stringify(last)}`)
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for swap ${id}; last status: ${JSON.stringify(last)}`)
}

async function readJson(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}

export async function dexQuoteIn(apiUrl, currency, { tokenIn, tokenOut, amountIn }) {
  const url = new URL(`${apiUrl.replace(/\/$/, '')}/quote/${currency}/in`)
  url.searchParams.set('tokenIn', tokenIn)
  url.searchParams.set('tokenOut', tokenOut)
  url.searchParams.set('amountIn', amountIn.toString())
  const quotes = await readJson(await fetch(url))
  if (!Array.isArray(quotes) || quotes.length === 0) throw new Error(`No DEX /in quote for ${tokenIn}->${tokenOut}`)
  return {
    amountIn,
    amountOut: BigInt(quotes[0].quote),
    data: quotes[0].data,
  }
}

export async function dexQuoteOut(apiUrl, currency, { tokenIn, tokenOut, amountOut }) {
  const url = new URL(`${apiUrl.replace(/\/$/, '')}/quote/${currency}/out`)
  url.searchParams.set('tokenIn', tokenIn)
  url.searchParams.set('tokenOut', tokenOut)
  url.searchParams.set('amountOut', amountOut.toString())
  const quotes = await readJson(await fetch(url))
  if (!Array.isArray(quotes) || quotes.length === 0) throw new Error(`No DEX /out quote for ${tokenIn}->${tokenOut}`)
  return {
    amountIn: BigInt(quotes[0].quote),
    amountOut,
    data: quotes[0].data,
  }
}

export async function encodeDexCalls(apiUrl, currency, { recipient, amountIn, amountOutMin, data }) {
  const response = await readJson(
    await fetch(`${apiUrl.replace(/\/$/, '')}/quote/${currency}/encode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient,
        amountIn: amountIn.toString(),
        amountOutMin: amountOutMin.toString(),
        data,
      }),
    }),
  )

  return response.calls.map((call, index) => ({
    name: `DEX.${index}`,
    to: call.to,
    value: BigInt(call.value ?? 0),
    data: call.data.startsWith('0x') ? call.data : `0x${call.data}`,
  }))
}

function dockerContainer(exact, pattern, options = {}) {
  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const project = options.project ?? process.env.MARKETPLACE_EVM_STACK_PROJECT
  const preferStandalone = options.apiUrl && !options.apiUrl.includes(':9001')

  if (project) {
    const projectContainer = names.find(name => name.includes(project) && pattern.test(name))
    if (projectContainer) return projectContainer
  }

  return (
    (preferStandalone ? names.find(name => name !== exact && pattern.test(name)) : undefined) ??
    names.find(name => name === exact) ??
    names.find(name => pattern.test(name)) ??
    exact
  )
}

export function clearBoltzPendingEvmTransactions(options = {}) {
  execFileSync(
    'docker',
    [
      'exec',
      dockerContainer('boltz-postgres', /(^|[-_])postgres([-_]|$)/, options),
      'psql',
      '-U',
      'boltz',
      '-d',
      'boltz',
      '-c',
      'DELETE FROM "pendingEthereumTransactions";',
    ],
    { stdio: 'ignore' },
  )
}
