# Type Alias: BoltzClient

> **BoltzClient** = `object`

## Methods

### createReverseSwap()

> **createReverseSwap**(`request`): `Promise`\<[`BoltzReverseSwapResponse`](BoltzReverseSwapResponse.md)\>

#### Parameters

##### request

[`BoltzReverseSwapRequest`](BoltzReverseSwapRequest.md)

#### Returns

`Promise`\<[`BoltzReverseSwapResponse`](BoltzReverseSwapResponse.md)\>

***

### createSubmarineSwap()

> **createSubmarineSwap**(`request`): `Promise`\<[`BoltzSubmarineSwapResponse`](BoltzSubmarineSwapResponse.md)\>

#### Parameters

##### request

[`BoltzSubmarineSwapRequest`](BoltzSubmarineSwapRequest.md)

#### Returns

`Promise`\<[`BoltzSubmarineSwapResponse`](BoltzSubmarineSwapResponse.md)\>

***

### encodeTokenSwap()

> **encodeTokenSwap**(`currency`, `request`): `Promise`\<[`NamedEvmCall`](NamedEvmCall.md)[]\>

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

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`` `0x${string}` `` \| `null`\>

***

### getReversePairs()

> **getReversePairs**(): `Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: \{ `claim`: `number`; `lockup`: `number`; \}; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `minimal`: `number`; \}; `rate`: `number`; \}\>\>

#### Returns

`Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: \{ `claim`: `number`; `lockup`: `number`; \}; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `minimal`: `number`; \}; `rate`: `number`; \}\>\>

***

### getSubmarinePairs()

> **getSubmarinePairs**(): `Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: `number`; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `maximalZeroConf`: `number`; `minimal`: `number`; `minimalBatched?`: `number`; \}; `rate`: `number`; \}\>\>

#### Returns

`Promise`\<`BoltzPairTable`\<\{ `fees`: \{ `minerFees`: `number`; `percentage`: `number`; \}; `hash`: `string`; `limits`: \{ `maximal`: `number`; `maximalZeroConf`: `number`; `minimal`: `number`; `minimalBatched?`: `number`; \}; `rate`: `number`; \}\>\>

***

### getSubmarinePreimage()

> **getSubmarinePreimage**(`id`): `Promise`\<`` `0x${string}` ``\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### getSwap()

> **getSwap**(`id`): `Promise`\<[`BoltzStatusUpdate`](BoltzStatusUpdate.md)\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`BoltzStatusUpdate`](BoltzStatusUpdate.md)\>

***

### quoteTokenAmountIn()

> **quoteTokenAmountIn**(`currency`, `request`): `Promise`\<`BoltzDexQuote`\>

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

#### Parameters

##### id

`string`

#### Returns

`AsyncIterable`\<[`BoltzStatusUpdate`](BoltzStatusUpdate.md)\>
