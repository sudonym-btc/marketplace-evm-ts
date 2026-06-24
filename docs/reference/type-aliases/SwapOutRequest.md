# Type Alias: SwapOutRequest

> **SwapOutRequest** = [`SwapAttemptRequest`](SwapAttemptRequest.md) & `object`

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:31](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L31)

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
