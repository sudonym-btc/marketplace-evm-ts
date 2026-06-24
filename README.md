# marketplace-evm-ts

`@sudonym-btc/marketplace-evm` is a Nostr-agnostic EVM payment engine for
marketplaces. It owns EVM escrow validation, escrow lifecycle calls,
Boltz-backed swap orchestration, operation recovery, and the account
abstraction integration point.

## Docs

Package-owned docs live in [`docs`](docs/README.md). Start with
[`docs/getting-started.md`](docs/getting-started.md) and regenerate the API
reference with:

```sh
npm run docs:api
```

It deliberately does **not** depend on `nostr-tools`, NDK, or any Nostr event
types. Nostr marketplace adapters should translate listing/order proofs into
the plain request types exported by this package.

## Responsibilities

- Validate EVM escrow funding proofs from transaction receipts and contract logs.
- Build escrow fund, release, claim, arbitrate, and withdraw calls.
- Execute calls through ERC-4337 account abstraction only.
- Coordinate Boltz swap-in and swap-out lifecycles.
- Persist and resume swap/escrow operations through caller-provided storage.
- Derive per-trade AA owner accounts from a caller-provided marketplace seed.
- Report deterministic usage watermarks for marketplace parent index recovery.

Marketplace validation is self-contained at the payment proof layer. EVM proof
params carry the transaction hash, chain id, trade id, parties, asset,
`paymentAmount`, optional `bondAmount`, optional `escrowFee`, `unlockAt`,
timeout claimant, and context hashes. The validator resolves encrypted params
through the shared driver `decryptParams` hook when needed, then verifies the
transaction receipt and decoded `TradeCreated` log. Contract address and
bytecode hash are optional proof params; when the address is omitted, the
configured chain `multiEscrowAddress` is used.

## Non-Responsibilities

- Nostr relay access.
- Nostr event parsing or signing.
- Marketplace listing/order schemas.
- Participant identity proof resolution.

## Package Boundary

Core marketplace users should import only their marketplace protocol package.
They do not need this package and should not download EVM, AA, or Boltz
dependencies.

EVM-enabled marketplace apps can add this package and a small adapter:

```ts
import { createMarketplaceEvmClient } from '@sudonym-btc/marketplace-evm'

const evm = createMarketplaceEvmClient({
  chains,
  operationStore,
  seed: marketplaceSeed,
  tradeIndex,
  boltz,
})

const validation = await evm.escrow.validate({
  chainId,
  txHash,
  tradeId,
  contractAddress,
  sellerAddress,
  arbiterAddress,
  assetAddress,
  paymentAmount,
})

const calls = evm.escrow.createTrade({
  tradeId,
  buyerAddress,
  sellerAddress,
  arbiterAddress,
  assetAddress,
  paymentAmount,
  contractAddress,
  unlockAt,
})
```

Seeded clients can also be created without an active `tradeIndex` when the
caller only wants discovery:

```ts
const evm = createMarketplaceEvmClient({
  chains,
  operationStore,
  seed: marketplaceSeed,
})

const discovery = await evm.discoverHighWatermark({
  highWaterMark: currentMarketplaceMax,
  unusedWindow: 50,
})
```

Discovery checks deterministic AA activity for each derived trade index: smart
account deployment, EntryPoint nonce, and optional protocol probes supplied by
the adapter. It does not sweep arbitrary ERC20 or native balances.

## Current Status

This package has working MultiEscrow validation/call builders and Boltz-backed
Arbitrum swap orchestration covered by local-stack integration tests. Account
abstraction is implemented with `permissionless` + `viem`: each chain can carry
its own EntryPoint, SimpleAccount factory, bundler, and Pimlico-compatible
paymaster config. Every configured chain must provide account-abstraction
config. Callers can still pass a custom executor for tests or adapters, but a
viem `LocalAccount` is enough for the package to build a sponsored ERC-4337
executor per chain. For marketplace recovery, callers should prefer `seed` plus
`tradeIndex` so the package can derive the same per-trade owner accounts on a
new device.

## Integration Tests

The package carries `sudonym-btc/marketplace-evm-stack` as a test submodule so
it can be tested without any application monorepo:

```sh
git submodule update --init --recursive
test/stack/scripts/up.sh
test/stack/scripts/wait.sh
npm run test:integration
```

The tests also work against a sibling or parent-project stack checkout. If no
generated stack config file is found, they fall back to the default local stack
ports and compute the deployed MultiEscrow runtime hash from the chain.
