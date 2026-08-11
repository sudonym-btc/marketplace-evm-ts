# Type Alias: EvmChainConfig

> **EvmChainConfig** = `object`

## Properties

### accountAbstraction

> **accountAbstraction**: [`EvmAaConfig`](EvmAaConfig.md)

***

### assets?

> `optional` **assets?**: [`EvmAsset`](EvmAsset.md)[]

***

### blockExplorerUrl?

> `optional` **blockExplorerUrl?**: `string`

Optional base URL for a human-facing block explorer for this chain.
Consumers can use this to build payment-proof links such as transaction pages.

***

### boltz?

> `optional` **boltz?**: [`EvmBoltzConfig`](EvmBoltzConfig.md)

***

### boltzCurrency?

> `optional` **boltzCurrency?**: `string`

***

### chainId

> **chainId**: `number`

***

### id

> **id**: `string`

***

### multiEscrowAddress?

> `optional` **multiEscrowAddress?**: [`EvmAddress`](EvmAddress.md)

Authoritative MultiEscrow deployment used by validators. Payment proofs are
never allowed to select a different contract or runtime hash.

***

### multiEscrowBytecodeHash?

> `optional` **multiEscrowBytecodeHash?**: [`EvmHex`](EvmHex.md)

***

### name?

> `optional` **name?**: `string`

***

### nativeAsset

> **nativeAsset**: [`EvmAsset`](EvmAsset.md)

***

### publicClient?

> `optional` **publicClient?**: `PublicClient`

***

### rpcUrl?

> `optional` **rpcUrl?**: `string`
