# Type Alias: SwapServiceOptions

> **SwapServiceOptions** = `object`

## Properties

### accounts

> **accounts**: [`EvmAccountManager`](EvmAccountManager.md)

***

### boltz

> **boltz**: [`BoltzClient`](BoltzClient.md)

***

### chains

> **chains**: [`ResolvedEvmChainConfig`](ResolvedEvmChainConfig.md)[]

***

### logger?

> `optional` **logger?**: `MarketplaceDriverLogger`

***

### now?

> `optional` **now?**: () => `number`

#### Returns

`number`

***

### seed

> **seed**: `string` \| [`EvmSeedConfig`](EvmSeedConfig.md)

***

### store

> **store**: [`EvmOperationStore`](EvmOperationStore.md)

***

### trustByChainId?

> `optional` **trustByChainId?**: `Record`\<`number`, [`EvmBoltzChainTrust`](EvmBoltzChainTrust.md)\>
