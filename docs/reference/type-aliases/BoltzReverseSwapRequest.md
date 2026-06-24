# Type Alias: BoltzReverseSwapRequest

> **BoltzReverseSwapRequest** = `Omit`\<`OpenApiReverseRequest`, `"claimAddress"` \| `"claimCovenant"` \| `"preimageHash"`\> & `object`

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:36](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L36)

## Type Declaration

### claimAddress

> **claimAddress**: [`EvmAddress`](EvmAddress.md)

### claimCovenant?

> `optional` **claimCovenant?**: `boolean`

Boltz 3.12.1's OpenAPI marks this required even though the API defaults it to false.

### preimageHash

> **preimageHash**: [`EvmHex`](EvmHex.md)
