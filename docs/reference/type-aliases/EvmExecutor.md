# Type Alias: EvmExecutor

> **EvmExecutor** = `object`

## Methods

### execute()

> **execute**(`calls`, `options`): `Promise`\<[`EvmExecutionResult`](EvmExecutionResult.md)\>

#### Parameters

##### calls

[`NamedEvmCall`](NamedEvmCall.md)[]

##### options

[`EvmExecutionOptions`](EvmExecutionOptions.md)

#### Returns

`Promise`\<[`EvmExecutionResult`](EvmExecutionResult.md)\>

***

### getAddress()

> **getAddress**(`chainId`): `Promise`\<`` `0x${string}` ``\>

#### Parameters

##### chainId

`number`

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### waitForSubmission()?

> `optional` **waitForSubmission**(`submission`, `options`): `Promise`\<[`EvmExecutionResult`](EvmExecutionResult.md)\>

Reconcile a previously persisted broadcast without submitting it again.

#### Parameters

##### submission

[`EvmExecutionSubmission`](EvmExecutionSubmission.md)

##### options

`Pick`\<[`EvmExecutionOptions`](EvmExecutionOptions.md), `"chainId"`\>

#### Returns

`Promise`\<[`EvmExecutionResult`](EvmExecutionResult.md)\>
