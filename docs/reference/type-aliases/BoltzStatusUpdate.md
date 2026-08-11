# Type Alias: BoltzStatusUpdate

> **BoltzStatusUpdate** = `Omit`\<`OpenApiSwapStatus`, `"status"` \| `"transaction"`\> & `object`

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
