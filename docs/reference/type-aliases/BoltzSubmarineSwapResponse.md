# Type Alias: BoltzSubmarineSwapResponse

> **BoltzSubmarineSwapResponse** = `Omit`\<`OpenApiSubmarineResponse`, `"address"` \| `"expectedAmount"` \| `"timeoutBlockHeight"`\> & `object`

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
