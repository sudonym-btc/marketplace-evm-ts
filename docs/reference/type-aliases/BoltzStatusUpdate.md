# Type Alias: BoltzStatusUpdate

> **BoltzStatusUpdate** = `Omit`\<`OpenApiSwapStatus`, `"status"` \| `"transaction"`\> & `object`

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:25](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L25)

## Type Declaration

### error?

> `optional` **error?**: `string`

### id?

> `optional` **id?**: `string`

### status

> **status**: [`BoltzSwapStatus`](BoltzSwapStatus.md) \| `string`

### transaction?

> `optional` **transaction?**: `object`

#### transaction.hex?

> `optional` **hex?**: `string`

#### transaction.id?

> `optional` **id?**: [`EvmHash`](EvmHash.md)

### transactionHash?

> `optional` **transactionHash?**: [`EvmHash`](EvmHash.md)
