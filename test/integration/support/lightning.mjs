import { execFileSync, spawn } from 'node:child_process'

function lndContainer(options = {}) {
  if (process.env.MARKETPLACE_EVM_LND_CONTAINER) return process.env.MARKETPLACE_EVM_LND_CONTAINER

  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const project = options.project ?? process.env.MARKETPLACE_EVM_STACK_PROJECT
  const preferStandalone = options.apiUrl && !options.apiUrl.includes(':9001')

  if (project) {
    const projectContainer = names.find(name => name.includes(project) && /(^|[-_])lnd-1([-_]|$)/.test(name))
    if (projectContainer) return projectContainer
  }

  return (
    (preferStandalone ? names.find(name => name !== 'boltz-lnd-1' && /(^|[-_])lnd-1([-_]|$)/.test(name)) : undefined) ??
    names.find(name => name === 'boltz-lnd-1') ??
    names.find(name => /(^|[-_])lnd-1([-_]|$)/.test(name)) ??
    'boltz-lnd-1'
  )
}

function lncliArgs(container, args) {
  return [
    'exec',
    container,
    'lncli',
    '--network=regtest',
    '--rpcserver=localhost:10009',
    '--tlscertpath=/app/lnd/tls.cert',
    '--macaroonpath=/app/lnd/data/chain/bitcoin/regtest/admin.macaroon',
    ...args,
  ]
}

export function createInvoice(amountSats, memo = 'marketplace-evm-ts integration', options = {}) {
  const output = execFileSync(
    'docker',
    lncliArgs(lndContainer(options), ['addinvoice', '--amt', String(amountSats), '--memo', memo, '--expiry', '3600']),
    { encoding: 'utf8' },
  )
  const invoice = JSON.parse(output)
  return {
    invoice: invoice.payment_request,
    paymentHash: invoice.r_hash,
  }
}

export function payInvoice(invoice, options = {}) {
  const child = spawn(
    'docker',
    lncliArgs(lndContainer(options), ['payinvoice', '--force', invoice]),
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', data => {
    output += data.toString()
  })
  child.stderr.on('data', data => {
    output += data.toString()
  })

  return {
    child,
    output: () => output,
    stop() {
      if (!child.killed) child.kill('SIGTERM')
    },
  }
}
