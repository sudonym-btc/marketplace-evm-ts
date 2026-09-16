# Type Alias: BoltzSubmarineSwapResponse

> **BoltzSubmarineSwapResponse** = `Omit`\<`OpenApiSubmarineResponse`, `"address"` \| `"claimAddress"` \| `"expectedAmount"` \| `"timeoutBlockHeight"`\> & `object`

## Type Declaration

### address?

> `optional` **address?**: [`EvmAddress`](EvmAddress.md)

### claimAddress?

> `optional` **claimAddress?**: [`EvmAddress`](EvmAddress.md)

EVM refinement of the shared wire schema's optional claim address.

### expectedAmount?

> `optional` **expectedAmount?**: `number`

### timeoutBlockHeight

> **timeoutBlockHeight**: `number`
