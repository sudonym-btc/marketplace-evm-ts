# Type Alias: SwapInRequest

> **SwapInRequest** = [`SwapAttemptRequest`](SwapAttemptRequest.md) & `object`

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:14](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L14)

## Type Declaration

### amount

> **amount**: [`EvmAmount`](EvmAmount.md)

### assetAddress?

> `optional` **assetAddress?**: [`EvmAddress`](EvmAddress.md)

### boltzAmountSats?

> `optional` **boltzAmountSats?**: `number`

### boltzCurrency

> **boltzCurrency**: `string`

### chainId

> **chainId**: `number`

### description?

> `optional` **description?**: `string`

### lightningCurrency?

> `optional` **lightningCurrency?**: `string`

### postClaimCalls?

> `optional` **postClaimCalls?**: [`NamedEvmCall`](NamedEvmCall.md)[]

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
