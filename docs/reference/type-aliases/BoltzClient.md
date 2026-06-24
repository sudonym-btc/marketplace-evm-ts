# Type Alias: BoltzClient

> **BoltzClient** = `object`

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:95](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L95)

## Methods

### createReverseSwap()

> **createReverseSwap**(`request`): `Promise`\<[`BoltzReverseSwapResponse`](BoltzReverseSwapResponse.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:98](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L98)

#### Parameters

##### request

[`BoltzReverseSwapRequest`](BoltzReverseSwapRequest.md)

#### Returns

`Promise`\<[`BoltzReverseSwapResponse`](BoltzReverseSwapResponse.md)\>

***

### createSubmarineSwap()

> **createSubmarineSwap**(`request`): `Promise`\<[`BoltzSubmarineSwapResponse`](BoltzSubmarineSwapResponse.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:99](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L99)

#### Parameters

##### request

[`BoltzSubmarineSwapRequest`](BoltzSubmarineSwapRequest.md)

#### Returns

`Promise`\<[`BoltzSubmarineSwapResponse`](BoltzSubmarineSwapResponse.md)\>

***

### encodeTokenSwap()

> **encodeTokenSwap**(`currency`, `request`): `Promise`\<[`NamedEvmCall`](NamedEvmCall.md)[]\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:102](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L102)

#### Parameters

##### currency

`string`

##### request

`BoltzDexEncodeRequest`

#### Returns

`Promise`\<[`NamedEvmCall`](NamedEvmCall.md)[]\>

***

### getCooperativeRefundSignature()

> **getCooperativeRefundSignature**(`id`): `Promise`\<`` `0x${string}` `` \| `null`\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:106](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L106)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`` `0x${string}` `` \| `null`\>

***

### getReversePairs()

> **getReversePairs**(): `Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: \{ `claim`: `number`; `lockup`: `number`; \}; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `minimal`: `number`; \}; `rate`: `number`; \}\>\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:96](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L96)

#### Returns

`Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: \{ `claim`: `number`; `lockup`: `number`; \}; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `minimal`: `number`; \}; `rate`: `number`; \}\>\>

***

### getSubmarinePairs()

> **getSubmarinePairs**(): `Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: `number`; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `maximalZeroConf`: `number`; `minimal`: `number`; `minimalBatched?`: `number`; \}; `rate`: `number`; \}\>\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:97](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L97)

#### Returns

`Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: `number`; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `maximalZeroConf`: `number`; `minimal`: `number`; `minimalBatched?`: `number`; \}; `rate`: `number`; \}\>\>

***

### getSubmarinePreimage()

> **getSubmarinePreimage**(`id`): `Promise`\<`` `0x${string}` ``\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:105](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L105)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### getSwap()

> **getSwap**(`id`): `Promise`\<[`BoltzStatusUpdate`](BoltzStatusUpdate.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:103](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L103)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`BoltzStatusUpdate`](BoltzStatusUpdate.md)\>

***

### quoteTokenAmountIn()

> **quoteTokenAmountIn**(`currency`, `request`): `Promise`\<`BoltzDexQuote`\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:100](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L100)

#### Parameters

##### currency

`string`

##### request

`BoltzDexQuoteRequest`

#### Returns

`Promise`\<`BoltzDexQuote`\>

***

### quoteTokenAmountOut()

> **quoteTokenAmountOut**(`currency`, `request`): `Promise`\<`BoltzDexQuote`\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:101](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L101)

#### Parameters

##### currency

`string`

##### request

`BoltzDexQuoteRequest`

#### Returns

`Promise`\<`BoltzDexQuote`\>

***

### subscribeSwap()

> **subscribeSwap**(`id`): `AsyncIterable`\<[`BoltzStatusUpdate`](BoltzStatusUpdate.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/boltz/types.ts:104](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/boltz/types.ts#L104)

#### Parameters

##### id

`string`

#### Returns

`AsyncIterable`\<[`BoltzStatusUpdate`](BoltzStatusUpdate.md)\>
