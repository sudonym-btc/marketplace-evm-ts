# Type Alias: BoltzSubmarineSwapResponse

> **BoltzSubmarineSwapResponse** = `Omit`\<`OpenApiSubmarineResponse`, `"address"` \| `"expectedAmount"` \| `"timeoutBlockHeight"`\> & `object`

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:59](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L59)

## Type Declaration

### address?

> `optional` **address?**: [`EvmAddress`](EvmAddress.md)

### claimAddress?

> `optional` **claimAddress?**: [`EvmAddress`](EvmAddress.md)

EVM submarine swaps return this at runtime, but Boltz 3.12.1's OpenAPI schema omits it.

### expectedAmount?

> `optional` **expectedAmount?**: `number`

### timeoutBlockHeight

> **timeoutBlockHeight**: `number`
