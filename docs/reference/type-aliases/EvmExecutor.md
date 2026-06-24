# Type Alias: EvmExecutor

> **EvmExecutor** = `object`

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:92](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L92)

## Methods

### execute()

> **execute**(`calls`, `options`): `Promise`\<[`EvmExecutionResult`](EvmExecutionResult.md)\>

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:94](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L94)

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

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:93](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L93)

#### Parameters

##### chainId

`number`

#### Returns

`Promise`\<`` `0x${string}` ``\>
