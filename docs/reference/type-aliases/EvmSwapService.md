# Type Alias: EvmSwapService

> **EvmSwapService** = `object`

## Methods

### listActive()

> **listActive**(): `Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

#### Returns

`Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

***

### resume()

> **resume**(`id`): `Promise`\<[`SwapResumeResult`](SwapResumeResult.md)\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`SwapResumeResult`](SwapResumeResult.md)\>

***

### swapIn()

> **swapIn**(`request`): `Promise`\<[`SwapInResult`](SwapInResult.md)\>

#### Parameters

##### request

[`SwapInRequest`](SwapInRequest.md)

#### Returns

`Promise`\<[`SwapInResult`](SwapInResult.md)\>

***

### swapOut()

> **swapOut**(`request`): `Promise`\<[`SwapOutResult`](SwapOutResult.md)\>

#### Parameters

##### request

[`SwapOutRequest`](SwapOutRequest.md)

#### Returns

`Promise`\<[`SwapOutResult`](SwapOutResult.md)\>
