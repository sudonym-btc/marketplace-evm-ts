# Type Alias: EvmEscrowPaymentValidationResult

> **EvmEscrowPaymentValidationResult** = `object`

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

### chainId

> **chainId**: `number`

***

### confirmations?

> `optional` **confirmations?**: `number`

***

### error?

> `optional` **error?**: `string`

***

### funding?

> `optional` **funding?**: [`EvmEscrowFundingLog`](EvmEscrowFundingLog.md)

***

### method

> **method**: `"evm"`

***

### recipientMatched?

> `optional` **recipientMatched?**: `boolean`

***

### status

> **status**: [`EvmEscrowPaymentValidationStatus`](EvmEscrowPaymentValidationStatus.md)

***

### txHash

> **txHash**: [`EvmHash`](EvmHash.md)
