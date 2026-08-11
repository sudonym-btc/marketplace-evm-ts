# Type Alias: SwapInRequest

> **SwapInRequest** = [`SwapAttemptRequest`](SwapAttemptRequest.md) & `object`

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

### recoveryProof?

> `optional` **recoveryProof?**: `Record`\<`string`, `unknown`\>

Public proof template used to reconstruct publication after a crash.

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
