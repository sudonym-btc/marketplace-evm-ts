# Getting started with the Marketplace EVM Driver

`@sudonym-btc/marketplace-evm` owns EVM escrow validation, escrow call
construction, account-abstraction execution, Boltz swap orchestration, and
operation recovery for NMDK marketplace payments. It does not import
`nostr-tools`; marketplace adapters translate Nostr events into the plain
requests accepted by this package.

## Install

```sh
npm install @sudonym-btc/marketplace-evm
```

In the NMDK workspace, the package is consumed from the checked-out submodule.

## Create a marketplace EVM client

```ts
import {
  createMarketplaceEvmClient,
  createEvmEscrowPolicy,
  MemoryOperationStore,
} from '@sudonym-btc/marketplace-evm'

const operationStore = new MemoryOperationStore()

const evm = createMarketplaceEvmClient({
  chains,
  operationStore,
  seed: marketplaceSeed,
  tradeIndex: 0,
})
```

## Add the driver to a marketplace runtime

```ts
const orderDriver = createEvmEscrowPolicy({
  chains,
  operationStore,
  settlementAccount: arbiterAccount,
  appId: 'marketplace',
  withdrawals: {
    createInvoice: (amountSats, description) =>
      lightningWallet.createInvoice(amountSats, description),
  },
})

const api = marketplace.bind(pool, relays, {
  seed: marketplaceSeed,
  publish,
  orderDrivers: [orderDriver],
})
```

Omit `settlementAccount` in buyer/seller clients and monitor-only arbiters. When
it is present, the driver declares `release` and `refund` as maximum
capabilities, then narrows them for each payment by resolving protected params
and comparing the proof's arbiter address with the account. The marketplace
runtime therefore never shows another arbiter's financial controls.

The EVM driver supplies payout invoice requests with descriptions like
`Marketplace Payout ${tradeId}`. Swap-in purchase invoices use
`Marketplace Purchase ${tradeId}`.

## Validate escrow proofs

The driver validates proof-local facts from transaction receipts and decoded
contract logs. The Nostr layer can then compare the returned terms with signed
order or auction data.

```ts
const result = await evm.escrow.validate({
  chainId,
  txHash,
  tradeId,
  contractAddress,
  contractBytecodeHash,
  buyerAddress,
  sellerAddress,
  arbiterAddress,
  assetAddress,
  paymentAmount,
  bondAmount,
  unlockAt,
  timeoutClaimantAddress,
  escrowFee,
  contextHash,
  recycleCovenantHash,
})
```

Every chain must pin `multiEscrowAddress` and `multiEscrowBytecodeHash`.
Boltz-enabled clients must also provide `boltz.trustByChainId`; routed swaps
require runtime-pinned targets with a supported semantic decoder. The local
test stack writes authoritative development values under
`chains.*.boltzTrust` in `data/config/marketplace-evm-stack.json`.

Use a durable operation store with atomic `putIfAbsent` in production. Stored
records contain only public recovery fields, exact recovery call plans, hashes,
and allowlisted provider status summaries. They do not contain seeds,
preimages, BOLT11 invoice plaintext, opaque provider responses, or provider
error bodies. Broadcast transaction/user-operation hashes are persisted before
receipt waits so retries reconcile the original submission instead of sending a
replacement.

Order settlement uses the same durable store. Only public receipt bindings and
the first submission hashes are retained. Startup reconciles a submitted
operation through `waitForSubmission`, verifies the exact `Arbitrated` event,
and never rebroadcasts. Keep this store durable across process restarts; do not
replace it with an expiring cache. A completed tombstone also supports a
receipt-reverified, zero-broadcast replay when the public settlement event still
needs to be published.

Read the generated [API reference](reference/README.md) for exported types,
call builders, policy helpers, and validation contracts.
