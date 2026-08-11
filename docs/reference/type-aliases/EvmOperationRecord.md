# Type Alias: EvmOperationRecord

> **EvmOperationRecord** = `object`

## Properties

### chainId

> **chainId**: `number`

***

### createdAt

> **createdAt**: `number`

***

### data

> **data**: `Record`\<`string`, `unknown`\>

Public recovery journal only. Implementations must not persist seeds,
preimages, invoice plaintext, opaque provider payloads, or provider error
bodies here.

***

### error?

> `optional` **error?**: `string`

***

### id

> **id**: `string`

***

### kind

> **kind**: `"swap_in"` \| `"swap_out"` \| `"escrow"`

***

### status

> **status**: [`EvmOperationStatus`](EvmOperationStatus.md)

***

### swapId?

> `optional` **swapId?**: `string`

***

### tradeId?

> `optional` **tradeId?**: `string`

***

### txHash?

> `optional` **txHash?**: [`EvmHash`](EvmHash.md)

***

### updatedAt

> **updatedAt**: `number`
