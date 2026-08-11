# Type Alias: BoltzReverseSwapRequest

> **BoltzReverseSwapRequest** = `Omit`\<`OpenApiReverseRequest`, `"claimAddress"` \| `"claimCovenant"` \| `"preimageHash"`\> & `object`

## Type Declaration

### claimAddress

> **claimAddress**: [`EvmAddress`](EvmAddress.md)

### claimCovenant?

> `optional` **claimCovenant?**: `boolean`

Boltz 3.12.1's OpenAPI marks this required even though the API defaults it to false.

### preimageHash

> **preimageHash**: [`EvmHex`](EvmHex.md)
