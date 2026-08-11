# Type Alias: SwapResumeResult

> **SwapResumeResult** = `object`

## Properties

### cooperativeRefundSignature?

> `optional` **cooperativeRefundSignature?**: [`EvmHex`](EvmHex.md)

Provider signature for an early cooperative refund; never persisted.

***

### latestStatus?

> `optional` **latestStatus?**: [`BoltzStatusUpdate`](BoltzStatusUpdate.md)

***

### operation

> **operation**: [`EvmOperationRecord`](EvmOperationRecord.md)

***

### preimage?

> `optional` **preimage?**: [`EvmHex`](EvmHex.md)

Returned only at completion and never persisted by the service.
