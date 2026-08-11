# Type Alias: EvmPayRequest

> **EvmPayRequest** = `object`

## Properties

### chains

> **chains**: [`ResolvedEvmMarketplaceChainConfig`](ResolvedEvmMarketplaceChainConfig.md)[]

***

### intent

> **intent**: [`GenericPaymentIntent`](GenericPaymentIntent.md)

***

### logger?

> `optional` **logger?**: `MarketplaceDriverLogger`

***

### operationStore

> **operationStore**: [`EvmOperationStore`](EvmOperationStore.md)

***

### state

> **state**: [`EvmMarketplacePolicyState`](EvmMarketplacePolicyState.md)

## Methods

### setState()

> **setState**(`state`): `void`

#### Parameters

##### state

[`EvmMarketplacePolicyState`](EvmMarketplacePolicyState.md)

#### Returns

`void`
