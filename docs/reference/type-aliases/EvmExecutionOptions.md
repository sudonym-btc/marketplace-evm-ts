# Type Alias: EvmExecutionOptions

> **EvmExecutionOptions** = `object`

## Properties

### chainId

> **chainId**: `number`

***

### onSubmitted?

> `optional` **onSubmitted?**: (`submission`) => `void` \| `Promise`\<`void`\>

Called immediately after broadcast and before any receipt wait.

#### Parameters

##### submission

[`EvmExecutionSubmission`](EvmExecutionSubmission.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### operationId?

> `optional` **operationId?**: `string`

***

### waitForReceipt?

> `optional` **waitForReceipt?**: `boolean`
