# Type Alias: EvmSwapService

> **EvmSwapService** = `object`

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:113](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L113)

## Methods

### listActive()

> **listActive**(): `Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:117](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L117)

#### Returns

`Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

***

### resume()

> **resume**(`id`): `Promise`\<[`SwapResumeResult`](SwapResumeResult.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:116](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L116)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`SwapResumeResult`](SwapResumeResult.md)\>

***

### swapIn()

> **swapIn**(`request`): `Promise`\<[`SwapInResult`](SwapInResult.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:114](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L114)

#### Parameters

##### request

[`SwapInRequest`](SwapInRequest.md)

#### Returns

`Promise`\<[`SwapInResult`](SwapInResult.md)\>

***

### swapOut()

> **swapOut**(`request`): `Promise`\<[`SwapOutResult`](SwapOutResult.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:115](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L115)

#### Parameters

##### request

[`SwapOutRequest`](SwapOutRequest.md)

#### Returns

`Promise`\<[`SwapOutResult`](SwapOutResult.md)\>
