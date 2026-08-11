# Type Alias: MarketplaceEvmClientOptions

> **MarketplaceEvmClientOptions** = `object`

## Properties

### account?

> `optional` **account?**: `LocalAccount`

***

### boltz?

> `optional` **boltz?**: [`EvmBoltzConfig`](EvmBoltzConfig.md)

***

### chains

> **chains**: [`EvmChainConfig`](EvmChainConfig.md)[]

***

### executor?

> `optional` **executor?**: [`EvmExecutor`](EvmExecutor.md)

***

### logger?

> `optional` **logger?**: `MarketplaceDriverLogger`

***

### now?

> `optional` **now?**: () => `number`

#### Returns

`number`

***

### operationStore

> **operationStore**: [`EvmOperationStore`](EvmOperationStore.md)

***

### protocolActivityProbe?

> `optional` **protocolActivityProbe?**: [`EvmProtocolActivityProbe`](EvmProtocolActivityProbe.md)

***

### seed?

> `optional` **seed?**: `string` \| [`EvmSeedConfig`](EvmSeedConfig.md)

***

### smartAccountAddressResolver?

> `optional` **smartAccountAddressResolver?**: [`EvmSmartAccountAddressResolver`](EvmSmartAccountAddressResolver.md)

***

### tradeIndex?

> `optional` **tradeIndex?**: `number`
