# Type Alias: SwapOutRequest

> **SwapOutRequest** = [`SwapAttemptRequest`](SwapAttemptRequest.md) & `object`

## Type Declaration

### amount?

> `optional` **amount?**: [`EvmAmount`](EvmAmount.md)

### assetAddress?

> `optional` **assetAddress?**: [`EvmAddress`](EvmAddress.md)

### boltzCurrency

> **boltzCurrency**: `string`

### chainId

> **chainId**: `number`

### invoice?

> `optional` **invoice?**: `string`

### invoiceDescription?

> `optional` **invoiceDescription?**: `string`

### lightningCurrency?

> `optional` **lightningCurrency?**: `string`

### preLockCalls?

> `optional` **preLockCalls?**: [`NamedEvmCall`](NamedEvmCall.md)[]

### routeVia?

> `optional` **routeVia?**: `object`

#### routeVia.assetAddress

> **assetAddress**: [`EvmAddress`](EvmAddress.md)

#### routeVia.boltzCurrency

> **boltzCurrency**: `string`

#### routeVia.decimals

> **decimals**: `number`

#### routeVia.quoteCurrency

> **quoteCurrency**: `string`
