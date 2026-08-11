# Type Alias: EvmEscrowService

> **EvmEscrowService** = [`EvmEscrowClient`](EvmEscrowClient.md) & `object`

## Type Declaration

### execute()

> **execute**(`calls`, `chainId`, `operationId?`): `Promise`\<\{ `txHash`: `string`; \}\>

#### Parameters

##### calls

[`NamedEvmCall`](NamedEvmCall.md)[]

##### chainId

`number`

##### operationId?

`string`

#### Returns

`Promise`\<\{ `txHash`: `string`; \}\>
