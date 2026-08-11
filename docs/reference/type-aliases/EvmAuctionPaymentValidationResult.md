# Type Alias: EvmAuctionPaymentValidationResult

> **EvmAuctionPaymentValidationResult** = `object`

## Properties

### amount?

> `optional` **amount?**: [`EvmAmount`](EvmAmount.md)

***

### amountMatched?

> `optional` **amountMatched?**: `boolean`

***

### arbiterMatched?

> `optional` **arbiterMatched?**: `boolean`

***

### assetMatched?

> `optional` **assetMatched?**: `boolean`

***

### bid?

> `optional` **bid?**: [`EvmAuctionBidLog`](EvmAuctionBidLog.md)

***

### chainId

> **chainId**: `number`

***

### confirmations?

> `optional` **confirmations?**: `number`

***

### error?

> `optional` **error?**: `string`

***

### method

> **method**: `"evm"`

***

### recipientMatched?

> `optional` **recipientMatched?**: `boolean`

***

### status

> **status**: `"valid"` \| `"invalid"` \| `"pending"` \| `"expired"` \| `"unverifiable"`

***

### txHash

> **txHash**: [`EvmHash`](EvmHash.md)
