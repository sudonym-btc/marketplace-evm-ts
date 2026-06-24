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
  appId: 'marketplace',
})

const api = marketplace.bind(pool, relays, {
  seed: marketplaceSeed,
  publish,
  orderDrivers: [orderDriver],
})
```

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
  sellerAddress,
  arbiterAddress,
  assetAddress,
  paymentAmount,
})
```

Read the generated [API reference](reference/README.md) for exported types,
call builders, policy helpers, and validation contracts.
