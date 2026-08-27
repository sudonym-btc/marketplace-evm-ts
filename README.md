# marketplace-evm-ts

`@sudonym-btc/marketplace-evm` is a Nostr-agnostic EVM payment engine for
marketplaces. It owns EVM escrow validation, escrow lifecycle calls,
Boltz-backed swap orchestration, operation recovery, and the account
abstraction integration point.

## Docs

Package-owned docs live in [`docs`](docs/README.md) and are published at
<https://sudonym-btc.github.io/marketplace-evm-ts/>. Start with
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
- Release or refund validated order escrows with receipt-bound, idempotent arbitration.
- Derive per-trade AA owner accounts from a caller-provided marketplace seed.
- Report deterministic usage watermarks for marketplace parent index recovery.

Marketplace validation is self-contained at the payment proof layer. EVM proof
params carry the transaction hash, chain id, trade id, parties, asset,
`paymentAmount`, optional `bondAmount`, optional `escrowFee`, `unlockAt`,
timeout claimant, and context hashes. The validator resolves encrypted params
through the shared driver `decryptParams` hook when needed, then verifies the
transaction receipt and decoded `TradeCreated` log. Contract address and
bytecode hash are assertions only. The configured chain—not the proof—is the
trust root for `multiEscrowAddress` and its SHA-256 runtime bytecode hash.
Validation fails closed if that deployment or any exact escrow term differs.

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

## Swap trust roots and recovery

Boltz is untrusted at the call boundary. Before requesting a quote or creating
a swap, configure `boltz.trustByChainId` with the expected ERC20Swap address
and SHA-256 runtime hash. Routed swaps additionally require pinned call targets
and selector-specific semantic decoders:

```ts
const boltz = {
  apiUrl,
  trustByChainId: {
    [chainId]: {
      erc20Swap: { address: erc20Swap, runtimeBytecodeHash: erc20SwapHash },
      dexCallTargets: [{
        address: universalRouter,
        runtimeBytecodeHash: universalRouterHash,
        functions: [{
          selector: '0x24856bc3',
          decoder: 'uniswap-universal-router-v3-exact-in-v1',
        }],
      }],
    },
  },
}
```

Unknown targets/selectors, native value, over-approval, extra router commands,
and mismatched tokens, amounts, paths, or recipients are rejected before a
provider side effect. Production operation stores should implement atomic
`putIfAbsent`.

## Order settlement

Pass a `settlementAccount` only in an arbiter process that controls the EVM
address named by the payment proof. Without it, the order policy advertises no
financial actions. With it, the policy still authorizes `release` and `refund`
per payment: encrypted proof params are resolved ephemerally and the configured
account must exactly match that payment's arbiter.

Settlement signs the MultiEscrow v7 EIP-712 arbitration, persists the first
transaction or user-operation hash before waiting, and accepts completion only
when the receipt contains the exact contract, trade, token, parties, amounts,
and factors. A retry reconciles the original submission and never broadcasts a
replacement. The durable record contains only those public on-chain bindings
and submission hashes; decrypted params, proofs, provider bodies, and raw
provider errors are not stored. If the process stops after the chain action but
before its marketplace settlement event is published, the completed tombstone
re-exposes only the already-committed action. Replaying it reverifies the
receipt, returns the original protected proof, and performs no broadcast.

### Durable operation record schema

Operation records are recovery journals, not provider-response caches. The
durable surface is limited to:

- top-level operation, chain, trade, swap, transaction, status, and timestamp
  fields;
- `data.request` with `tradeIndex`, `attemptIndex`, `chainId`, optional public
  `assetAddress`, and an optional public recovery-proof template;
- exact public call plans needed to finish a routed claim, lock, or refund;
- `data.providerStatus` with only `status`, optional provider `id`, and optional
  transaction hash;
- request/invoice fingerprints, payment hashes, pinned runtime hashes, limits,
  and `*Submission` transaction or user-operation hashes used for crash-safe
  reconciliation.

Seeds, derived private material, swap preimages, BOLT11 invoice plaintext,
opaque provider payloads, and provider error bodies are never written to the
operation store. A newly returned swap-in invoice lives only in memory; after a
restart, an exact retry fails closed instead of creating another swap. Provider
completion preimages and cooperative-refund signatures are also returned only
ephemerally.

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
