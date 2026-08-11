# Type Alias: EvmResolvedPaymentIntent

> **EvmResolvedPaymentIntent** = `object`

## Properties

### accountIndex

> **accountIndex**: `number`

***

### amount

> **amount**: [`EvmAmount`](EvmAmount.md)

***

### arbiterAddress

> **arbiterAddress**: [`EvmAddress`](EvmAddress.md)

***

### asset

> **asset**: [`EvmPaymentAsset`](EvmPaymentAsset.md)

***

### chain

> **chain**: [`ResolvedEvmMarketplaceChainConfig`](ResolvedEvmMarketplaceChainConfig.md)

***

### contractAddress

> **contractAddress**: [`EvmAddress`](EvmAddress.md)

***

### contractBytecodeHash

> **contractBytecodeHash**: [`EvmHex`](EvmHex.md)

***

### description

> **description**: `string`

***

### fee

> **fee**: [`EvmAmount`](EvmAmount.md)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### policy

> **policy**: `object`

#### id

> **id**: `string`

#### type

> **type**: `string`

***

### purpose

> **purpose**: `"order"` \| `"bid"`

***

### seed

> **seed**: `string`

***

### sellerAddress

> **sellerAddress**: [`EvmAddress`](EvmAddress.md)

***

### settlementId

> **settlementId**: `string`

***

### tradeId

> **tradeId**: `string`

***

### unlockAt

> **unlockAt**: `bigint`
